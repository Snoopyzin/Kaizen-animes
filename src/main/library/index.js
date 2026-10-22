// Entry point of the library ("Biblioteca"): movies and series served by the user's own Jellyfin server.
//
//   registerLibrary(app, deps)  mounts the Express router at /library and registers the IPC channels
//                               library:token (sync), library:status, library:connect, library:disconnect
//
// The renderer receives the per-run secret over IPC and must send it on every /library request;
// the server address, the password and the Jellyfin token never leave the main process.
import crypto from 'crypto'
import { createConnectionStore } from './connection.js'
import { createLibraryService } from './service.js'
import { createTracks } from './tracks.js'
import { createProxies } from './proxy.js'
import { createLibraryRouter } from './routes.js'
import { redact } from './errors.js'

// secret sent by the renderer on every /library request (never leaves this machine)
export const libraryToken = crypto.randomBytes(24).toString('hex')

// deps: { app, ipcMain, safeStorage, appVersion, getMainWindow, dataDir, ffmpegPath, ffprobePath,
//         translateCues, getBackendPort }  (+ optional `token`, `log`, `spawn`, `createClient`, `maxAudio` for tests)
export function registerLibrary(app, deps) {
  const {
    ipcMain,
    safeStorage,
    appVersion,
    dataDir,
    ffmpegPath,
    translateCues,
    getBackendPort,
    token = libraryToken,
    log = (message) => console.log(`[library] ${redact(message)}`),
    spawn,
    createClient,
    maxAudio
  } = deps

  const store = createConnectionStore({ dataDir, safeStorage, log })
  const service = createLibraryService({
    store,
    appVersion,
    log,
    ...(createClient ? { createClient } : {})
  })
  const tracks = createTracks({
    service,
    ffmpegPath,
    getBackendPort,
    getToken: () => token,
    translateCues,
    spawn,
    maxAudio,
    log
  })
  const proxies = createProxies({ service, log })
  service.onReset(() => tracks.clear())
  app.use('/library', createLibraryRouter({ service, tracks, proxies, token, log }))

  if (ipcMain) {
    ipcMain.on('library:token', (event) => {
      event.returnValue = token
    })
    ipcMain.handle('library:status', async () => service.status())
    ipcMain.handle('library:connect', async (event, args) => {
      try {
        return await service.connect(args)
      } catch (error) {
        log(`connect failed: ${error?.message}`)
        return { ok: false, error: 'SERVER_ERROR', message: 'unexpected error' }
      }
    })
    ipcMain.handle('library:disconnect', async () => {
      try {
        return await service.disconnect()
      } catch (error) {
        log(`disconnect failed: ${error?.message}`)
        return { ok: true }
      }
    })
  }

  return {
    service,
    store,
    tracks,
    // stops running conversions and closes the connection pool (app quit, tests)
    close() {
      tracks.shutdown()
      service.close()
    }
  }
}
