import { useEffect } from 'react'
import { toast } from 'sonner'
import { t } from '../i18n'
import { BRAND } from '../brand'
import {
  LAST_CHECK_KEY,
  NOTIFIED_KEY,
  autoCheckEnabled,
  recall,
  remember,
  shouldCheckNow,
  shouldNotify
} from '../utils/updateNotice'

// A little after the app opens (and at most every few hours) look for a newer version and, once per
// version, show a toast that leads to the settings page. Silent when offline or when nothing is new.
export default function useUpdateNotice(goToSettings) {
  useEffect(() => {
    if (!window.api?.checkForUpdate) return undefined
    if (!shouldCheckNow({ enabled: autoCheckEnabled(), last: recall(LAST_CHECK_KEY), now: Date.now() })) {
      return undefined
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      const result = await window.api.checkForUpdate().catch(() => null)
      if (cancelled || !result) return
      remember(LAST_CHECK_KEY, Date.now())
      if (!shouldNotify(result, recall(NOTIFIED_KEY))) return
      remember(NOTIFIED_KEY, result.latest)
      toast(t('updates.toastTitle', { app: BRAND.name, version: result.latest }), {
        duration: 20000,
        action: { label: t('updates.toastAction'), onClick: goToSettings }
      })
    }, 8000) // let the app settle first
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
