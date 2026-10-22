// Client for the Kaizen account/billing server (see /Kaizen-Server).
const TOKEN_KEY = 'kaizen-token'
const ME_CACHE_KEY = 'kaizen-me-cache'
const SERVER_KEY = 'kaizen-server-url'

export const DEFAULT_SERVER = import.meta.env?.VITE_KAIZEN_SERVER || 'http://localhost:8080'

const safe = (fn, fallback = null) => {
  try {
    return fn()
  } catch {
    return fallback
  }
}

export const getServerUrl = () =>
  (safe(() => localStorage.getItem(SERVER_KEY)) || DEFAULT_SERVER).replace(/\/+$/, '')
export const setServerUrl = (url) =>
  safe(() => (url ? localStorage.setItem(SERVER_KEY, url) : localStorage.removeItem(SERVER_KEY)))

export const getToken = () => safe(() => localStorage.getItem(TOKEN_KEY))
export const setToken = (token) => safe(() => localStorage.setItem(TOKEN_KEY, token))
export const cacheMe = (me) =>
  safe(() => localStorage.setItem(ME_CACHE_KEY, JSON.stringify({ me, checkedAt: Date.now() })))
export const readCachedMe = () => safe(() => JSON.parse(localStorage.getItem(ME_CACHE_KEY)))
export const clearSession = () =>
  safe(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(ME_CACHE_KEY)
  })

export class ApiError extends Error {
  constructor(code, message, status, field) {
    super(message || code)
    this.code = code
    this.status = status
    this.field = field // set by the server on validation errors: which input is wrong
  }
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (auth && token) headers.Authorization = `Bearer ${token}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  let response
  try {
    response = await fetch(`${getServerUrl()}/api${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    })
  } catch {
    throw new ApiError('NETWORK', 'Server unreachable', 0)
  } finally {
    clearTimeout(timer)
  }

  let data = null
  try {
    data = await response.json()
  } catch {
    /* empty body */
  }
  if (!response.ok) {
    throw new ApiError(
      data?.code || (response.status === 401 ? 'UNAUTHORIZED' : 'UNKNOWN'),
      data?.error || data?.message,
      response.status,
      data?.field
    )
  }
  return data
}

export const login = (email, password) =>
  request('/auth/login', { method: 'POST', body: { email, password }, auth: false })
export const register = (name, email, password, instagram) =>
  request('/auth/register', {
    method: 'POST',
    body: { name, email, password, ...(instagram ? { instagram } : {}) },
    auth: false
  })
// Instagram follow policy of the server: { required, handle } (handle = the profile people must follow)
export const followInfo = () => request('/public/follow', { auth: false })
export const setInstagram = (instagram) =>
  request('/auth/instagram', { method: 'PATCH', body: { instagram } })
// the server answers { me: {...} }; the rest of the app works with the account object itself
export const me = async () => {
  const data = await request('/auth/me')
  return data?.me ?? data
}
export const changePassword = (current_password, new_password) =>
  request('/auth/change-password', { method: 'POST', body: { current_password, new_password } })
export const plans = () => request('/plans', { auth: false })
export const publicSettings = () => request('/public-settings', { auth: false })
