// Client of the library backend (Express, same port as the rest of the backend) and of the IPC
// calls that talk to the user's Jellyfin server (connect / disconnect / status).
// Every HTTP call carries the per-run secret as `?t=<token>`; every failure is thrown as a
// LibraryError whose `.code` is the `error` of the JSON body (or a local code, see below).
//
//   local codes: BACKEND_DOWN (the local backend did not answer), BAD_RESPONSE (not JSON)
import { buildUrl, imageUrl, normalizeId, streamUrl, trackUrl } from './lib.js'

export class LibraryError extends Error {
  constructor(code, message = '', status = 0) {
    super(message || code)
    this.name = 'LibraryError'
    this.code = code
    this.status = status
  }
}

// window.api.library is only there inside Electron
const bridge = () => {
  try {
    return typeof window !== 'undefined' ? window.api?.library : undefined
  } catch {
    return undefined
  }
}

// the per-run secret of the backend; '' outside Electron (every request then answers 401)
export function getToken() {
  const token = bridge()?.token
  return typeof token === 'string' ? token : ''
}

/* ------------------------------ urls for <img>, <video>, TracksMenu ------------------------------ */

export const libraryUrls = (port) => ({
  image: (id, type = 'primary', width = 400) => imageUrl(port, getToken(), id, { type, width }),
  stream: (id) => streamUrl(port, getToken(), id),
  // the external player runs outside the browser: 127.0.0.1 is what the main process validates
  externalStream: (id) => streamUrl(port, getToken(), id, '127.0.0.1'),
  track: (id, kind) => trackUrl(port, getToken(), id, kind)
})

/* ------------------------------ http ------------------------------ */

async function request(
  port,
  path,
  { method = 'GET', params, body, keepalive = false, signal } = {}
) {
  const url = buildUrl(port, path, { token: getToken(), params })
  const init = { method, keepalive, signal, cache: 'no-store' }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }

  let response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new LibraryError('BACKEND_DOWN', error?.message)
  }

  let data = null
  try {
    const text = await response.text()
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }

  if (!response.ok) {
    const code =
      typeof data?.error === 'string' && data.error
        ? data.error
        : response.status === 401
          ? 'UNAUTHORIZED'
          : response.status === 404
            ? 'NOT_FOUND'
            : 'INTERNAL'
    throw new LibraryError(code, data?.message, response.status)
  }
  if (data === null) throw new LibraryError('BAD_RESPONSE', '', response.status)
  return data
}

const requireId = (id) => {
  const safe = normalizeId(id)
  if (!safe) throw new LibraryError('BAD_REQUEST', 'invalid id')
  return safe
}

export const normalizeStatus = (status) => ({
  connected: status?.connected === true && !!status?.server,
  server: status?.connected === true && status?.server ? status.server : null
})

// IPC first (no HTTP needed to know whether a server is configured), HTTP when the bridge is absent
export async function fetchStatus(port) {
  const lib = bridge()
  if (typeof lib?.status === 'function') {
    try {
      return normalizeStatus(await lib.status())
    } catch {
      /* fall back to the HTTP route */
    }
  }
  return normalizeStatus(await request(port, '/status'))
}

export const fetchIndex = async (port, { refresh = false } = {}) =>
  request(port, '/', { params: refresh ? { refresh: 1 } : undefined })

export const fetchSeries = async (port, id) => request(port, `/series/${requireId(id)}`)

export const fetchVideo = async (port, id) => request(port, `/video/${requireId(id)}`)

export const sendProgress = async (port, id, body, { keepalive = false } = {}) =>
  request(port, `/progress/${requireId(id)}`, { method: 'POST', body, keepalive })

export const sendWatched = async (port, ids, watched) =>
  request(port, '/watched', {
    method: 'POST',
    body: { ids: (Array.isArray(ids) ? ids : []).map(requireId), watched: !!watched }
  })

export const sendFavorite = async (port, id, favorite) =>
  request(port, '/favorite', { method: 'POST', body: { id: requireId(id), favorite: !!favorite } })

/* ------------------------------ ipc: connect / disconnect ------------------------------ */

// -> { ok: true, server } | { ok: false, error: <code> }; never throws, never logs the password
export async function connectServer({ url, username, password, allowInvalidCert = false }) {
  const lib = bridge()
  if (typeof lib?.connect !== 'function') return { ok: false, error: 'UNAVAILABLE' }
  try {
    const result = await lib.connect({ url, username, password, allowInvalidCert })
    if (result && typeof result === 'object') {
      if (result.ok === true) return { ok: true, server: result.server ?? null }
      return { ok: false, error: String(result.error || 'SERVER_ERROR') }
    }
  } catch {
    /* the IPC call itself failed */
  }
  return { ok: false, error: 'SERVER_ERROR' }
}

export async function disconnectServer() {
  const lib = bridge()
  if (typeof lib?.disconnect !== 'function') return { ok: false, error: 'UNAVAILABLE' }
  try {
    const result = await lib.disconnect()
    return result && result.ok === false ? { ok: false, error: 'SERVER_ERROR' } : { ok: true }
  } catch {
    return { ok: false, error: 'SERVER_ERROR' }
  }
}
