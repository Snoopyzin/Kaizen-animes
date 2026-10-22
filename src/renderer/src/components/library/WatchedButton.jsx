import { CheckCircledIcon, CircleIcon } from '@radix-ui/react-icons'
import { t } from '../../i18n'

// "Assistido" toggle.
//  variant="icon"    round tick at the end of an episode row
//  variant="labeled" button with text (movie page, "mark everything" on the series page)
export default function WatchedButton({
  watched = false,
  onToggle,
  title = '',
  variant = 'icon',
  labelWatched,
  labelUnwatched,
  disabled = false,
  className = ''
}) {
  const on = watched === true
  if (variant === 'labeled') {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className={`flex items-center gap-x-2 rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 transition-colors hover:border-purple-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 disabled:opacity-50 ${className}`}
      >
        {on ? <CircleIcon /> : <CheckCircledIcon />}
        {on ? labelUnwatched : labelWatched}
      </button>
    )
  }
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      aria-label={
        on
          ? t('librarySeries.watched.markUnwatched', { title })
          : t('librarySeries.watched.markWatched', { title })
      }
      title={on ? t('librarySeries.watched.watched') : t('librarySeries.watched.unwatched')}
      onClick={onToggle}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 disabled:opacity-50 ${
        on
          ? 'border-green-600/60 bg-green-600/15 text-green-400 hover:bg-green-600/25'
          : 'border-gray-700 text-gray-500 hover:border-purple-400 hover:text-white'
      } ${className}`}
    >
      {on ? <CheckCircledIcon width={18} height={18} /> : <CircleIcon width={18} height={18} />}
    </button>
  )
}
