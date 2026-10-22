import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Library of movies & series served by the user's own media server (Jellyfin). The server address and
// the password only ever travel through these IPC calls (never through the HTTP backend); the main
// process keeps the session token, and the backend requires this per-run secret token on every request.
const library = {
  token: ipcRenderer.sendSync('library:token'),
  status: () => ipcRenderer.invoke('library:status'),
  connect: ({ url, username, password, allowInvalidCert = false }) =>
    ipcRenderer.invoke('library:connect', { url, username, password, allowInvalidCert }),
  disconnect: () => ipcRenderer.invoke('library:disconnect')
}

// Custom APIs for renderer
const api = {
  library,
  minimize: () => ipcRenderer.send('minimize-window'),
  maximize: () => ipcRenderer.send('maximize-window'),
  close: () => ipcRenderer.send('close-window'),
  oauth: (url) => ipcRenderer.send('oauth-login', url),
  openVlc: (player, url) => ipcRenderer.send('open-vlc', player, url),
  openAnimePahe: (url) => ipcRenderer.send('open-animepahe', url),
  windowReload: () => ipcRenderer.send('reload-window'),
  changeBackendPort: (port) => ipcRenderer.send('change-backend-port', port),
  openFolder: (folder) => ipcRenderer.send('open-folder', folder),
  changeDownloadsFolder: () => {
    ipcRenderer.removeAllListeners('receive-settings-json')
    ipcRenderer.send('change-downloads-folder')
    return new Promise((resolve) => {
      ipcRenderer.once('receive-settings-json', (event, updatedSettings) =>
        resolve(updatedSettings)
      )
    })
  },
  saveToSettings: (key, value) => {
    ipcRenderer.send('save-to-settings', key, value)
  },
  getSettingsJson: () => {
    ipcRenderer.removeAllListeners('receive-settings-json')
    ipcRenderer.send('get-settings-json')
    return new Promise((resolve) => {
      ipcRenderer.once('receive-settings-json', (event, data) => resolve(data))
    })
  },
  setDiscordRpc: (activityDetails) => {
    ipcRenderer.send('set-discord-rpc', activityDetails)
  },
  broadcastDiscordRpc: (value) => {
    ipcRenderer.send('broadcast-discord-rpc', value)
  }
}

const deeplinks = {
  receiveDeeplink: (callback) =>
    ipcRenderer.on('deeplink-received', (event, link) => callback(link))
}

const combinedAPI = {
  ...electronAPI,
  ...deeplinks,
  ...api // Include your custom APIs
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', combinedAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
