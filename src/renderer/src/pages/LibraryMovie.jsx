import { Link, Navigate, useParams } from 'react-router-dom'
import {
  ArrowLeftIcon,
  ExclamationTriangleIcon,
  PlayIcon,
  StarFilledIcon
} from '@radix-ui/react-icons'
import { t } from '../i18n'
import { useLibraryUrls, useSetWatched, useToggleFavorite, useVideo } from '../library/hooks'
import {
  trackLanguages,
  formatClock,
  formatDuration,
  formatRating,
  formatResolution,
  formatSize,
  formatVideoCodec,
  isWatched,
  normalizeId,
  resumePosition
} from '../library/lib'
import { uiLocale } from '../library/locale'
import ErrorState from '../components/library/ErrorState'
import FavoriteButton from '../components/library/FavoriteButton'
import Hero from '../components/library/Hero'
import Overview from '../components/library/Overview'
import { SeriesPageSkeleton } from '../components/library/Skeletons'
import { reasonText } from '../components/library/UnsupportedPanel'
import WatchedButton from '../components/library/WatchedButton'

function Chip({ children }) {
  return (
    <span className="rounded border border-gray-700 px-1.5 py-0.5 text-xs text-gray-300">
      {children}
    </span>
  )
}

function Detail({ label, children }) {
  if (children === '' || children === null || children === undefined) return null
  return (
    <div className="flex gap-x-3 py-1.5 text-sm">
      <dt className="w-28 shrink-0 text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-gray-200">{children}</dd>
    </div>
  )
}

const primaryButton =
  'flex items-center gap-x-2 rounded-md bg-purple-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-purple-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300'
const secondaryButton =
  'flex items-center gap-x-2 rounded-md border border-gray-700 px-5 py-2.5 text-sm text-gray-300 transition-colors hover:border-purple-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400'

export default function LibraryMovie() {
  const id = normalizeId(useParams().videoId)
  const urls = useLibraryUrls()
  const { data: video, error, isPending, isFetching, refetch } = useVideo(id)
  const toggleFavorite = useToggleFavorite()
  const setWatched = useSetWatched()

  if (!id) return <ErrorState error="NOT_FOUND" />
  if (isPending) return <SeriesPageSkeleton />
  if (!video || ['AUTH_EXPIRED', 'NOT_CONNECTED'].includes(error?.code)) {
    return <ErrorState error={error} onRetry={() => refetch()} retrying={isFetching} />
  }

  // an episode id: its page is the series page
  if (video.kind === 'episode') {
    const seriesId = normalizeId(video.seriesId)
    return <Navigate to={seriesId ? `/library/series/${seriesId}` : '/library'} replace />
  }

  const locale = uiLocale()
  const resume = resumePosition(video.progress)
  const watched = isWatched(video.progress)
  const rating = formatRating(video.rating, locale)
  const genres = Array.isArray(video.genres) ? video.genres.filter(Boolean) : []
  const unsupported = video.playback?.supported === false
  const audio = Array.isArray(video.audio) ? trackLanguages(video.audio, locale) : null
  const subs = Array.isArray(video.subs) ? trackLanguages(video.subs, locale) : null
  const none = t('librarySeries.details.none')
  const watchPath = `/library/watch/${id}`

  return (
    <div className="animate-fade pb-24 font-space-mono">
      <Hero
        backdrop={video.hasBackdrop ? urls.image(id, 'backdrop', 1280) : ''}
        poster={video.hasImage === false ? '' : urls.image(id, 'primary', 480)}
        title={video.title}
      >
        <Link
          to="/library"
          className="mb-3 inline-flex items-center gap-x-1.5 text-xs text-gray-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
        >
          <ArrowLeftIcon aria-hidden="true" />
          {t('librarySeries.back')}
        </Link>
        <h1 className="text-2xl font-medium tracking-wider">
          {video.title}
          {video.year ? <span className="ml-3 text-lg opacity-50">{video.year}</span> : null}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-[#545454] pb-3 text-xs text-gray-300">
          {formatDuration(video.duration) && <span>{formatDuration(video.duration)}</span>}
          {video.officialRating && <Chip>{video.officialRating}</Chip>}
          {rating && (
            <span className="flex items-center gap-x-1 tracking-wide opacity-90">
              <StarFilledIcon aria-hidden="true" className="text-yellow-400" />
              {rating}
              <span className="sr-only"> {t('librarySeries.rating')}</span>
            </span>
          )}
          {formatResolution(video.width, video.height) && (
            <Chip>{formatResolution(video.width, video.height)}</Chip>
          )}
          {genres.length > 0 && <span className="opacity-70">{genres.join(', ')}</span>}
        </div>

        <div className="mt-4">
          <Overview text={video.overview} />
        </div>

        {unsupported && (
          <p
            role="note"
            className="mt-5 flex items-start gap-x-2 rounded border border-amber-800 bg-amber-950/40 px-3 py-2 text-xs text-amber-100"
          >
            <ExclamationTriangleIcon className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {t('librarySeries.unsupportedNote')}{' '}
              {reasonText(video.playback.reason, {
                container: video.container,
                codec: video.vcodec
              })}
            </span>
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {resume > 0 ? (
            <>
              <Link to={watchPath} className={primaryButton}>
                <PlayIcon aria-hidden="true" />
                {t('librarySeries.movie.continueFrom', { time: formatClock(resume) })}
              </Link>
              <Link to={watchPath} state={{ start: 0 }} className={secondaryButton}>
                {t('librarySeries.movie.fromStart')}
              </Link>
            </>
          ) : (
            <Link to={watchPath} className={primaryButton}>
              <PlayIcon aria-hidden="true" />
              {watched ? t('librarySeries.movie.again') : t('librarySeries.movie.watch')}
            </Link>
          )}
          <FavoriteButton
            variant="labeled"
            favorite={video.favorite === true}
            onToggle={() => toggleFavorite.mutate({ id, favorite: !video.favorite })}
          />
          <WatchedButton
            variant="labeled"
            watched={watched}
            disabled={setWatched.isPending}
            labelWatched={t('librarySeries.movie.markWatched')}
            labelUnwatched={t('librarySeries.movie.markUnwatched')}
            onToggle={() => setWatched.mutate({ ids: [id], watched: !watched, videoId: id })}
          />
        </div>

        <dl className="mt-8 max-w-2xl border-t border-[#545454] pt-3">
          <Detail label={t('librarySeries.details.duration')}>
            {formatDuration(video.duration)}
          </Detail>
          <Detail label={t('librarySeries.details.resolution')}>
            {formatResolution(video.width, video.height)
              ? `${formatResolution(video.width, video.height)} (${video.width}×${video.height})`
              : ''}
          </Detail>
          <Detail label={t('librarySeries.details.video')}>
            {formatVideoCodec(video.vcodec, video.vprofile)}
          </Detail>
          <Detail label={t('librarySeries.details.audio')}>
            {audio === null ? '' : audio.length ? audio.join(', ') : none}
          </Detail>
          <Detail label={t('librarySeries.details.subtitles')}>
            {subs === null ? '' : subs.length ? subs.join(', ') : none}
          </Detail>
          <Detail label={t('librarySeries.details.size')}>{formatSize(video.size, locale)}</Detail>
          <Detail label={t('librarySeries.details.file')}>{video.fileName}</Detail>
        </dl>
      </Hero>
    </div>
  )
}
