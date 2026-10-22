// The one stored connection to the user's Jellyfin server (<dataDir>/library-server.json).
// Electron-free: the OS key store (safeStorage) and the file system are injected so tests can fake them.
//
//   - the password is never stored, only the access token Jellyfin returned;
//   - the token is encrypted with safeStorage when the OS allows it (otherwise it is kept as plain
//     text with `enc: false`: the file lives in the user's own Documents folder);
//   - writes are atomic (tmp file + rename, retried because Windows antivirus tools hold files) and
//     the previous good copy is kept as .bak; a corrupt file never makes the app fail to start.
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export const FILE_NAME = 'library-server.json'
const FILE_VERSION = 1

export class ConnectionError extends Error {
  constructor(code, message) {
    super(message || code)
    this.name = 'ConnectionError'
    this.code = code
  }
}

/* ------------------------------ url ------------------------------ */

// "192.168.0.10:8096" | "http://host:8096/web/index.html#/home" | "https://u:p@host/jellyfin/" ->
// "http://192.168.0.10:8096" | "http://host:8096" | "https://host/jellyfin"
// Only http(s); credentials, query, hash, a trailing slash and /web[/index.html] are dropped, a sub-path
// (reverse proxy) is kept. Throws ConnectionError('BAD_URL').
export function normalizeUrl(input) {
  const bad = () => new ConnectionError('BAD_URL', 'invalid server address')
  if (typeof input !== 'string') throw bad()
  let text = input.trim()
  if (!text || text.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(text)) throw bad()
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`
  let url
  try {
    url = new URL(text)
  } catch {
    throw bad()
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw bad()
  if (!url.hostname) throw bad()
  const pathname = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/web(\/index\.html)?$/i, '')
    .replace(/\/index\.html$/i, '')
    .replace(/\/+$/, '')
  return `${url.protocol}//${url.host}${pathname}`
}

export const hostOf = (url) => {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

// what the renderer may see: no token, no password, no credentials in the url (normalizeUrl strips them).
// `url` and `allowInvalidCert` let the reconnect form keep https, a sub-path and the trust choice.
export const publicServer = (server) =>
  server
    ? {
        name: String(server.name || ''),
        host: hostOf(server.url),
        url: String(server.url || ''),
        userName: String(server.userName || ''),
        version: String(server.version || ''),
        allowInvalidCert: server.allowInvalidCert === true
      }
    : null

/* ------------------------------ store ------------------------------ */

const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES', 'EAGAIN', 'ENOTEMPTY'])
const RETRY_DELAYS_MS = [15, 40, 90, 180, 350]
const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isHexId = (value) =>
  typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value.replace(/-/g, ''))

export function createConnectionStore({
  dataDir,
  safeStorage = null,
  fsImpl = fs,
  sleep = sleepMs,
  randomUUID = crypto.randomUUID,
  now = Date.now,
  log = () => {}
} = {}) {
  const file = path.join(dataDir, FILE_NAME)
  const tmp = `${file}.tmp`
  const bak = `${file}.bak`

  let deviceId = null
  let server = null // public fields + url etc. (no token)
  let token = null // decrypted access token, kept in memory only
  // what the file holds for the token, decrypted LAZILY: the store is created while the app is still
  // starting and on Windows safeStorage can only decrypt after Electron's 'ready' event
  let storedToken = null
  let lastGoodText = null // what the main file holds (for the .bak copy)

  function currentToken() {
    if (!token && storedToken) {
      const decoded = decodeToken(storedToken)
      if (decoded) token = decoded // only a success is kept: a failure may just be "not ready yet"
    }
    return token
  }

  /* ---- token (de)obfuscation ---- */
  function encodeToken(plain) {
    try {
      if (safeStorage?.isEncryptionAvailable?.()) {
        return { enc: true, data: safeStorage.encryptString(plain).toString('base64') }
      }
    } catch (error) {
      log(`token encryption failed, storing it unencrypted: ${error.message}`)
    }
    return { enc: false, data: plain }
  }
  function decodeToken(stored) {
    if (!stored || typeof stored.data !== 'string' || !stored.data) return null
    if (!stored.enc) return stored.data
    try {
      if (!safeStorage?.isEncryptionAvailable?.()) return null
      return safeStorage.decryptString(Buffer.from(stored.data, 'base64')) || null
    } catch {
      return null // e.g. the file came from another Windows user / machine: ask for the password again
    }
  }

  /* ---- parsing ---- */
  function parse(text) {
    const json = JSON.parse(text)
    if (!json || typeof json !== 'object' || json.version !== FILE_VERSION)
      throw new Error('unknown format')
    const result = { deviceId: null, server: null, storedToken: null }
    const raw = json.server
    result.deviceId =
      typeof json.deviceId === 'string' && json.deviceId ? json.deviceId : raw?.deviceId || null
    if (raw && typeof raw === 'object') {
      const url = normalizeUrl(raw.url) // throws on garbage
      result.server = {
        url,
        name: String(raw.name || ''),
        serverId: String(raw.serverId || ''),
        version: String(raw.version || ''),
        userId: String(raw.userId || ''),
        userName: String(raw.userName || ''),
        allowInvalidCert: raw.allowInvalidCert === true,
        connectedAt: Number(raw.connectedAt) || 0
      }
      if (!isHexId(result.server.userId)) throw new Error('bad user id')
      result.storedToken = raw.token || null
    }
    return result
  }

  function load() {
    deviceId = null
    server = null
    token = null
    storedToken = null
    lastGoodText = null
    for (const candidate of [file, bak]) {
      let text
      try {
        text = fsImpl.readFileSync(candidate, 'utf8')
      } catch (error) {
        if (error?.code === 'ENOENT') {
          if (candidate === file) break // never saved: nothing to recover
          continue
        }
        log(`cannot read ${path.basename(candidate)}: ${error.message}`)
        continue
      }
      try {
        const parsed = parse(text)
        deviceId = parsed.deviceId
        server = parsed.server
        storedToken = parsed.storedToken
        lastGoodText = text
        if (candidate === bak) log('library-server.json was damaged: restored from the backup copy')
        break
      } catch (error) {
        log(`${path.basename(candidate)} is not usable (${error.message})`)
      }
    }
    if (!deviceId) deviceId = randomUUID() // generated once; persisted with the next save
  }

  /* ---- writing ---- */
  async function renameWithRetry(from, to) {
    let lastError
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        fsImpl.renameSync(from, to)
        return
      } catch (error) {
        lastError = error
        if (!RETRY_CODES.has(error?.code)) throw error
        if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt])
      }
    }
    // the rename keeps failing (file locked by an antivirus scan...): copy over it instead
    try {
      fsImpl.copyFileSync(from, to)
      try {
        fsImpl.unlinkSync(from)
      } catch {
        /* a stale .tmp is harmless */
      }
    } catch {
      throw lastError
    }
  }

  let writing = Promise.resolve()
  function writeFile(text) {
    // writes never overlap (connect + disconnect racing)
    const run = async () => {
      fsImpl.mkdirSync(dataDir, { recursive: true })
      if (lastGoodText !== null) {
        try {
          fsImpl.writeFileSync(bak, lastGoodText)
        } catch (error) {
          log(`cannot refresh the backup copy: ${error.message}`)
        }
      }
      fsImpl.writeFileSync(tmp, text)
      await renameWithRetry(tmp, file)
      lastGoodText = text
    }
    const next = writing.then(run, run)
    writing = next.catch(() => {})
    return next
  }

  function serialise() {
    return JSON.stringify(
      {
        version: FILE_VERSION,
        deviceId,
        server: server
          ? {
              ...server,
              deviceId,
              token: token
                ? encodeToken(token)
                : storedToken || { enc: false, data: '' }
            }
          : null
      },
      null,
      2
    )
  }

  load()

  return {
    file,
    get deviceId() {
      return deviceId
    },
    // renderer-safe view
    status() {
      return { connected: !!server, server: publicServer(server) }
    },
    // everything the main process needs to talk to the server (token included: never send it anywhere)
    current() {
      return server ? { ...server, deviceId, token: currentToken() } : null
    },
    async save({
      url,
      name,
      serverId,
      version,
      userId,
      userName,
      allowInvalidCert = false,
      token: newToken
    }) {
      server = {
        url: normalizeUrl(url),
        name: String(name || ''),
        serverId: String(serverId || ''),
        version: String(version || ''),
        userId: String(userId || ''),
        userName: String(userName || ''),
        allowInvalidCert: allowInvalidCert === true,
        connectedAt: now()
      }
      token = newToken || null
      storedToken = null
      await writeFile(serialise())
    },
    // forget the server (and the token) but keep the device id: Jellyfin lists one Kaizen device, not one per login
    async clear() {
      server = null
      token = null
      storedToken = null
      await writeFile(serialise())
    },
    reload: load
  }
}
