// Minimal Jellyfin HTTP client built on node's http/https (the main process is bundled, so no undici).
// One client = one server + one access token. Every call has a timeout, never follows redirects and
// maps failures to a small closed set of codes (JellyfinError.code) that the service turns into API errors.
//
// Verified against a real Jellyfin 12.2 (the golden samples in test/library/golden were recorded from it):
//   - only `Authorization: MediaBrowser Client=..., Token="..."` authenticates (X-Emby-*, api_key do not);
//   - ids come back as 32 hex chars without dashes (dashed ids are accepted);
//   - wrong password / bad token answer 401 (text/plain "Error processing request." / empty body).
import http from 'http'
import https from 'https'
import { ITEM_FIELDS } from './queries.js'

export class JellyfinError extends Error {
  constructor(code, message, { status = 0, cause } = {}) {
    super(message || code)
    this.name = 'JellyfinError'
    this.code = code // UNREACHABLE | TIMEOUT | TLS_ERROR | BAD_CREDENTIALS | AUTH_EXPIRED | NOT_FOUND | UPSTREAM_ERROR | BAD_RESPONSE
    this.status = status // upstream HTTP status, 0 for network errors
    if (cause) this.cause = cause
  }
}

const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNRESET',
  'ECONNABORTED',
  'EAI_AGAIN',
  'EPIPE',
  'ENETDOWN'
])
const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'CERT_REVOKED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'HOSTNAME_MISMATCH'
])

// node socket / TLS error -> JellyfinError
export function mapNetworkError(error) {
  if (error instanceof JellyfinError) return error
  const code = String(error?.code || '')
  const message = String(error?.message || '')
  if (TLS_CODES.has(code) || /certificate/i.test(message)) {
    return new JellyfinError('TLS_ERROR', 'untrusted or invalid TLS certificate', { cause: error })
  }
  if (
    code === 'ERR_SSL_WRONG_VERSION_NUMBER' ||
    /wrong version number|packet length too long/i.test(message)
  ) {
    return new JellyfinError(
      'UNREACHABLE',
      'the server does not speak TLS on this port (https vs http?)',
      { cause: error }
    )
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return new JellyfinError('TIMEOUT', 'the server did not answer in time', { cause: error })
  }
  if (UNREACHABLE_CODES.has(code) || /socket hang up/i.test(message)) {
    return new JellyfinError(
      'UNREACHABLE',
      `cannot reach the server (${code || 'closed connection'})`,
      { cause: error }
    )
  }
  if (/^ERR_(SSL|OSSL|TLS)/.test(code)) {
    return new JellyfinError('TLS_ERROR', 'TLS error', { cause: error })
  }
  return new JellyfinError('UNREACHABLE', 'network error', { cause: error })
}

// login: the call is the sign-in itself (a 401 there is a wrong password, elsewhere an expired token)
function statusError(status, { login = false } = {}) {
  if (status === 401) {
    return login
      ? new JellyfinError('BAD_CREDENTIALS', 'the server rejected the credentials', { status })
      : new JellyfinError('AUTH_EXPIRED', 'the server rejected the access token', { status })
  }
  if (status === 403 && login)
    return new JellyfinError('BAD_CREDENTIALS', 'the server rejected the credentials', { status })
  if (status === 404) return new JellyfinError('NOT_FOUND', 'not found on the server', { status })
  return new JellyfinError('UPSTREAM_ERROR', `the server answered HTTP ${status}`, { status })
}

const MAX_JSON_BYTES = 64 * 1024 * 1024
const clean = (value) => String(value ?? '').replace(/["\\\r\n]/g, '')

function toQuery(url, query) {
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value))
  }
}

export function createJellyfinClient({
  baseUrl,
  token = null,
  userId = '',
  deviceId,
  appVersion = '0.0.0',
  allowInvalidCert = false,
  headersTimeoutMs = 10000,
  bodyTimeoutMs = 30000
}) {
  const base = new URL(baseUrl)
  const basePath = base.pathname.replace(/\/+$/, '')
  const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 16 })
  const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 16,
    rejectUnauthorized: !allowInvalidCert
  })
  let closed = false

  const authorization = (withToken = true) => {
    const parts = [
      'Client="Kaizen"',
      'Device="Kaizen Desktop"',
      `DeviceId="${clean(deviceId)}"`,
      `Version="${clean(appVersion)}"`
    ]
    if (withToken && token) parts.push(`Token="${clean(token)}"`)
    return `MediaBrowser ${parts.join(', ')}`
  }

  // resolves with { req, res } as soon as the response headers are in
  function open(
    method,
    route,
    {
      query,
      headers = {},
      body,
      auth = true,
      headersTimeout = headersTimeoutMs,
      retried = false
    } = {}
  ) {
    if (closed) return Promise.reject(new JellyfinError('UNREACHABLE', 'client closed'))
    return new Promise((resolve, reject) => {
      const url = new URL(base.origin)
      url.pathname = `${basePath}${route}`
      toQuery(url, query)
      const secure = url.protocol === 'https:'
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
      let timer = null
      const req = (secure ? https : http).request(
        url,
        {
          method,
          agent: secure ? httpsAgent : httpAgent,
          headers: {
            Accept: headers.Accept || 'application/json',
            Authorization: authorization(auth),
            'User-Agent': `Kaizen/${clean(appVersion)}`,
            ...(payload
              ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
              : {}),
            ...headers
          }
        },
        (res) => {
          clearTimeout(timer)
          resolve({ req, res })
        }
      )
      timer = setTimeout(
        () => req.destroy(new JellyfinError('TIMEOUT', 'timed out waiting for the server')),
        headersTimeout
      )
      req.on('error', (error) => {
        clearTimeout(timer)
        // a kept-alive socket the server had already closed: one silent retry for idempotent calls
        if (
          !retried &&
          req.reusedSocket &&
          error?.code === 'ECONNRESET' &&
          (method === 'GET' || method === 'HEAD')
        ) {
          open(method, route, { query, headers, body, auth, headersTimeout, retried: true }).then(
            resolve,
            reject
          )
          return
        }
        reject(mapNetworkError(error))
      })
      if (payload) req.write(payload)
      req.end()
    })
  }

  function readBody(res, { maxBytes = MAX_JSON_BYTES, timeoutMs = bodyTimeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      let done = false
      const finish = (error, value) => {
        if (done) return
        done = true
        clearTimeout(timer)
        if (error) {
          res.destroy()
          reject(error)
        } else resolve(value)
      }
      const timer = setTimeout(
        () => finish(new JellyfinError('TIMEOUT', 'timed out reading the answer')),
        timeoutMs
      )
      res.on('data', (chunk) => {
        size += chunk.length
        if (size > maxBytes) finish(new JellyfinError('UPSTREAM_ERROR', 'the answer is too large'))
        else chunks.push(chunk)
      })
      res.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')))
      res.on('error', (error) => finish(mapNetworkError(error)))
      res.on('aborted', () => finish(new JellyfinError('UNREACHABLE', 'the connection was closed')))
      res.on('close', () =>
        finish(
          res.complete ? null : new JellyfinError('UNREACHABLE', 'the connection was closed'),
          Buffer.concat(chunks).toString('utf8')
        )
      )
    })
  }

  // JSON (or empty) answer; any status >= 400 throws
  async function json(method, route, options = {}) {
    const { res } = await open(method, route, options)
    const text = await readBody(res, { timeoutMs: options.bodyTimeout })
    if (res.statusCode >= 400) throw statusError(res.statusCode, options)
    if (res.statusCode >= 300)
      throw new JellyfinError('UPSTREAM_ERROR', 'unexpected redirect', { status: res.statusCode })
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch (cause) {
      throw new JellyfinError('BAD_RESPONSE', 'the server did not answer with JSON', {
        status: res.statusCode,
        cause
      })
    }
  }

  async function text(method, route, options = {}) {
    const { res } = await open(method, route, options)
    const body = await readBody(res, { timeoutMs: options.bodyTimeout, maxBytes: options.maxBytes })
    if (res.statusCode >= 400) throw statusError(res.statusCode, options)
    return body
  }

  const withUser = (query) => ({ userId, ...query })

  return {
    baseUrl: base.origin + basePath,
    userId,

    /* ---- connect ---- */
    publicInfo: () =>
      json('GET', '/System/Info/Public', { auth: false, headers: { Accept: 'application/json' } }),
    // raw variant used by connect() to follow a same-host redirect (http -> https) once
    publicInfoRaw: async () => {
      const { res } = await open('GET', '/System/Info/Public', { auth: false })
      const body = await readBody(res, { timeoutMs: 10000, maxBytes: 1024 * 1024 })
      return { status: res.statusCode, location: res.headers.location || '', body }
    },
    authenticate: (username, password) =>
      json('POST', '/Users/AuthenticateByName', {
        auth: false,
        login: true,
        body: { Username: username, Pw: password }
      }),
    logout: () => json('POST', '/Sessions/Logout', { headersTimeout: 5000, bodyTimeout: 5000 }),

    /* ---- catalog ---- */
    items: (query) => json('GET', '/Items', { query: withUser(query) }),
    // One item with its media streams. Read through the list endpoint (`ids=`) on purpose: on Jellyfin 12.2
    // `GET /Items/{id}` keeps returning the OLD UserData (played / position) after a season or series
    // was marked played / unplayed, while the list endpoints are always right.
    async item(id) {
      const data = await json('GET', '/Items', {
        query: withUser({ ids: id, Fields: ITEM_FIELDS })
      })
      const item = Array.isArray(data?.Items) ? data.Items[0] : null
      if (!item) throw new JellyfinError('NOT_FOUND', 'not found on the server', { status: 404 })
      return item
    },
    seasons: (seriesId, query = {}) =>
      json('GET', `/Shows/${seriesId}/Seasons`, { query: withUser(query) }),
    episodes: (seriesId, query = {}) =>
      json('GET', `/Shows/${seriesId}/Episodes`, { query: withUser(query) }),
    nextUp: (query = {}) => json('GET', '/Shows/NextUp', { query: withUser(query) }),
    async resume(query = {}) {
      try {
        return await json('GET', '/UserItems/Resume', { query: withUser(query) })
      } catch (error) {
        if (error.code !== 'NOT_FOUND') throw error
        // Jellyfin < 10.9
        return json('GET', `/Users/${userId}/Items/Resume`, { query })
      }
    },

    /* ---- user data ---- */
    async setPlayed(id, played) {
      const method = played ? 'POST' : 'DELETE'
      try {
        return await json(method, `/UserPlayedItems/${id}`, { query: withUser({}) })
      } catch (error) {
        if (error.code !== 'NOT_FOUND') throw error
        return json(method, `/Users/${userId}/PlayedItems/${id}`, {}) // Jellyfin < 10.9 (or really missing: 404 again)
      }
    },
    async setFavorite(id, favorite) {
      const method = favorite ? 'POST' : 'DELETE'
      try {
        return await json(method, `/UserFavoriteItems/${id}`, { query: withUser({}) })
      } catch (error) {
        if (error.code !== 'NOT_FOUND') throw error
        return json(method, `/Users/${userId}/FavoriteItems/${id}`, {})
      }
    },
    // kind: 'start' | 'progress' | 'stop'
    playback(kind, body) {
      const route = {
        start: '/Sessions/Playing',
        progress: '/Sessions/Playing/Progress',
        stop: '/Sessions/Playing/Stopped'
      }[kind]
      return json('POST', route, { body })
    },

    /* ---- media ---- */
    subtitleVtt: (itemId, mediaSourceId, index) =>
      text('GET', `/Videos/${itemId}/${mediaSourceId}/Subtitles/${index}/0/Stream.vtt`, {
        headers: { Accept: 'text/vtt, */*' },
        bodyTimeout: 120000,
        headersTimeout: 120000,
        maxBytes: 32 * 1024 * 1024
      }),
    // raw responses for the proxies (the caller pipes `res` and destroys `req` when its client goes away)
    openStream(itemId, mediaSourceId, { method = 'GET', headers = {} } = {}) {
      return open(method, `/Videos/${itemId}/stream`, {
        query: { static: 'true', mediaSourceId },
        method,
        headers: { Accept: headers.Accept || '*/*', ...headers }
      })
    },
    openImage(itemId, type, { width, quality = 85 } = {}) {
      return open('GET', `/Items/${itemId}/Images/${type}`, {
        query: { maxWidth: width, quality },
        headers: { Accept: 'image/*' }
      })
    },
    readBody,
    close() {
      closed = true
      httpAgent.destroy()
      httpsAgent.destroy()
    }
  }
}
