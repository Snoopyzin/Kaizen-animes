import { Link } from 'react-router-dom'
import { PlayIcon } from '@radix-ui/react-icons'
import { t } from '../../i18n'
import { useLibraryUrls } from '../../library/hooks'
import { episodeLabel, formatDuration, progressPercent, remainingSeconds } from '../../library/lib'
import ProgressBar from './ProgressBar'
import SmartImage from './SmartImage'

// A card of "Continuar assistindo": 16:9, links straight to the player. Episodes show S01E03;
// `next` ones are the next unwatched episode after a finished one ("Próximo").
export default function ContinueCard({ item }) {
  const urls = useLibraryUrls()
  const isEpisode = item.type === 'episode'
  const label = isEpisode ? episodeLabel(item) : ''

  const sources =
    item.hasImage === false
      ? []
      : isEpisode
        ? [urls.image(item.videoId, 'primary', 480), urls.image(item.seriesId, 'backdrop', 480)]
        : [urls.image(item.videoId, 'backdrop', 480), urls.image(item.videoId, 'primary', 480)]

  const heading = isEpisode ? item.seriesTitle || item.title : item.title
  const sub = isEpisode ? [label, item.title].filter(Boolean).join(' · ') : item.year || ''
  const remaining = formatDuration(remainingSeconds(item))
  const percent = item.next
    ? 0
    : progressPercent({ position: item.position, duration: item.duration })

  return (
    <li className="group w-64 shrink-0 snap-start">
      <Link
        to={`/library/watch/${item.videoId}`}
        className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
      >
        <div className="relative overflow-hidden rounded-md border border-gray-800 transition-colors group-hover:border-purple-400/70">
          <SmartImage sources={sources} className="aspect-video w-full" label={heading} />
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-focus-within:opacity-100 group-hover:bg-black/40 group-hover:opacity-100">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-purple-600 text-white">
              <PlayIcon width={20} height={20} aria-hidden="true" />
            </span>
          </div>
          {item.next && (
            <span className="absolute left-2 top-2 rounded bg-purple-600 px-1.5 py-0.5 text-xs font-bold text-white">
              {t('library.continue.next')}
            </span>
          )}
          <ProgressBar percent={percent} />
        </div>
        <div className="mt-2 px-0.5">
          <p title={heading} className="line-clamp-1 text-sm font-medium opacity-90">
            {heading}
          </p>
          {sub && <p className="line-clamp-1 text-xs opacity-60">{sub}</p>}
          {!item.next && remaining && (
            <p className="text-xs text-purple-300 opacity-80">
              {t('library.continue.remaining', { time: remaining })}
            </p>
          )}
        </div>
      </Link>
    </li>
  )
}
