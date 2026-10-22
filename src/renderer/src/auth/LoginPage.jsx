import { useEffect, useState } from 'react'
import AuthShell from './AuthShell'
import { useAuth } from './AuthContext'
import * as api from './api'
import { BRAND } from '../brand'
import { t } from '../i18n'
import LanguageSwitcher from '../i18n/LanguageSwitcher'
import { normalizeInstagram } from './follow'

const ERROR_CODES = [
  'INVALID_CREDENTIALS',
  'ACCOUNT_BLOCKED',
  'NOT_FOLLOWING',
  'INSTAGRAM_IN_USE',
  'TOO_MANY_ATTEMPTS',
  'EMAIL_TAKEN',
  'REGISTRATION_CLOSED',
  'VALIDATION',
  'NETWORK'
]

export const errorMessage = (error) => {
  // the server reports bad input as VALIDATION_ERROR (+ the field); the Instagram @ has its own text
  if (error?.code === 'VALIDATION_ERROR')
    return error.field === 'instagram' ? t('auth.errors.INSTAGRAM_INVALID') : t('auth.errors.VALIDATION')
  return ERROR_CODES.includes(error?.code) ? t(`auth.errors.${error.code}`) : t('auth.errors.UNKNOWN')
}

const inputClass =
  'w-full rounded-md border border-gray-700 bg-[#18181b] px-3 py-2 font-space-mono text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-purple-400'

export default function LoginPage() {
  const { login, register } = useAuth()
  const [mode, setMode] = useState('login') // login | register
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [registrationOpen, setRegistrationOpen] = useState(true)
  const [showServer, setShowServer] = useState(false)
  const [server, setServer] = useState(api.getServerUrl())
  const [instagram, setInstagram] = useState('')
  // the owner's follow policy: when `required`, sign-up asks for the user's Instagram @
  const [follow, setFollow] = useState({ required: false, handle: '' })

  useEffect(() => {
    api
      .publicSettings()
      .then((s) => setRegistrationOpen(s?.registration_open !== false))
      .catch(() => {})
    api
      .followInfo()
      .then((f) => setFollow({ required: f?.required === true, handle: String(f?.handle || '') }))
      .catch(() => {})
  }, [])

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (mode === 'register' && password.length < 8) {
      setError(t('auth.errors.PASSWORD_SHORT'))
      return
    }
    let handle = null
    if (mode === 'register' && follow.required) {
      handle = normalizeInstagram(instagram)
      if (!handle) {
        setError(t(instagram.trim() ? 'auth.errors.INSTAGRAM_INVALID' : 'auth.errors.INSTAGRAM_REQUIRED'))
        return
      }
    }
    setBusy(true)
    try {
      if (mode === 'login') await login(email.trim(), password)
      else await register(name.trim(), email.trim(), password, handle)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function saveServer() {
    api.setServerUrl(server.trim() === api.DEFAULT_SERVER ? '' : server.trim())
    setShowServer(false)
    setError('')
  }

  return (
    <AuthShell top={<LanguageSwitcher />}>
      <form
        onSubmit={submit}
        className="w-full rounded-lg border border-gray-700 bg-black/60 p-6 backdrop-blur"
      >
        <p className="mb-1 font-space-mono text-lg font-bold">
          {mode === 'login' ? t('auth.login.title') : t('auth.register.title')}
        </p>
        <p className="mb-5 font-space-mono text-xs text-gray-400">
          {mode === 'login'
            ? t('auth.login.subtitle', { app: BRAND.name })
            : t('auth.register.subtitle')}
        </p>

        <div className="flex flex-col gap-y-3">
          {mode === 'register' && (
            <label className="flex flex-col gap-y-1 font-space-mono text-xs text-gray-400">
              {t('auth.fields.name')}
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                maxLength={80}
                required
              />
            </label>
          )}
          <label className="flex flex-col gap-y-1 font-space-mono text-xs text-gray-400">
            {t('auth.fields.email')}
            <input
              className={inputClass}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          {mode === 'register' && follow.required && (
            <label className="flex flex-col gap-y-1 font-space-mono text-xs text-gray-400">
              {t('auth.fields.instagram')}
              <input
                className={inputClass}
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
                placeholder="@usuario"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={60}
                required
              />
              <span className="text-gray-500">
                {follow.handle ? t('auth.register.instagramHint', { handle: `@${follow.handle}` }) : t('auth.register.instagramHintPlain')}
                {follow.handle && (
                  <>
                    {' '}
                    <a
                      href={`https://www.instagram.com/${follow.handle}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-purple-400 underline-offset-2 hover:underline"
                    >
                      {t('auth.register.instagramOpen')}
                    </a>
                  </>
                )}
              </span>
            </label>
          )}
          <label className="flex flex-col gap-y-1 font-space-mono text-xs text-gray-400">
            {t('auth.fields.password')}
            <div className="relative">
              <input
                className={`${inputClass} pr-16`}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                maxLength={128}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-white"
              >
                {showPassword ? t('auth.hide') : t('auth.show')}
              </button>
            </div>
          </label>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-3 rounded border border-red-900 bg-red-950/50 px-3 py-2 font-space-mono text-xs text-red-300"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 w-full rounded-md bg-purple-600 px-4 py-2.5 font-space-mono text-sm font-bold text-white transition-colors hover:bg-purple-500 disabled:opacity-60"
        >
          {busy
            ? t('auth.wait')
            : mode === 'login'
              ? t('auth.login.submit')
              : t('auth.register.submit')}
        </button>

        {registrationOpen && (
          <p className="mt-4 text-center font-space-mono text-xs text-gray-400">
            {mode === 'login' ? t('auth.login.noAccount') : t('auth.register.haveAccount')}{' '}
            <button
              type="button"
              className="text-purple-400 underline-offset-2 hover:underline"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login')
                setError('')
              }}
            >
              {mode === 'login' ? t('auth.login.createOne') : t('auth.register.signIn')}
            </button>
          </p>
        )}
      </form>

      <div className="font-space-mono text-xs text-gray-600">
        <button type="button" onClick={() => setShowServer((v) => !v)} className="hover:text-gray-400">
          {t('auth.server.toggle')}
        </button>
        {showServer && (
          <div className="mt-2 flex gap-x-2">
            <input
              className={`${inputClass} w-64`}
              value={server}
              onChange={(e) => setServer(e.target.value)}
            />
            <button
              type="button"
              onClick={saveServer}
              className="rounded-md border border-gray-700 px-3 text-gray-300 hover:border-purple-400"
            >
              {t('auth.server.save')}
            </button>
          </div>
        )}
      </div>
    </AuthShell>
  )
}
