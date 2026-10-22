import { useAuth } from './AuthContext'
import { t } from '../i18n'

// Small floating reminder: free-trial days, a subscription about to expire, or offline mode.
export default function StatusPill() {
  const { me, offline } = useAuth()
  const sub = me?.subscription
  let text = ''
  if (offline) text = t('auth.pill.offline')
  else if (me?.role !== 'admin' && sub?.status === 'trial')
    text = t('auth.pill.trial', { days: sub.days_left })
  else if (me?.role !== 'admin' && sub?.status === 'active' && sub.days_left <= 3)
    text = t('auth.pill.expiring', { days: sub.days_left })
  if (!text) return null
  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-[60] rounded-full border border-purple-700 bg-black/80 px-3 py-1 font-space-mono text-xs text-purple-200 shadow-lg">
      {text}
    </div>
  )
}
