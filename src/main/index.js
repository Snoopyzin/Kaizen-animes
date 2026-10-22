import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  session,
  globalShortcut,
  safeStorage
} from 'electron'
import path, { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.ico?asset'
import { Deeplink } from 'electron-deeplink'
import { spawn } from 'child_process'
import express from 'express'
import cors from 'cors'
import fs from 'fs'
import os from 'os'
import { Readable } from 'stream'
import { getDataDir } from './paths'
import { mainT } from './i18n'
import { resolveTool, runProcess, httpInputArgs } from './tools'
import { PROBE_ENTRIES, buildMediaInfo, parseVtt, roundMs } from './media'
import { createTranslator } from './translate'
import { registerLibrary } from './library'
import { animepaheRouter } from './animepahe/routes/search'
import encUrls from '../../common/utils'
import DiscordRPC from '../renderer/src/utils/discord'
import WebSocket from 'ws'
import announce from '../../common/announce'
import Settings from './settings'
import { mkdirp } from 'mkdirp'
import { cleanPath, validateStreamUrl } from '../renderer/src/utils/externalPlayer'

let chalk
import('chalk').then((module) => {
  chalk = module.default
  console.log(chalk.green('Chalk is loaded!'))
})

let client = null

// Automated runs (KAIZEN_NO_PROTOCOL=1, together with KAIZEN_DATA_DIR and --user-data-dir) must not
// take over the user's kaizen:// registration, which belongs to the installed app
const isolatedRun = process.env.KAIZEN_NO_PROTOCOL === '1'
if (isolatedRun) {
  // lifecycle trace for automated runs: why did the app go away?
  process.on('exit', (code) => console.log('[lifecycle] process exit', code))
  process.on('uncaughtException', (error) => console.log('[lifecycle] uncaughtException', error?.stack))
  app.on('render-process-gone', (e, wc, d) => console.log('[lifecycle] render-process-gone', JSON.stringify(d)))
  app.on('child-process-gone', (e, d) => console.log('[lifecycle] child-process-gone', JSON.stringify(d)))
  app.on('before-quit', () => console.log('[lifecycle] before-quit'))
  app.on('window-all-closed', () => console.log('[lifecycle] window-all-closed'))
}

// A second Kaizen (it quits right away) must never wipe the streaming cache of the running one
const ownsInstanceLock = app.requestSingleInstanceLock()

// Streaming is done from a temporary cache that is wiped when the episode is switched/removed
// and when the app quits, so nothing stays on disk after watching. Automated runs (which set
// KAIZEN_DATA_DIR) keep theirs inside their own data folder, away from the real app's cache.
const streamCacheDir = process.env.KAIZEN_DATA_DIR
  ? join(path.resolve(process.env.KAIZEN_DATA_DIR), 'stream-cache')
  : join(os.tmpdir(), 'KaizenStream')
const STREAM_SLICE = 16 * 1024 * 1024

// An open-ended range makes WebTorrent select (and download) the whole rest of the file no matter
// how slowly the client reads. Instead, read the range in slices, keeping only the current one and
// the next one selected; backpressure from the client therefore throttles the download too.
async function* sliceReader(file, start, end) {
  const open = (pos) =>
    pos <= end ? file.createReadStream({ start: pos, end: Math.min(end, pos + STREAM_SLICE - 1) }) : null
  let pos = start
  let current = open(pos)
  let next = open(pos + STREAM_SLICE)
  try {
    while (current) {
      for await (const chunk of current) yield chunk
      pos += STREAM_SLICE
      current = next
      next = open(pos + STREAM_SLICE)
    }
  } finally {
    current?.destroy()
    next?.destroy()
  }
}
const keptHashes = new Set() // torrents the user explicitly chose to download
const wipeStreamCache = () => {
  try {
    fs.rmSync(streamCacheDir, { recursive: true, force: true })
  } catch (error) {
    console.error('Error cleaning stream cache:', error)
  }
}
if (ownsInstanceLock) wipeStreamCache()
fs.mkdirSync(streamCacheDir, { recursive: true })

const settings = new Settings()

const us = () => {
  if (
    (!settings.get('uploadLimit') && settings.get('uploadLimit') !== 0) ||
    settings.get('uploadLimit') === -1
  )
    return -1
  else return settings.get('uploadLimit')
}
const ds = () => {
  if (
    (!settings.get('downloadLimit') && settings.get('downloadLimit') !== 0) ||
    settings.get('downloadLimit') === -1
  )
    return -1
  else return settings.get('downloadLimit')
}

console.log('Upload Limit:', us())
console.log('Download Limit:', ds())

async function loadWebTorrent() {
  const { default: WebTorrent } = await import('webtorrent')
  try {
    client = new WebTorrent({
      uploadLimit: us(),
      downloadLimit: ds()
    })
    console.log('WebTorrent loaded:')
  } catch (error) {
    console.error('Error loading WebTorrent:', error)
  }
}
loadWebTorrent()

// import isDev from 'electron-is-dev'
// app.commandLine.appendSwitch('force_low_power_gpu')
// app.commandLine.appendSwitch('force_high_performance_gpu')

let mainWindow
let backendServer
// Discord Rich Presence needs the owner's own Discord application id (settings.json: discordClientId)
const discordClientId = settings.get('discordClientId') || null
let rpcClient = null
let extensionUrls = {}
const wss = new WebSocket.Server({ noServer: true })
// const wss = new WebSocket.Server({ port: 64622 })
// let zoomFactor = 1.0

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1300,
    height: 800,
    minWidth: 900,
    minHeight: 670,
    backgroundColor: '#1c1c1c',
    show: false,
    // automated runs live off-screen so they never cover or steal focus from the user's windows
    ...(isolatedRun ? { x: 7000, y: 7000, skipTaskbar: true, focusable: false } : {}),
    // frame: false,
    // frame: process.platform === 'darwin', // Only keep the native frame on Mac
    titleBarStyle: 'hidden',
    icon: icon,
    titleBarOverlay: {
      color: '#17191c00',
      symbolColor: '#eee',
      height: 45
    },
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: true,
      contextIsolation: true,
      enableRemoteModule: false,
      devTools: true,
      webSecurity: false,
      backgroundThrottling: !isolatedRun
    }
  })
  const gotTheLock = app.requestSingleInstanceLock()

  if (!gotTheLock) {
    app.quit() // Quit the app if another instance is already running
    return
  } else {
    app.on('second-instance', () => {
      // If the user tried to run a second instance, show the existing window
      if (mainWindow) {
        if (mainWindow.isMinimized()) {
          mainWindow.restore()
        }
        mainWindow.focus()
      }
    })
  }

  mainWindow.on('ready-to-show', () => {
    if (isolatedRun) mainWindow.showInactive()
    else mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // app.getGPUInfo('complete').then((info) => {
  //   console.log(info)
  // })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    // don't throw an error if the file doesn't exist
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Handle IPC events
  ipcMain.on('minimize-window', () => mainWindow.minimize())
  ipcMain.on('open-folder', (event, folder) => {
    shell.openPath(folder)
  })
  ipcMain.on('maximize-window', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })
  ipcMain.on('close-window', () => mainWindow.close())

  ipcMain.on('oauth-login', (event, authUrl) => {
    shell.openExternal(authUrl) // Open the OAuth URL in the default browser
  })

  ipcMain.on('open-vlc', (event, player, url) => {
    const cleanedPlayerPath = cleanPath(player)

    if (validateStreamUrl(url) === false) {
      dialog.showErrorBox(
        mainT(settings.get('language'), 'invalidStreamUrlTitle'),
        mainT(settings.get('language'), 'invalidStreamUrlBody')
      )
      return
    }

    // prefer Brazilian Portuguese subtitles (and Japanese audio) when the release has those tracks
    const playerName = path.basename(cleanedPlayerPath).toLowerCase()
    const langArgs = playerName.includes('mpv')
      ? ['--slang=pt-BR,pt-br,pob,por,pt', '--alang=ja,jpn']
      : playerName.includes('vlc')
        ? ['--sub-language=pt-BR,por,pob,pt', '--audio-language=ja,jpn']
        : []

    const vlc = spawn(cleanedPlayerPath, [...langArgs, url], {
      shell: false,
      detached: true,
      stdio: 'ignore'
    })

    vlc.on('error', (error) => {
      dialog.showErrorBox(
        mainT(settings.get('language'), 'externalPlayerError') + '\n',
        error.message
      )
    })
  })

  // start the backend server
  if (backendServer) {
    backendServer.close(() => {
      console.log('Backend server stopped.')
      startServer() // Restart the server on the new port
    })
  } else {
    startServer() // Start the server if it's not running yet
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  // Reset Zoom to default
  // globalShortcut.register('CommandOrControl+=', () => {
  //   zoomFactor += 0.1
  //   mainWindow.webContents.setZoomFactor(zoomFactor)
  // })

  // globalShortcut.register('CommandOrControl+-', () => {
  //   zoomFactor -= 0.1
  //   if (zoomFactor < 0.1) zoomFactor = 0.1
  //   mainWindow.webContents.setZoomFactor(zoomFactor)
  // })

  // globalShortcut.register('CommandOrControl+0', () => {
  //   zoomFactor = 1.0
  //   mainWindow.webContents.setZoomFactor(zoomFactor)
  // })

  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  const dataDir = getDataDir()

  extensionUrls = settings.extensionUrls

  ipcMain.on('open-animepahe', () => {
    const webview = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: session.defaultSession,
        preload: join(__dirname, '../preload/webview.js')
      }
    })
    webview.loadURL(encUrls.pahe)

    webview.webContents.on('did-finish-load', async () => {
      const cookies = await webview.webContents.session.cookies.get({})
      console.log('Cookies from webview:', cookies)
      // save cookies in documents directory, write file asynchronusly
      fs.writeFile(
        path.join(dataDir, 'cookies.json'),
        JSON.stringify(cookies, null, 2),
        (err) => {
          if (err) {
            console.error('Error writing cookies:', err)
            return
          }
          console.log('Cookies saved successfully')
        }
      )
    })
  })

  ipcMain.on('change-downloads-folder', () => {
    dialog

      .showOpenDialog({
        title: mainT(settings.get('language'), 'selectDownloadsFolder'),
        defaultPath: settings.getDefaultSettings().downloadsFolderPath,
        properties: ['openDirectory']
      })
      .then((result) => {
        if (!result.canceled) {
          let t = result.filePaths[0]
          console.log('Downloads directory changed to:', t)

          // Save the new downloads directory in settings.json
          settings.set('downloadsFolderPath', t)
          // Send the new downloads directory to the renderer process
          mainWindow.webContents.send('receive-settings-json', settings.getSettings())
        }
      })
      .catch((err) => {
        console.error('Error selecting downloads folder:', err)
      })
  })

  // change port of backend server
  ipcMain.on('change-backend-port', (event, port) => {
    // Save the new backend port in settings.json
    settings.set('backendPort', port)
    console.log('Backend port changed to:', settings.get('backendPort'))
    // Send the new backend port to the renderer process
    mainWindow.webContents.send('receive-settings-json', settings.getSettings())

    // Restart the backend server
    if (backendServer) {
      backendServer.close(() => {
        console.log('Backend server stopped.')
        startServer() // Restart the server on the new port
      })
    } else {
      console.log('Backend server not running, starting it now...')
      startServer() // Start the server if it's not running yet
    }
  })

  ipcMain.on('save-to-settings', (event, key, value) => {
    settings.set(key, value)
  })

  ipcMain.on('get-settings-json', () => {
    mainWindow.webContents.send('receive-settings-json', settings.getSettings())
  })

  ipcMain.on('reload-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.webContents.reload()
    }
  })

  // change discord rpc setting
  ipcMain.on('broadcast-discord-rpc', (event, value) => {
    settings.set('broadcastDiscordRpc', value)
    if (value === false && rpcClient) {
      try {
        rpcClient.disconnect()
        rpcClient = null
      } catch (error) {
        console.error('Error stopping Discord RPC:')
      }
    } else if (value === true) startBroadcastingDiscordRpc()
    console.log('Discord RPC setting changed to:', settings.get('broadcastDiscordRpc'))
  })

  createWindow()

  if (!isolatedRun) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('kaizen', process.execPath, [path.resolve(process.argv[1])])
    } else {
      app.setAsDefaultProtocolClient('kaizen')
    }
  }

  function startBroadcastingDiscordRpc() {
    console.log('Starting Discord RPC...')
    if (!discordClientId) return

    try {
      rpcClient = new DiscordRPC(discordClientId)
      rpcClient.initialize()

      // set default activity
      if (!rpcClient.client.user) return
      setTimeout(() => {
        rpcClient.setActivity({
          details: 'Browsing Anime',
          state: 'Looking for anime to watch',
          // largeImageKey: 'logo',
          // largeImageText: 'Anime Time!',
          // smallImageKey: 'logo',
          // smallImageText: 'Streaming',
          startTimestamp: Date.now()
        })
      }, 3000)
    } catch (error) {
      console.error('Error starting Discord RPC:')
    }
  }

  // Discord RPC
  if (settings.get('broadcastDiscordRpc') === true) {
    startBroadcastingDiscordRpc()
  }

  // set discord rpc activity
  ipcMain.on('set-discord-rpc', (event, activityDetails) => {
    if (!rpcClient || settings.get('broadcastDiscordRpc') === false) return
    rpcClient.setActivity(activityDetails)
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('before-quit', () => {
  if (client) client.destroy()
  if (ownsInstanceLock) wipeStreamCache()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // remove rpc client
    if (rpcClient) rpcClient.disconnect()

    if (backendServer) {
      backendServer.close(() => {
        console.log('Backend server stopped.')
      })
    }

    app.quit()
  }
})

// URL scheme of the app (kaizen://). The AniList login redirects to it: the AniList API client
// (src/renderer/src/utils/auth.js) must be registered with a redirect URL starting with kaizen://
const protocol = 'kaizen'
const deeplink = isolatedRun ? null : new Deeplink({ app, mainWindow, protocol, isDev: is.dev })

deeplink?.on('received', (link) => {
  console.log('Received deeplink:', link)
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('deeplink-received', link)
  }
})

const app2 = express()
// const client = new WebTorrent()

app2.use(cors())
app2.use(express.json({ limit: '200kb' }))

if (settings.get('downloadsFolderPath')) mkdirp(settings.get('downloadsFolderPath'))

/* ------------------------------------------------------ */
/* ------------------------------------------------------ */
/* ------------------------------------------------------ */
/* ------------------------------------------------------ */
/* ------------------------------------------------------ */

function startServer() {
  backendServer = app2.listen(settings.get('backendPort'), '127.0.0.1', () => {
    console.log(`Server running at http://localhost:${settings.get('backendPort')}`)
  })

  backendServer.on('upgrade', (request, socket, head) => {
    console.log('UPGRADE event triggered')

    if (request.url === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    } else {
      console.log('Invalid WebSocket upgrade request')
      socket.destroy()
    }
  })
}

/* ----------------- SEED EXISTING FILES ---------------- */
// Seed all existing files on server startup
// let torrentDownloadPath = downloadsFolderPath || defaultDownloadsDir
// const seedExistingFiles = () => {
//   fs.readdir(downloadsDir, (err, files) => {
//     if (err) {
//       console.error('Error reading downloads directory:', err)
//       return
//     }

//     files.forEach((file) => {
//       const filePath = path.join(downloadsDir, file)

//       if (fs.lstatSync(filePath).isFile()) {
//         client.seed(filePath, { path: downloadsDir }, (torrent) => {
//           // console.log(`Seeding file: ${filePath}`);
//           // console.log(`Magnet URI: ${torrent.magnetURI}`);
//           console.log(chalk.bgBlue('Seeding started: '), chalk.cyan(torrent.name))
//           torrent.on('error', (err) => {
//             console.error(chalk.bgRed('Error seeding file:'), err)
//           })
//         })
//       }
//     })
//   })
// }

// // Call the function to start seeding existing files
// seedExistingFiles()
/* ------------------------------------------------------ */

// app2.get('/add/:magnet', async (req, res) => {
//   let magnet = req.params.magnet

//   /* ------------------------------------------------------ */
//   // Check if the torrent is already added
//   let existingTorrent = await client.get(magnet)
//   console.log('Existing torrent:', existingTorrent)

//   if (existingTorrent) {
//     // If torrent is already added, return its file information
//     let files = existingTorrent.files.map((file) => ({
//       name: file.name,
//       length: file.length
//     }))
//     // console.log("Existing torrent files:", files);

//     return res.status(200).json(files)
//   }
//   /* ------------------------------------------------------ */

//   client.add(magnet, function (torrent) {
//     let files = torrent.files.map((file) => ({
//       name: file.name,
//       length: file.length
//     }))
//     // console.log(files);

//     res.status(200).json(files)
//   })
// })

async function loadLastTorrentSession() {
  const lastSession = settings.get('currentAnime')
  if (!lastSession) return
  const streamUrl = lastSession.streamUrl
  const magnet = lastSession.state.magnetUri

  // add the torrent using the sreamUrl
  try {
    const pre = await fetch(
      `http://localhost:${settings.get('backendPort')}/metadata/${encodeURIComponent(magnet)}`
    )
    if (pre.status === 200 && streamUrl) {
      await fetch(streamUrl)
    }
  } catch (error) {
    console.error('Error fetching stream URL:', error)
    return
  }
}

/* ------------------ ADD LAST SESSION ------------------ */
// Disabled: nothing is kept on disk anymore, so resuming the last session would re-download it.
// setTimeout(() => { loadLastTorrentSession() }, 5000)
/* ------------------------------------------------------ */

/* -------------------- GET METADATA -------------------- */
app2.get('/metadata/:magnet', async (req, res) => {
  let magnet = req.params.magnet

  /* ------------------------------------------------------ */
  // Check if the torrent is already added
  let existingTorrent = await client.get(magnet)

  if (existingTorrent) {
    // If torrent is already added, return its file information
    let files = existingTorrent.files.map((file) => ({
      name: file.name,
      length: file.length
    }))
    // console.log('Announce:', existingTorrent.announce);
    // console.log("Existing torrent files:", files);

    return res.status(200).json(files)
  }
  /* ------------------------------------------------------ */

  // stop all other torrents
  client.torrents.forEach((torrent) => {
    if (keptHashes.has(torrent.infoHash)) return // user chose to download this one
    console.log(chalk.bgRed('Download Stopped:') + ' ' + chalk.cyan(torrent.name))
    torrent.destroy({ destroyStore: true })
  })

  const torrent = client.add(magnet, {
    path: streamCacheDir,
    deselect: true,
    announce: announce
  })

  torrent.on('metadata', () => {
    const files = torrent.files.map((file) => ({
      name: file.name,
      length: file.length
    }))
    console.log(files)

    // deselect all files
    torrent.files.forEach((file) => {
      file.deselect()
    })

    res.status(200).json(files)
  })
})

/* ------------------------------------------------------ */
/* ------------------------------------------------------ */

wss.on('connection', (ws) => {
  console.log('Client connected')
  const interval = setInterval(() => {
    if (!client) return
    let data = []
    data.push({ clientDownloadSpeed: client.downloadSpeed, clientUploadSpeed: client.uploadSpeed })
    const file = client.torrents.map((torrent) => ({
      name: torrent.name,
      length: torrent.length,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      downloaded: torrent.downloaded,
      uploaded: torrent.uploaded,
      progress: torrent.progress,
      done: torrent.done,
      magnet: torrent.magnetURI
    }))

    data = [...data, ...file]

    ws.send(JSON.stringify(data))
  }, 1000)
  // Clear interval when the client disconnects
  ws.on('close', () => {
    console.log('Client disconnected')
    clearInterval(interval)
  })
})

app2.get('/downloadsInfo', async (req, res) => {
  let files = []

  client.torrents.forEach((torrent) => {
    let torrentFiles = {
      name: torrent.name,
      length: torrent.length,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      downloaded: torrent.downloaded,
      uploaded: torrent.uploaded,
      progress: torrent.progress,
      done: torrent.done,
      magnet: torrent.magnetURI
    }

    // files = files.concat(torrentFiles)
    files.push(torrentFiles)
  })

  res.status(200).json(files)
})

/* ------------------------------------------------------ */
/* ------------------------------------------------------ */
app2.get('/streamfile/:magnet/:filename', async function (req, res, next) {
  let magnet = req.params.magnet
  let filename = req.params.filename


  let tor = await client.get(magnet)

  if (!tor) {
    return res.status(404).send('Torrent not found')
  }

  let file = tor.files.find((f) => f.name === filename)

  if (!file) {
    return res.status(404).send('No file found in the torrent')
  }

  // no file.select(): createReadStream already prioritises just the byte range being read, so the
  // episode is streamed on demand instead of being downloaded whole

  let range = req.headers.range


  if (!range) {
    return res.status(416).send('Range is required')
  }

  let positions = range.replace(/bytes=/, '').split('-')
  let start = parseInt(positions[0], 10)
  let file_size = file.length
  let end = positions[1] ? parseInt(positions[1], 10) : file_size - 1
  let chunksize = end - start + 1

  let head = {
    'Content-Range': `bytes ${start}-${end}/${file_size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunksize,
    'Content-Type': 'video/x-matroska'
  }

  res.writeHead(206, head)

  let stream_position = {
    start: start,
    end: end
  }

  if (!String(req.headers['user-agent']).includes('KaizenSubs')) {
    detailsOfEpisode.percentageWatched = (start / end) * 100
  }

  let stream = Readable.from(sliceReader(file, stream_position.start, stream_position.end))
  stream.pipe(res)
  // client went away (seek, ffmpeg done, player closed): stop pulling pieces for this range
  res.on("close", () => stream.destroy())

  stream.on('error', function (err) {
    console.error('Stream error:', err)
    // Only send a response if headers haven't been sent yet
    if (!res.headersSent) {
      return res.status(500).send('Error streaming the video')
    }
  })

  stream.on('close', () => {
    console.log('Stream closed prematurely')
  })
})

// Deselect an episode with the given filename
app2.get('/deselect/:magnet/:filename', async (req, res) => {
  let magnet = req.params.magnet
  let filename = req.params.filename

  let tor = await client.get(magnet)

  if (!tor) {
    return res.status(404).send('Torrent not found')
  }

  let file = tor.files.find((f) => f.name === filename)

  // deselect all files

  if (!file) {
    return res.status(404).send('No file found in the torrent')
  }

  console.log(chalk.bgRed('Download Stopped:') + ' ' + chalk.cyan(file.name))

  file.deselect()
  file.deselect()
  file.deselect()

  res.status(200).send('File deselected successfully')
})

// get download details of a file

let detailsOfEpisode = {
  name: '',
  length: 0,
  downloaded: 0,
  progress: 0,
  percentageWatched: 0
}

app2.get('/detailsepisode/:magnet/:filename', async (req, res) => {
  let magnet = req.params.magnet
  let filename = req.params.filename

  let tor = await client.get(magnet)
  if (!tor) {
    return res.status(404).send('Torrent not found')
  }

  let file = tor.files.find((f) => f.name === filename)
  if (!file) {
    return res.status(404).send('No file found in the torrent')
  }

  // let details = {
  detailsOfEpisode = {
    name: file.name,
    length: file.length,
    downloaded: file.downloaded,
    progress: file.progress,
    percentageWatched: detailsOfEpisode.percentageWatched
  }

  res.status(200).json(detailsOfEpisode)
})

/* ------------------------------------------------------ */

app2.get('/stream/:magnet', async function (req, res, next) {
  let magnet = req.params.magnet
  console.log(magnet)

  let tor = await client.get(magnet)

  if (!tor) {
    return res.status(404).send('Torrent not found')
  }

  let file = tor.files.find((f) => f.name.endsWith('.mkv'))

  if (!file) {
    return res.status(404).send('No MP4 file found in the torrent')
  }

  let range = req.headers.range

  if (!range) {
    return res.status(416).send('Range is required')
  }

  let positions = range.replace(/bytes=/, '').split('-')
  let start = parseInt(positions[0], 10)
  let file_size = file.length
  let end = positions[1] ? parseInt(positions[1], 10) : file_size - 1
  let chunksize = end - start + 1

  let head = {
    'Content-Range': `bytes ${start}-${end}/${file_size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': chunksize,
    'Content-Type': 'video/x-matroska'
  }

  res.writeHead(206, head)

  let stream_position = {
    start: start,
    end: end
  }

  let stream = Readable.from(sliceReader(file, stream_position.start, stream_position.end))
  stream.pipe(res)
  // client went away (seek, ffmpeg done, player closed): stop pulling pieces for this range
  res.on("close", () => stream.destroy())

  stream.on('error', function (err) {
    console.error('Stream error:', err)
    // Only send a response if headers haven't been sent yet
    if (!res.headersSent) {
      return res.status(500).send('Error streaming the video')
    }
  })

  stream.on('close', () => {
    console.log('Stream closed prematurely')
  })
})

app2.get('/details/:magnet', async (req, res) => {
  let magnet = req.params.magnet

  // Find the torrent by magnet link
  let tor = await client.get(magnet)
  if (!tor) {
    return res.status(404).send('Torrent not found')
  }

  // Prepare torrent details
  let details = {
    name: tor.name,
    length: tor.length,
    downloaded: tor.downloaded,
    uploaded: tor.uploaded,
    downloadSpeed: tor.downloadSpeed,
    uploadSpeed: tor.uploadSpeed,
    progress: tor.progress,
    ratio: tor.ratio,
    numPeers: tor.numPeers
  }

  res.status(200).json(details)
})

/* --------------- Handling VLC streaming --------------- */
// import { get } from 'http'
// import { fileURLToPath } from 'url'
// Full path to VLC executable, change it as needed
// const vlcPath = '"C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe"' // Adjust this path as needed

// app2.get('/stream-to-vlc', async (req, res) => {
//   const { url, magnet } = req.query

//   if (!url) {
//     return res.status(400).send('URL is required')
//   }

//   spawn(vlcPath.replace(/"/g, ''), [url], {
//     shell: false,
//     detached: true,
//     stdio: 'ignore'
//   })

//   res.send('VLC launched successfully')
// })

/* ------------------------------------------------------ */

app2.delete('/remove/:magnet', async (req, res) => {
  let magnet = req.params.magnet

  // Find the torrent by magnet link
  let tor = await client.get(magnet)
  if (!tor) {
    return res.status(404).send('Torrent not found')
  }

  // Destroy the torrent to stop downloading and remove it from the client
  tor.destroy({ destroyStore: !keptHashes.has(tor.infoHash) }, (err) => {
    if (err) {
      console.error('Error removing torrent:', err)
      return res.status(500).send('Error removing torrent')
    }
    settings.set('currentAnime', null) // Clear the current anime session

    res.status(200).send('Torrent removed successfully')
  })
})

/* ------------------- PT-BR SUBTITLES ------------------- */
// Browsers can't read subtitle tracks embedded in mkv files, so we extract one with ffmpeg:
// a Portuguese track if the release has it, otherwise the English one machine-translated to pt-BR.
// ffmpeg/ffprobe must be available on PATH.
const subtitleCache = new Map()

// ffmpeg / ffprobe ship inside the app (see tools.js)
const toolPath = (name) => resolveTool(name, { appPath: app.getAppPath() })
const { translateLines, translateCues } = createTranslator({
  getDeeplKey: () => settings.get('deeplApiKey')
})

// ---- Netflix-style tracks: every audio / subtitle track of the file can be picked ----
// Subtitles are extracted lazily, a time range at a time (an mkv interleaves them with the video,
// so a range costs about the same data as watching it) and audio the browser can't decode
// (E-AC3, AC3, DTS, TrueHD...) or that isn't the default track is transcoded to AAC on the fly.

function trackUrl(req) {
  const { magnet, filename } = req.params
  return {
    key: `${magnet}|${filename}`,
    url: `http://127.0.0.1:${settings.get('backendPort')}/streamfile/${encodeURIComponent(magnet)}/${encodeURIComponent(filename)}`
  }
}

function cachedJob(k, make) {
  if (!subtitleCache.has(k)) {
    const job = make()
    subtitleCache.set(k, job)
    job.catch((error) => {
      console.error('Track job failed:', error.message)
      subtitleCache.delete(k) // allow retrying
    })
  }
  return subtitleCache.get(k)
}

async function probeMedia(input) {
  const out = JSON.parse(
    await runProcess(toolPath('ffprobe'), [
      '-v', 'error',
      ...httpInputArgs(input),
      '-show_entries', PROBE_ENTRIES,
      '-of', 'json',
      input
    ])
  )
  return buildMediaInfo(out)
}

async function extractCues(input, id, from, len) {
  const vtt = await runProcess(toolPath('ffmpeg'), [
    '-v', 'error',
    ...httpInputArgs(input),
    '-ss', String(from),
    '-i', input,
    '-map', `0:${id}`,
    '-t', String(len), // as an output option ffmpeg stops reading at the end of the range
    '-f', 'webvtt',
    'pipe:1'
  ])
  return parseVtt(vtt).map((c) => ({ ...c, s: roundMs(c.s + from), e: roundMs(c.e + from) }))
}

// POST /translate { texts: string[] } -> { texts: string[] } (Portuguese). Used for API texts such as
// anime synopses. Only reachable from this machine (the backend listens on 127.0.0.1).
app2.post('/translate', async (req, res) => {
  const texts = req.body?.texts
  if (
    !Array.isArray(texts) ||
    texts.length === 0 ||
    texts.length > 60 ||
    texts.some((x) => typeof x !== 'string' || x.length > 4000)
  ) {
    return res.status(400).json({ error: 'invalid body' })
  }
  try {
    const idx = texts.map((x, i) => (x.trim() ? i : -1)).filter((i) => i >= 0)
    const out = [...texts]
    if (idx.length) {
      const translated = await translateLines(idx.map((i) => texts[i]))
      idx.forEach((i, k) => (out[i] = translated[k]))
    }
    res.status(200).json({ texts: out })
  } catch (error) {
    console.error('Translation failed:', error.message)
    res.status(502).json({ error: 'translation_failed' })
  }
})

app2.get('/mediainfo/:magnet/:filename', async (req, res) => {
  const { key, url } = trackUrl(req)
  try {
    res.status(200).json(await cachedJob(`${key}|info`, () => probeMedia(url)))
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ?track=<stream index>|auto-pt &from=<seconds> &len=<seconds>
app2.get('/subtitles/:magnet/:filename', async (req, res) => {
  const { key, url } = trackUrl(req)
  const from = Math.max(0, Number(req.query.from) || 0)
  const len = Math.min(600, Math.max(10, Number(req.query.len) || 120))
  try {
    const info = await cachedJob(`${key}|info`, () => probeMedia(url))
    const auto = req.query.track === 'auto-pt'
    const id = auto ? info.autoPtSource : parseInt(req.query.track, 10)
    if (id === null || Number.isNaN(id)) return res.status(404).json({ error: 'no such track' })

    const rangeKey = `${key}|${id}|${from}|${len}`
    const cues = await cachedJob(rangeKey, () => extractCues(url, id, from, len))
    if (!auto) return res.status(200).json({ from, len, source: 'native', cues })

    const translated = await cachedJob(`${rangeKey}|pt`, () => translateCues(cues))
    res.status(200).json({
      from,
      len,
      source: translated.failed ? 'translation_failed' : 'translated',
      cues: translated.cues
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ?track=<stream index> &start=<seconds>: AAC (ADTS) stereo, for the <audio> element that plays
// next to the video when the browser can't decode the file's own audio
app2.get('/audio/:magnet/:filename', (req, res) => {
  const { url } = trackUrl(req)
  const track = parseInt(req.query.track, 10)
  const start = Math.max(0, Number(req.query.start) || 0)
  if (Number.isNaN(track)) return res.status(400).send('track required')

  const ff = spawn(
    toolPath('ffmpeg'),
    [
      '-v', 'error',
      ...httpInputArgs(url),
      '-ss', String(start),
      '-i', url,
      '-map', `0:${track}`,
      '-vn', '-sn',
      '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
      '-f', 'adts',
      'pipe:1'
    ],
    { shell: false, windowsHide: true }
  )
  res.writeHead(200, { 'Content-Type': 'audio/aac', 'Cache-Control': 'no-store' })
  ff.stdout.pipe(res)
  ff.stderr.on('data', (d) => console.error('ffmpeg audio:', String(d).trim()))
  ff.on('error', (error) => {
    console.error('ffmpeg audio failed to start:', error.message)
    res.end()
  })
  res.on('close', () => ff.kill()) // seek / pause-stop / player closed
})

/* ------------- OPTIONAL: KEEP / DOWNLOAD EPISODE ------------- */
// Watching never leaves files behind. Only when the user asks, the torrent is re-added into the
// real downloads folder and exempted from the automatic cleanup.
app2.get('/download/:magnet', async (req, res) => {
  const magnet = req.params.magnet
  const existing = await client.get(magnet)
  if (existing && keptHashes.has(existing.infoHash)) {
    return res.status(200).json({ status: 'already-downloading' })
  }
  if (existing) existing.destroy({ destroyStore: true })

  const torrent = client.add(magnet, { path: settings.get('downloadsFolderPath'), announce })
  keptHashes.add(torrent.infoHash)
  // wait for the metadata so the stream that is playing can reconnect right away
  const respond = () => res.status(200).json({ status: 'started', path: settings.get('downloadsFolderPath') })
  if (torrent.files?.length) respond()
  else torrent.once('metadata', respond)
})
/* ------------------------------------------------------ */

// ping backend
app2.get('/ping', (req, res) => {
  res.status(200).send('pong')
})

// do not start the server again if it is already running

// app2.listen(64621, () => {
//   console.log('Server running at http://localhost:64621')
// })

/* ------------------------------------------------------ */
/* ---------------------- ANIMEPAHE --------------------- */
/* ------------------------------------------------------ */

app2.use('/animepahe', animepaheRouter)

/* ------------------------------------------------------ */
/* ---------- LIBRARY (movies, series from a Jellyfin server) ---------- */
/* ------------------------------------------------------ */
const library = registerLibrary(app2, {
  app,
  ipcMain,
  safeStorage,
  appVersion: app.getVersion(),
  getMainWindow: () => mainWindow,
  dataDir: getDataDir(),
  ffmpegPath: toolPath('ffmpeg'),
  ffprobePath: toolPath('ffprobe'),
  translateCues,
  getBackendPort: () => settings.get('backendPort')
})
// stops running audio conversions and closes the connection pool
app.on('before-quit', () => library.close())

module.exports.extensionUrls = extensionUrls
