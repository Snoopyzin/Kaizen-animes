import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as api from './api'
import { AUTH_ENABLED } from './config'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

const OFFLINE_GRACE_MS = 48 * 60 * 60 * 1000 // keep working this long if the server is unreachable
const REFRESH_MS = 10 * 60 * 1000

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', me: null, offline: false })

  const verify = useCallback(async () => {
    if (!AUTH_ENABLED) return
    if (!api.getToken()) {
      setState({ status: 'anonymous', me: null, offline: false })
      return
    }
    try {
      const me = await api.me()
      api.cacheMe(me)
      setState({ status: 'authenticated', me, offline: false })
    } catch (error) {
      if (error.code === 'NETWORK') {
        const cached = api.readCachedMe()
        if (cached?.me && Date.now() - cached.checkedAt < OFFLINE_GRACE_MS) {
          setState({ status: 'authenticated', me: cached.me, offline: true })
          return
        }
        setState({ status: 'anonymous', me: null, offline: false })
        return
      }
      api.clearSession() // invalid/expired token, blocked account...
      setState({ status: 'anonymous', me: null, offline: false })
    }
  }, [])

  useEffect(() => {
    verify()
  }, [verify])

  // re-check the subscription periodically and when the window regains focus
  useEffect(() => {
    if (state.status !== 'authenticated') return
    const timer = setInterval(verify, REFRESH_MS)
    window.addEventListener('focus', verify)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', verify)
    }
  }, [state.status, verify])

  const startSession = useCallback((token, me) => {
    api.setToken(token)
    api.cacheMe(me)
    setState({ status: 'authenticated', me, offline: false })
  }, [])

  const value = useMemo(
    () => ({
      ...state,
      refresh: verify,
      async login(email, password) {
        const { token, me } = await api.login(email, password)
        startSession(token, me)
      },
      async register(name, email, password, instagram) {
        const { token, me } = await api.register(name, email, password, instagram)
        startSession(token, me)
      },
      logout() {
        api.clearSession()
        setState({ status: 'anonymous', me: null, offline: false })
      }
    }),
    [state, verify, startSession]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
