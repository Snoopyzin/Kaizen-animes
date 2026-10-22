import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeftIcon, PlayIcon, StarFilledIcon } from '@radix-ui/react-icons'
import { t } from '../i18n'
import { useLibraryUrls, useSeries, useSetWatched, useToggleFavorite } from '../library/hooks'
import {
  episodeLabel,
  episodesOf,
  formatClock,
  formatRating,
  isWatched,
  normalizeId,
  pickInitialSeasonId,
  resumePosition,
  seasonsOf,
  seriesAction
} from '../library/lib'
import { episodesLabel, seasonsLabel } from '../library/labels'
import { uiLocale } from '../library/locale'
import EmptyState from '../components/library/EmptyState'
import EpisodeRow from '../components/library/EpisodeRow'
import ErrorState from '../components/library/ErrorState'
import FavoriteButton from '../components/library/FavoriteButton'
import Hero from '../components/library/Hero'
import Overview from '../components/library/Overview'
import SeasonSelector, { seasonLabel } from '../components/library/SeasonSelector'
import { SeriesPageSkeleton } from '../components/library/Skeletons'
import WatchedButton from '../components/library/WatchedButton'

function Chip({ children, className = '' }) {
  return (
    <span
      className={`rounded border border-gray-700 px-1.5 py-0.5 text-xs text-gray-300 ${className}`}
    >
      {children}
    </span>
  )
}

export default function LibrarySeries() {
  const id = normalizeId(useParams().seriesId)
  const urls = useLibraryUrls()
  const { data: series, error, isPending, isFetching, refetch } = useSeries(id)
  const toggleFavorite = useToggleFavorite()
  const setWatched = useSetWatched()
  const [picked, setPicked] = useState('')

  const seasons = useMemo(() => seasonsOf(series), [series])
  const activeId = seasons.some((season) => season.id === picked)
    ? picked
    : pickInitialSeasonId(series)
  const active = seasons.find((season) => season.id === activeId) || null

  if (!id) return <ErrorState error="NOT_FOUND" />
  if (isPending) return <SeriesPageSkeleton />
  if (!series || ['AUTH_EXPIRED', 'NOT_CONNECTED'].includes(error?.code)) {
    return <ErrorState error={error} onRetry={() => refetch()} retrying={isFetching} />
  }

  const locale = uiLocale()
  const counts = series.counts || {}
  const totalEpisodes = Number(counts.episodes) || 0
  const watchedEpisodes = Number(counts.watched) || 0
  const allWatched = totalEpisodes > 0 && watchedEpisodes >= totalEpisodes
  const action = seriesAction(series)
  const rating = formatRating(series.rating, locale)
  const status =
    series.status === 'Continuing'
      ? t('librarySeries.status.continuing')
      : series.status === 'Ended'
        ? t('librarySeries.status.ended')
        : ''
  const genres = Array.isArray(series.genres) ? series.genres.filter(Boolean) : []
  const nextId = series.nextUp?.id || ''

  let actionLabel = ''
  if (action.kind === 'continue') {
    const from = resumePosition(action.episode.progress)
    const label = episodeLabel(action.episode)
    if (!label) actionLabel = t('librarySeries.action.resume')
    else if (from) {
      actionLabel = t('librarySeries.action.continueFrom', { label, time: formatClock(from) })
    } else actionLabel = t('librarySeries.action.continue', { label })
  } else if (action.kind === 'start') {
    actionLabel = t('librarySeries.action.start')
  } else if (action.kind === 'again') {
    actionLabel = t('librarySeries.action.again')
  }

  const seasonCount = Number(counts.seasons) || 0
  const countsLine = [
    seasonCount > 0 && seasonsLabel(seasonCount),
    totalEpisodes > 0 && episodesLabel(totalEpisodes),
    totalEpisodes > 0 &&
      t('librarySeries.counts.watched', { watched: watchedEpisodes, total: totalEpisodes })
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="animate-fade pb-24 font-space-mono">
      <Hero
        backdrop={series.hasBackdrop ? urls.image(id, 'backdrop', 1280) : ''}
        poster={series.hasImage === false ? '' : urls.image(id, 'primary', 480)}
        title={series.title}
      >
        <Link
          to="/library"
          className="mb-3 inline-flex items-center gap-x-1.5 text-xs text-gray-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
        >
          <ArrowLeftIcon aria-hidden="true" />
          {t('librarySeries.back')}
        </Link>
        <h1 className="text-2xl font-medium tracking-wider">
          {series.title}
          {series.year ? <span className="ml-3 text-lg opacity-50">{series.year}</span> : null}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-[#545454] pb-3 text-xs text-gray-300">
          {series.officialRating && <Chip>{series.officialRating}</Chip>}
          {rating && (
            <span className="flex items-center gap-x-1 tracking-wide opacity-90">
              <StarFilledIcon aria-hidden="true" className="text-yellow-400" />
              {rating}
              <span className="sr-only"> {t('librarySeries.rating')}</span>
            </span>
          )}
          {status && <Chip>{status}</Chip>}
          {genres.length > 0 && <span className="opacity-70">{genres.join(', ')}</span>}
        </div>
        {countsLine && <p className="mt-3 text-xs opacity-60">{countsLine}</p>}

        <div className="mt-4">
          <Overview text={series.overview} />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {action.kind !== 'none' && (
            <Link
              to={`/library/watch/${action.episode.id}`}
              className="flex items-center gap-x-2 rounded-md bg-purple-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-purple-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300"
            >
              <PlayIcon aria-hidden="true" />
              {actionLabel}
            </Link>
          )}
          <FavoriteButton
            variant="labeled"
            favorite={series.favorite === true}
            onToggle={() => toggleFavorite.mutate({ id, favorite: !series.favorite })}
          />
          {totalEpisodes > 0 && (
            <WatchedButton
              variant="labeled"
              watched={allWatched}
              disabled={setWatched.isPending}
              labelWatched={t('librarySeries.markAll')}
              labelUnwatched={t('librarySeries.unmarkAll')}
              onToggle={() => setWatched.mutate({ ids: [id], watched: !allWatched, seriesId: id })}
            />
          )}
        </div>
      </Hero>

      <div className="mx-auto mt-12 px-6 lg:container">
        <h2 className="mb-3 text-lg font-medium opacity-90">{t('librarySeries.episodes')}</h2>
        <SeasonSelector seasons={seasons} value={activeId} onChange={setPicked} />

        {active ? (
          <section aria-label={seasonLabel(active)} className="mt-4">
            {episodesOf(active).length === 0 ? (
              <EmptyState title={t('librarySeries.noEpisodes')} />
            ) : (
              <ul className="flex flex-col gap-y-3">
                {episodesOf(active).map((episode) => (
                  <EpisodeRow
                    key={episode.id}
                    episode={episode}
                    isNext={episode.id === nextId}
                    busy={setWatched.isPending}
                    onToggleWatched={(entry) =>
                      setWatched.mutate({
                        ids: [entry.id],
                        watched: !isWatched(entry.progress),
                        seriesId: id
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </section>
        ) : (
          <EmptyState
            title={t('librarySeries.noEpisodes')}
            text={t('librarySeries.noEpisodesText')}
          />
        )}
      </div>
    </div>
  )
}
