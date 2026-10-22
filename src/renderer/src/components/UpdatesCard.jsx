import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Switch } from '@radix-ui/themes'
import { t, dateLocale } from '../i18n'
import { autoCheckEnabled, setAutoCheck } from '../utils/updateNotice'

const ERRORS = {
  NO_RELEASE: () => t('updates.noRelease'),
  RATE_LIMITED: () => t('updates.rateLimited'),
  NETWORK: () => t('updates.network')
}

const linkClass =
  'rounded-md border border-gray-700 px-3 py-1.5 font-space-mono text-xs hover:border-purple-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400'

// "Atualizações" section of the settings: installed version, a button that asks GitHub for the latest
// release and, when there is a newer one, its notes and the links to download it.
export default function UpdatesCard() {
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState(null)
  const [auto, setAuto] = useState(() => autoCheckEnabled())

  useEffect(() => {
    window.api?.appVersion?.().then(setVersion).catch(() => {})
  }, [])

  async function check() {
    setChecking(true)
    try {
      setResult(await window.api.checkForUpdate())
    } catch {
      setResult({ ok: false, error: 'UNKNOWN' })
    } finally {
      setChecking(false)
    }
  }

  const published =
    result?.ok && result.publishedAt
      ? format(new Date(result.publishedAt), 'PP', { locale: dateLocale() })
      : ''

  return (
    <div className="flex max-w-xl flex-col gap-y-3 rounded-md border border-gray-700 p-4 font-space-mono text-sm">
      <p className="text-base font-bold">{t('updates.title')}</p>
      <div className="flex items-center justify-between gap-x-4">
        <span className="text-gray-500">{t('updates.installed')}</span>
        <span>{version || '-'}</span>
      </div>
      <div className="flex items-center justify-between gap-x-4">
        <div>
          <p>{t('updates.auto')}</p>
          <p className="text-xs text-gray-500">{t('updates.autoDesc')}</p>
        </div>
        <Switch
          checked={auto}
          style={{ cursor: 'pointer' }}
          aria-label={t('updates.auto')}
          onCheckedChange={(value) => {
            setAuto(value)
            setAutoCheck(value)
          }}
        />
      </div>

      <div>
        <button
          type="button"
          onClick={check}
          disabled={checking}
          className="rounded-md bg-purple-600 px-3 py-1.5 text-xs font-bold hover:bg-purple-500 disabled:opacity-60"
        >
          {checking ? t('updates.checking') : t('updates.check')}
        </button>
      </div>

      <div aria-live="polite">
        {result && !result.ok && (
          <p className="text-xs text-yellow-300">{(ERRORS[result.error] || (() => t('updates.error')))()}</p>
        )}
        {result?.ok && !result.hasUpdate && (
          <p className="text-xs text-green-400">{t('updates.upToDate', { version: result.current })}</p>
        )}
        {result?.ok && result.hasUpdate && (
          <div className="flex flex-col gap-y-2">
            <p className="font-bold text-purple-300">{t('updates.available', { version: result.latest })}</p>
            {published && <p className="text-xs text-gray-500">{t('updates.published', { date: published })}</p>}
            {result.notes && (
              <div>
                <p className="mb-1 text-xs text-gray-500">{t('updates.notes')}</p>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-gray-800 bg-[#18181b] p-2 text-xs text-gray-300">
                  {result.notes}
                </pre>
              </div>
            )}
            <p className="text-xs text-gray-500">{t('updates.howTo')}</p>
            <div className="flex flex-wrap gap-2">
              {result.downloadUrl && (
                <a href={result.downloadUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
                  {t('updates.download')}
                </a>
              )}
              <a href={result.pageUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
                {t('updates.release')}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
