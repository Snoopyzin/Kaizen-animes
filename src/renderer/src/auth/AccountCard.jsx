import { useState } from 'react'
import { format } from 'date-fns'
import { useAuth } from './AuthContext'
import * as api from './api'
import { errorMessage } from './LoginPage'
import { t, dateLocale } from '../i18n'
import LanguageSwitcher from '../i18n/LanguageSwitcher'
import { normalizeInstagram } from './follow'

const inputClass =
  'w-full rounded-md border border-gray-700 bg-[#18181b] px-3 py-2 font-space-mono text-sm text-white outline-none focus:border-purple-400'

// Account section for the settings page: plan/subscription, language, password and sign out.
export default function AccountCard() {
  const { me, logout, refresh } = useAuth()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [igOpen, setIgOpen] = useState(false)
  const [ig, setIg] = useState('')
  const [message, setMessage] = useState(null) // { ok, text }

  if (!me) return null
  const sub = me.subscription || {}
  const isAdmin = me.role === 'admin'
  // only servers that know the follow policy send these fields
  const hasFollow = !isAdmin && 'instagram' in me
  const followLabel =
    me.follow === 'follower'
      ? t('auth.account.follow.follower')
      : me.follow === 'not_follower'
        ? t('auth.account.follow.not_follower')
        : t('auth.account.follow.unknown')

  async function saveInstagram(e) {
    e.preventDefault()
    setMessage(null)
    const handle = normalizeInstagram(ig)
    if (!handle) return setMessage({ ok: false, text: t('auth.errors.INSTAGRAM_INVALID') })
    try {
      await api.setInstagram(handle)
      await refresh()
      setIg('')
      setIgOpen(false)
      setMessage({ ok: true, text: t('auth.account.instagramSaved') })
    } catch (error) {
      setMessage({ ok: false, text: errorMessage(error) })
    }
  }

  async function changePassword(e) {
    e.preventDefault()
    setMessage(null)
    if (next.length < 8) return setMessage({ ok: false, text: t('auth.errors.PASSWORD_SHORT') })
    try {
      await api.changePassword(current, next)
      setCurrent('')
      setNext('')
      setOpen(false)
      setMessage({ ok: true, text: t('auth.account.passwordChanged') })
      // a password change invalidates the old token; sign in again with the new password
      setTimeout(logout, 1500)
    } catch (error) {
      setMessage({
        ok: false,
        text: error.code === 'INVALID_CREDENTIALS' ? t('auth.errors.WRONG_PASSWORD') : errorMessage(error)
      })
    }
  }

  const row = (label, value) => (
    <div className="flex justify-between gap-x-4 font-space-mono text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )

  return (
    <div className="flex max-w-xl flex-col gap-y-3 rounded-md border border-gray-700 p-4">
      <p className="font-space-mono text-base font-bold">{t('auth.account.title')}</p>
      {row(t('auth.account.email'), me.email)}
      {isAdmin
        ? row(t('auth.account.status'), t('auth.account.admin'))
        : (
          <>
            {row(t('auth.account.status'), t(`auth.account.status.${sub.status || 'none'}`))}
            {row(t('auth.account.plan'), sub.plan?.name || t('auth.account.noPlan'))}
            {sub.expires_at &&
              row(
                t('auth.account.expires'),
                `${format(new Date(sub.expires_at), 'PP', { locale: dateLocale() })} (${t('auth.account.daysLeft', { days: sub.days_left })})`
              )}
          </>
        )}
      {hasFollow && row(t('auth.account.instagram'), me.instagram ? `@${me.instagram}` : '-')}
      {hasFollow && row(t('auth.account.follow'), followLabel)}
      <div className="flex items-center justify-between gap-x-4 font-space-mono text-sm">
        <span className="text-gray-500">{t('auth.account.language')}</span>
        <LanguageSwitcher />
      </div>

      {message && (
        <p className={`font-space-mono text-xs ${message.ok ? 'text-green-400' : 'text-red-400'}`}>
          {message.text}
        </p>
      )}

      {open && (
        <form onSubmit={changePassword} className="flex flex-col gap-y-2">
          <input
            className={inputClass}
            type="password"
            placeholder={t('auth.account.currentPassword')}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
          <input
            className={inputClass}
            type="password"
            placeholder={t('auth.account.newPassword')}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            required
          />
          <button
            type="submit"
            className="self-start rounded-md bg-purple-600 px-3 py-1.5 font-space-mono text-xs font-bold hover:bg-purple-500"
          >
            {t('auth.account.save')}
          </button>
        </form>
      )}

      {hasFollow && igOpen && (
        <form onSubmit={saveInstagram} className="flex flex-col gap-y-2">
          <input
            className={inputClass}
            placeholder="@usuario"
            value={ig}
            onChange={(e) => setIg(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={60}
            required
          />
          <button
            type="submit"
            className="self-start rounded-md bg-purple-600 px-3 py-1.5 font-space-mono text-xs font-bold hover:bg-purple-500"
          >
            {t('auth.account.instagramSave')}
          </button>
        </form>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-gray-700 px-3 py-1.5 font-space-mono text-xs hover:border-purple-400"
        >
          {t('auth.account.changePassword')}
        </button>
        {hasFollow && (
          <button
            onClick={() => setIgOpen((v) => !v)}
            className="rounded-md border border-gray-700 px-3 py-1.5 font-space-mono text-xs hover:border-purple-400"
          >
            {t('auth.account.changeInstagram')}
          </button>
        )}
        <button
          onClick={logout}
          className="rounded-md border border-red-900 px-3 py-1.5 font-space-mono text-xs text-red-300 hover:bg-red-950/40"
        >
          {t('auth.account.signOut')}
        </button>
      </div>
    </div>
  )
}
