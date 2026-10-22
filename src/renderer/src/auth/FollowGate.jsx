import { useEffect, useState } from 'react'
import { InstagramLogoIcon } from '@radix-ui/react-icons'
import AuthShell from './AuthShell'
import { t } from '../i18n'
import { FOLLOW_WAIT_SECONDS, INSTAGRAM_HANDLE, INSTAGRAM_URL, followStatus } from './follow'

// Shown once, before the app: open the creator's Instagram, wait a few seconds, continue.
export default function FollowGate({ onUnlock }) {
  const [opened, setOpened] = useState(false)
  const [left, setLeft] = useState(FOLLOW_WAIT_SECONDS)

  // the countdown only starts after the profile was opened
  useEffect(() => {
    if (!opened || left <= 0) return
    const timer = setTimeout(() => setLeft((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [opened, left])

  const { ready, hint: hintKey } = followStatus(opened, left)
  const hint =
    hintKey === 'openFirst' ? t('follow.openFirst') : hintKey === 'wait' ? t('follow.wait', { seconds: left }) : ''

  return (
    <AuthShell>
      <div className="w-full rounded-lg border border-gray-700 bg-black/60 p-6 font-space-mono backdrop-blur">
        <p className="mb-2 text-center text-lg font-bold">{t('follow.title')}</p>
        <p className="mb-5 text-center text-sm text-gray-400">
          {t('follow.body', { handle: INSTAGRAM_HANDLE })}
        </p>

        <a
          href={INSTAGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setOpened(true)}
          className="flex items-center justify-center gap-x-2 rounded-md border border-purple-500/70 px-4 py-3 text-sm transition-all hover:border-purple-400 hover:bg-purple-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
        >
          <InstagramLogoIcon width={18} height={18} />
          {t('follow.open', { handle: INSTAGRAM_HANDLE })}
        </a>

        <button
          type="button"
          disabled={!ready}
          onClick={onUnlock}
          className={`mt-3 w-full rounded-md border px-4 py-3 text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
            ready
              ? 'border-purple-500 bg-purple-600 text-white hover:bg-purple-500'
              : 'cursor-not-allowed border-gray-700 text-gray-500'
          }`}
        >
          {t('follow.confirm')}
        </button>

        <p className="mt-2 min-h-[1rem] text-center text-xs text-gray-500" aria-live="polite">
          {hint}
        </p>
        <p className="mt-3 text-center text-xs text-gray-600">{t('follow.privacy')}</p>
      </div>
    </AuthShell>
  )
}
