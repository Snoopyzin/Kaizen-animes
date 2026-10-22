import { Link } from 'react-router-dom'
import { PlayIcon } from '@radix-ui/react-icons'
import { t } from '../../i18n'
import useTranslatedText from '../../hooks/useTranslatedText'
import { useLibraryPort, useLibraryUrls } from '../../library/hooks'
import {
  episodeLabel,
  formatDate,
  formatDuration,
  isWatched,
  looksPortuguese,
  plainText,
  progressPercent
} from '../../library/lib'
import { uiLocale } from '../../library/locale'
import ProgressBar from './ProgressBar'
import SmartImage from './SmartImage'
import WatchedButton from './WatchedButton'

// One episode of the series page: 16:9 still, "S01E03 · title", duration, air date, summary,
// progress, watched toggle and play.
export default function EpisodeRow({ episode, isNext = false, onToggleWatched, busy = false }) {
  const urls = useLibraryUrls()
  const port = useLibraryPort()
  const label = episodeLabel(episode)
  const title = episode.title || (label ? label : t('librarySeries.episode.untitled'))
  const heading = label && episode.title ? `${label} · ${episode.title}` : title
  const watched = isWatched(episode.progress)
  const percent = watched ? 0 : progressPercent(episode.progress)
  const href = `/library/watch/${episode.id}`

  const overview = plainText(episode.overview)
  const { translated } = useTranslatedText(
    overview && !looksPortuguese(overview) ? overview : null,
    port
  )

  const stills =
    episode.hasImage === false
      ? []
      : [urls.image(episode.id, 'primary', 400), urls.image(episode.id, 'thumb', 400)]
  const meta = [formatDuration(episode.duration), formatDate(episode.airDate, uiLocale())]
    .filter(Boolean)
    .join(' · ')

  return (
    <li
      className={`flex w-full gap-x-4 border font-space-mono transition-colors hover:bg-[#1e1e20] ${
        isNext ? 'border-purple-500/60' : 'border-gray-700'
      }`}
    >
      <Link
        to={href}
        tabIndex={-1}
        aria-hidden="true"
        className="group relative block aspect-video w-40 shrink-0 self-start overflow-hidden sm:w-48"
      >
        <SmartImage sources={stills} className="h-full w-full" label={label} />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-600 text-white">
            <PlayIcon width={18} height={18} />
          </span>
        </span>
        <ProgressBar percent={percent} />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-y-1 py-2">
        <div className="flex items-center gap-x-2">
          {watched && (
            <span
              title={t('librarySeries.watched.watched')}
              className="h-2 w-2 shrink-0 rounded-full bg-green-500"
            >
              <span className="sr-only">{t('librarySeries.watched.watched')}</span>
            </span>
          )}
          <Link
            to={href}
            title={heading}
            className="line-clamp-1 text-base font-medium opacity-95 hover:text-purple-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
          >
            {heading}
          </Link>
          {isNext && (
            <span className="shrink-0 rounded bg-purple-600 px-1.5 py-0.5 text-xs font-bold text-white">
              {t('librarySeries.episode.next')}
            </span>
          )}
        </div>
        {meta && <p className="text-xs opacity-50">{meta}</p>}
        {overview && <p className="line-clamp-2 text-sm opacity-60">{translated || overview}</p>}
      </div>

      <div className="flex items-center gap-x-2 pr-3">
        <WatchedButton
          watched={watched}
          title={heading}
          disabled={busy}
          onToggle={() => onToggleWatched?.(episode)}
        />
        <Link
          to={href}
          aria-label={t('librarySeries.episode.play', { title: heading })}
          title={t('librarySeries.episode.playShort')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-600 text-white transition-colors hover:bg-purple-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
        >
          <PlayIcon width={16} height={16} aria-hidden="true" />
        </Link>
      </div>
    </li>
  )
}
