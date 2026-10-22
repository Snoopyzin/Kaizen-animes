import { t } from '../../i18n'

// Thin bar glued to the bottom of a poster / thumbnail. Renders nothing for 0 %.
export default function ProgressBar({ percent = 0, label }) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0))
  if (value <= 0) return null
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-label={label || t('library.progress.aria', { percent: Math.round(value) })}
      className="absolute inset-x-0 bottom-0 h-1 bg-black/70"
    >
      <div className="h-full bg-purple-500" style={{ width: `${value}%` }} />
    </div>
  )
}
