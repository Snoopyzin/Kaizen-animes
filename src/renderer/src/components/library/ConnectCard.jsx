import { useEffect, useId, useRef, useState } from 'react'
import { ExclamationTriangleIcon, LockClosedIcon } from '@radix-ui/react-icons'
import { Spinner } from '@radix-ui/themes'
import { BRAND } from '../../brand'
import { t } from '../../i18n'
import { connectServer } from '../../library/api'
import { errorMessage } from '../../library/errors'
import { usesPlainHttp } from '../../library/lib'

const inputClass =
  'w-full rounded-md border border-gray-700 bg-[#18181b] px-3 py-2 font-space-mono text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-400 disabled:opacity-60'

// Connect the library to the user's Jellyfin server.
//  mode="connect"    empty form (first connection, or "change server")
//  mode="reconnect"  the session expired (AUTH_EXPIRED): the server is fixed and the user name is
//                    prefilled, only the password is missing
// The password lives in this component's state only until the call returns, and is never stored.
export default function ConnectCard({
  mode = 'connect',
  server = null,
  onConnected,
  onCancel,
  className = ''
}) {
  const reconnect = mode === 'reconnect' && !!server
  const ids = { url: useId(), user: useId(), pass: useId() }

  const [url, setUrl] = useState(reconnect ? server.url || server.host || '' : '')
  const [username, setUsername] = useState(reconnect ? server.userName || '' : '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  // the saved address is fixed; with only a host (no scheme) it stays editable so https can be typed
  const [serverLocked, setServerLocked] = useState(reconnect && !!server?.url)
  const [trusted, setTrusted] = useState(reconnect && server.allowInvalidCert === true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needPassword, setNeedPassword] = useState(false)

  // The password of the attempt that hit an untrusted certificate. Kept only while that question is
  // on screen, so "trust anyway" is one click; cleared as soon as it is used or anything changes.
  const pending = useRef(null)
  const alive = useRef(true)
  const passwordField = useRef(null)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      pending.current = null
    }
  }, [])

  const forgetPending = () => {
    pending.current = null
    if (error === 'TLS_ERROR') setError('')
  }

  async function attempt(trust) {
    if (busy) return
    if (trust && !pending.current && !password && !needPassword) {
      // the saved password is gone (a field was edited): ask for it again
      setNeedPassword(true)
      passwordField.current?.focus()
      return
    }
    const secret = trust && pending.current ? pending.current.password : password
    pending.current = null
    setBusy(true)
    setError('')
    setNeedPassword(false)

    const result = await connectServer({
      url: url.trim(),
      username: username.trim(),
      password: secret,
      allowInvalidCert: trust || trusted
    })
    if (!alive.current) return

    setPassword('') // never keep it longer than needed
    setBusy(false)
    if (result.ok) {
      onConnected?.(result.server)
      return
    }
    if (trust) setTrusted(true)
    if (result.error === 'TLS_ERROR' && !trust && !trusted) {
      pending.current = { password: secret } // for the "trust anyway" click
    }
    setError(result.error)
  }

  const submit = (event) => {
    event.preventDefault()
    attempt(false)
  }

  const canSubmit = !busy && url.trim() !== '' && username.trim() !== ''
  const plainHttp = usesPlainHttp(url)
  const tls = error === 'TLS_ERROR' && !trusted

  return (
    <form
      onSubmit={submit}
      className={`w-full max-w-md rounded-lg border border-gray-700 bg-black/60 p-6 font-space-mono backdrop-blur ${className}`}
    >
      <p className="mb-1 text-lg font-bold">
        {reconnect ? t('library.connect.reconnectTitle') : t('library.connect.title')}
      </p>
      <p className="mb-2 text-xs leading-relaxed text-gray-400">
        {reconnect
          ? t('library.connect.reconnectIntro', {
              server: server.name || server.host || '',
              user: server.userName || ''
            })
          : t('library.connect.intro', { app: BRAND.name })}
      </p>
      {!reconnect && (
        <a
          href="https://jellyfin.org"
          target="_blank"
          rel="noreferrer"
          className="mb-5 inline-block text-xs text-purple-400 underline-offset-2 hover:underline"
        >
          {t('library.connect.learnMore')}
        </a>
      )}

      <div className={`flex flex-col gap-y-3 ${reconnect ? 'mt-4' : ''}`}>
        <div className="flex flex-col gap-y-1 text-xs text-gray-400">
          <label htmlFor={ids.url}>{t('library.connect.server')}</label>
          {serverLocked ? (
            <div className="flex items-center justify-between gap-x-3 rounded-md border border-gray-800 bg-[#18181b] px-3 py-2 text-sm text-gray-200">
              <span id={ids.url} className="truncate" title={url}>
                {server?.name ? `${server.name} · ` : ''}
                {url}
              </span>
              <button
                type="button"
                onClick={() => setServerLocked(false)}
                className="shrink-0 text-xs text-purple-400 underline-offset-2 hover:underline"
              >
                {t('library.connect.changeServer')}
              </button>
            </div>
          ) : (
            <input
              id={ids.url}
              className={inputClass}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                forgetPending()
              }}
              placeholder="http://192.168.0.10:8096"
              autoComplete="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="url"
              maxLength={2048}
              disabled={busy}
              required
            />
          )}
          {plainHttp && (
            <p className="mt-1 flex items-start gap-x-1.5 text-xs text-gray-500">
              <LockClosedIcon className="mt-0.5 shrink-0" aria-hidden="true" />
              {t('library.connect.httpNote')}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-y-1 text-xs text-gray-400">
          <label htmlFor={ids.user}>{t('library.connect.username')}</label>
          <input
            id={ids.user}
            className={inputClass}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value)
              forgetPending()
            }}
            autoComplete="username"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={256}
            disabled={busy}
            required
          />
        </div>

        <div className="flex flex-col gap-y-1 text-xs text-gray-400">
          <label htmlFor={ids.pass}>{t('library.connect.password')}</label>
          <div className="relative">
            <input
              id={ids.pass}
              ref={passwordField}
              className={`${inputClass} pr-20`}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setNeedPassword(false)
                forgetPending()
              }}
              autoComplete="current-password"
              maxLength={1024}
              disabled={busy}
              aria-describedby={needPassword ? `${ids.pass}-hint` : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-white"
            >
              {showPassword ? t('library.connect.hidePassword') : t('library.connect.showPassword')}
            </button>
          </div>
          {needPassword && (
            <p id={`${ids.pass}-hint`} className="text-xs text-amber-300">
              {t('library.connect.tls.passwordAgain')}
            </p>
          )}
        </div>
      </div>

      {error && !tls && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-x-2 rounded border border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-300"
        >
          <ExclamationTriangleIcon className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{errorMessage(error)}</span>
        </p>
      )}

      {tls && (
        <div
          role="alert"
          className="mt-4 rounded border border-amber-800 bg-amber-950/40 px-3 py-3 text-xs text-amber-100"
        >
          <p className="mb-1 flex items-center gap-x-2 font-bold">
            <ExclamationTriangleIcon aria-hidden="true" />
            {t('library.connect.tls.title')}
          </p>
          <p className="mb-3 leading-relaxed text-amber-200/90">{t('library.connect.tls.body')}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => attempt(true)}
            className="rounded-md border border-amber-600 px-3 py-1.5 text-amber-100 transition-colors hover:bg-amber-700/30 disabled:opacity-60"
          >
            {t('library.connect.tls.trust')}
          </button>
        </div>
      )}

      {trusted && <p className="mt-3 text-xs text-gray-500">{t('library.connect.trusted')}</p>}

      <div className="mt-5 flex items-center gap-x-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="flex flex-1 items-center justify-center gap-x-2 rounded-md bg-purple-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-purple-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy && <Spinner size="2" />}
          {busy ? t('library.connect.submitting') : t('library.connect.submit')}
        </button>
        {onCancel && (
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-md border border-gray-700 px-4 py-2.5 text-sm text-gray-300 transition-colors hover:border-purple-400 disabled:opacity-60"
          >
            {t('library.connect.cancel')}
          </button>
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-gray-500">
        {t('library.connect.passwordNote', { app: BRAND.name })}
      </p>
    </form>
  )
}
