import { Link } from 'react-router-dom'
import { CheckIcon } from '@radix-ui/react-icons'
import { t } from '../../i18n'
import { useLibraryUrls } from '../../library/hooks'
import {
  formatDuration,
  formatRating,
  kindOf,
  progressPercent,
  seriesProgress
} from '../../library/lib'
import { episodesLabel, seasonsLabel } from '../../library/labels'
import { uiLocale } from '../../library/locale'
import FavoriteButton from './FavoriteButton'
import ProgressBar from './ProgressBar'
import SmartImage from './SmartImage'

function Meta({ children }) {
  return <p className="mt-0.5 text-xs leading-snug opacity-60">{children}</p>
}

// Poster of the grid: a movie or a series. The whole card is a link; the heart sits next to the
// link (not inside it: a button inside an <a> is invalid and hard to use with the keyboard).
export default function PosterCard({ item, onToggleFavorite, showRating = false }) {
  const urls = useLibraryUrls()
  const isSeries = kindOf(item) === 'series'
  const href = isSeries ? `/library/series/${item.id}` : `/library/movie/${item.id}`
  const poster = item.hasImage === false ? '' : urls.image(item.id, 'primary', 360)

  const series = isSeries ? seriesProgress(item) : null
  const watched = isSeries ? series.complete : item.progress?.watched === true
  // a finished title shows the green tick instead of a full bar
  const percent = watched ? 0 : isSeries ? series.percent : progressPercent(item.progress)
  const rating = showRating ? formatRating(item.rating, uiLocale()) : ''

  let meta
  if (isSeries) {
    const seasons = Number(item.seasons) || 0
    const episodes = Number(item.episodes) || 0
    meta = [
      item.year,
      seasons > 0 && seasonsLabel(seasons),
      episodes > 0 && episodesLabel(episodes)
    ]
      .filter(Boolean)
      .join(' · ')
  } else {
    meta = [item.year, formatDuration(item.duration)].filter(Boolean).join(' · ')
  }

  return (
    <li className="group relative transition-transform duration-200 hover:z-10 hover:scale-[1.03]">
      <Link
        to={href}
        className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
      >
        <div className="relative overflow-hidden rounded-md border border-gray-800 transition-colors group-hover:border-purple-400/70">
          <SmartImage sources={[poster]} className="aspect-[2/3] w-full" label={item.title} />
          {watched && (
            <span
              title={t('library.card.watched')}
              className="shadow absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-white"
            >
              <CheckIcon aria-hidden="true" />
              <span className="sr-only">{t('library.card.watched')}</span>
            </span>
          )}
          {isSeries && !series.complete && series.watched > 0 && (
            <span
              title={t('library.card.watchedOf', {
                watched: series.watched,
                total: series.episodes
              })}
              className="absolute bottom-2 left-2 rounded bg-black/75 px-1.5 py-0.5 text-xs text-white"
            >
              {series.watched}/{series.episodes}
              <span className="sr-only">
                {' '}
                {t('library.card.watchedOf', { watched: series.watched, total: series.episodes })}
              </span>
            </span>
          )}
          <ProgressBar percent={percent} />
        </div>
        <div className="mt-2 px-0.5">
          <p
            title={item.year ? `${item.title} (${item.year})` : item.title}
            className="line-clamp-2 text-sm font-medium opacity-90"
          >
            {item.title}
          </p>
          {meta && <Meta>{meta}</Meta>}
          {rating && <Meta>★ {rating}</Meta>}
        </div>
      </Link>
      <FavoriteButton
        favorite={item.favorite === true}
        title={item.title}
        onToggle={() => onToggleFavorite?.(item)}
        className="absolute right-2 top-2"
      />
    </li>
  )
}
