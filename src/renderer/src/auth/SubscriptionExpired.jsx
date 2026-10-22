import { useEffect, useState } from 'react'
import AuthShell from './AuthShell'
import { useAuth } from './AuthContext'
import * as api from './api'
import { t, getLanguage } from '../i18n'
import LanguageSwitcher from '../i18n/LanguageSwitcher'

const money = (cents, currency = 'BRL') =>
  new Intl.NumberFormat(getLanguage() === 'en' ? 'en-US' : 'pt-BR', {
    style: 'currency',
    currency
  }).format(cents / 100)

// Shown when the account has no active subscription (expired trial / lapsed payment).
export default function SubscriptionExpired() {
  const { me, logout, refresh } = useAuth()
  const [plans, setPlans] = useState([])
  const [support, setSupport] = useState('')
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    api
      .plans()
      .then((p) => setPlans(Array.isArray(p) ? p : p?.plans || []))
      .catch(() => {})
    api
      .publicSettings()
      .then((s) => setSupport(s?.support_contact || ''))
      .catch(() => {})
  }, [])

  const blocked = me?.subscription?.status === 'blocked'

  async function recheck() {
    setChecking(true)
    await refresh()
    setChecking(false)
  }

  return (
    <AuthShell top={<LanguageSwitcher />}>
      <div className="w-full rounded-lg border border-gray-700 bg-black/60 p-6 backdrop-blur">
        <p className="mb-1 font-space-mono text-lg font-bold">
          {blocked ? t('auth.expired.blockedTitle') : t('auth.expired.title')}
        </p>
        <p className="mb-4 font-space-mono text-xs text-gray-400">
          {blocked
            ? t('auth.expired.blockedBody')
            : t('auth.expired.body', { email: me?.email || '' })}
        </p>

        {!blocked && plans.length > 0 && (
          <div className="mb-4 flex flex-col gap-y-2">
            {plans.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-md border border-gray-700 px-3 py-2 font-space-mono text-sm"
              >
                <span>
                  {p.name}
                  <span className="ml-2 text-xs text-gray-500">
                    {t('auth.expired.days', { days: p.interval_days })}
                  </span>
                </span>
                <span className="font-bold text-purple-300">{money(p.price_cents, p.currency)}</span>
              </div>
            ))}
          </div>
        )}

        {support && (
          <p className="mb-4 rounded border border-purple-900 bg-purple-950/30 px-3 py-2 font-space-mono text-xs text-purple-200">
            {t('auth.expired.contact')} {support}
          </p>
        )}

        <div className="flex gap-x-2">
          <button
            onClick={recheck}
            disabled={checking}
            className="flex-1 rounded-md bg-purple-600 px-4 py-2 font-space-mono text-sm font-bold hover:bg-purple-500 disabled:opacity-60"
          >
            {checking ? t('auth.wait') : t('auth.expired.recheck')}
          </button>
          <button
            onClick={logout}
            className="rounded-md border border-gray-700 px-4 py-2 font-space-mono text-sm text-gray-300 hover:border-purple-400"
          >
            {t('auth.logout')}
          </button>
        </div>
      </div>
    </AuthShell>
  )
}
