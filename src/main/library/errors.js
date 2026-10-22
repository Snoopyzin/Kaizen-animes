// Errors of the library HTTP API: { error: '<CODE>', message } with the status below (spec section 5).
import { JellyfinError } from './jellyfin.js'

const STATUS = {
  UNAUTHORIZED: 401,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  RANGE_NOT_SATISFIABLE: 416,
  NOT_CONNECTED: 409,
  AUTH_EXPIRED: 409,
  SERVER_UNREACHABLE: 502,
  UPSTREAM_ERROR: 502,
  BUSY: 503,
  INTERNAL: 500
}

export class ApiError extends Error {
  constructor(code, message, { status, headers } = {}) {
    super(message || code)
    this.name = 'ApiError'
    this.code = code
    this.status = status || STATUS[code] || 500
    this.headers = headers || null
  }
}

// whatever a service call threw -> ApiError (never carries upstream bodies, tokens or stack traces)
export function toApiError(error) {
  if (error instanceof ApiError) return error
  if (error instanceof JellyfinError) {
    switch (error.code) {
      case 'UNREACHABLE':
      case 'TIMEOUT':
      case 'TLS_ERROR':
        return new ApiError('SERVER_UNREACHABLE', 'the Jellyfin server is not reachable')
      case 'AUTH_EXPIRED':
      case 'BAD_CREDENTIALS':
        return new ApiError('AUTH_EXPIRED', 'the Jellyfin session expired, sign in again')
      case 'NOT_FOUND':
        return new ApiError('NOT_FOUND', 'not found')
      default:
        return new ApiError('UPSTREAM_ERROR', 'the Jellyfin server answered with an error')
    }
  }
  return new ApiError('INTERNAL', 'internal error')
}

// Redacts the per-run secret (and anything that looks like a token) from text that is about to be logged.
export function redact(text) {
  return String(text ?? '')
    .replace(/([?&](?:t|api_key|token)=)[A-Za-z0-9._~+/-]{8,}/gi, '$1***')
    .replace(/(Token=")[^"]*"/gi, '$1***"')
}

// JSON error response `{ error, message }`; never reveals more than the ApiError carries
export function sendError(res, error) {
  const api = toApiError(error)
  if (res.headersSent) {
    // too late for a status: just cut the connection so the client sees the failure
    res.destroy()
    return
  }
  for (const [name, value] of Object.entries(api.headers || {})) res.setHeader(name, value)
  res.status(api.status)
  res.set('Cache-Control', 'no-store')
  res.type('application/json')
  res.send(JSON.stringify({ error: api.code, message: api.message }))
}
