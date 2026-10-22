import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import { MagnifyingGlassIcon, ReloadIcon, VideoIcon } from '@radix-ui/react-icons'
import { t } from '../i18n'
import { disconnectServer } from '../library/api'
import {
  useLibraryIndex,
  useLibraryStatus,
  useRefreshIndex,
  useResetLibrary,
  useToggleFavorite
} from '../library/hooks'
import { moviesLabel, showsLabel } from '../library/labels'
import {
  catalogOf,
  countByFilter,
  filterContinue,
  filterItems,
  isFilter,
  isSort,
  sortItems
} from '../library/lib'
import ConnectCard from '../components/library/ConnectCard'
import ContinueCard from '../components/library/ContinueCard'
import EmptyState from '../components/library/EmptyState'
import ErrorState from '../components/library/ErrorState'
import FilterBar from '../components/library/FilterBar'
import PosterCard from '../components/library/PosterCard'
import Row from '../components/library/Row'
import ServerChip from '../components/library/ServerChip'
import {
  LibraryPageSkeleton,
  PosterGridSkeleton,
  RowSkeleton
} from '../components/library/Skeletons'

const PAGE = 96 // posters rendered at a time (a 5,000-title library must not mount 5,000 cards)
const VIEW_KEY = 'kaizen-library-view'

// filter / sort / search survive a visit to a series page and back (this session only)
function readView() {
  const fallback = { filter: 'all', sort: 'added', query: '' }
  try {
    const saved = JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null')
    return {
      filter: isFilter(saved?.filter) ? saved.filter : fallback.filter,
      sort: isSort(saved?.sort) ? saved.sort : fallback.sort,
      query: typeof saved?.query === 'string' ? saved.query.slice(0, 200) : ''
    }
  } catch {
    return fallback
  }
}
function writeView(view) {
  try {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify(view))
  } catch {
    /* storage unavailable: nothing to remember */
  }
}

function PageTitle({ children }) {
  return <h1 className="text-xl font-bold tracking-wider">{children}</h1>
}

function countsText(counts) {
  const movies = Number(counts?.movies) || 0
  const series = Number(counts?.series) || 0
  return [moviesLabel(movies), showsLabel(series)].join(' · ')
}

function GridEmpty({ filter, query, onClear }) {
  if (query) {
    return (
      <EmptyState
        icon={<MagnifyingGlassIcon width={32} height={32} />}
        title={t('library.noResults.title', { query })}
        text={t('library.noResults.text')}
      >
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-purple-400 hover:text-white"
        >
          {t('library.noResults.clear')}
        </button>
      </EmptyState>
    )
  }
  if (filter === 'favorites') {
    return (
      <EmptyState
        icon={<VideoIcon width={32} height={32} />}
        title={t('library.favoritesEmpty.title')}
        text={t('library.favoritesEmpty.text')}
      />
    )
  }
  return (
    <EmptyState
      icon={<VideoIcon width={32} height={32} />}
      title={filter === 'movies' ? t('library.moviesEmpty') : t('library.seriesEmpty')}
    />
  )
}

function Browser({ server, onChangeServer }) {
  const index = useLibraryIndex()
  const refresh = useRefreshIndex()
  const toggleFavorite = useToggleFavorite()
  const reset = useResetLibrary()
  const [view, setView] = useState(readView)
  const [disconnecting, setDisconnecting] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const sentinel = useRef(null)
  const deferredQuery = useDeferredValue(view.query)

  useEffect(() => {
    writeView(view)
  }, [view])
  useEffect(() => {
    setLimit(PAGE)
  }, [view.filter, view.sort, deferredQuery])

  const data = index.data
  const sessionLost = ['AUTH_EXPIRED', 'NOT_CONNECTED'].includes(index.error?.code)

  const catalog = useMemo(() => catalogOf(data), [data])
  const counts = useMemo(() => countByFilter(catalog), [catalog])
  const visible = useMemo(
    () => sortItems(filterItems(catalog, { filter: view.filter, query: deferredQuery }), view.sort),
    [catalog, view.filter, view.sort, deferredQuery]
  )
  const resume = useMemo(
    () => filterContinue(data?.continueWatching, view.filter),
    [data, view.filter]
  )
  const shown = visible.slice(0, limit)
  const more = visible.length - shown.length

  // load the next batch of posters when the end of the grid comes near
  useEffect(() => {
    const el = sentinel.current
    if (!el || more <= 0 || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setLimit((value) => value + PAGE)
      },
      { rootMargin: '800px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [more, limit])

  async function disconnect() {
    setDisconnecting(true)
    const result = await disconnectServer()
    setDisconnecting(false)
    if (!result.ok) {
      toast.error(t('library.toast.disconnectError'))
      return
    }
    reset.afterDisconnect()
    toast.success(t('library.toast.disconnected'))
  }

  const setFilter = (filter) => setView((prev) => ({ ...prev, filter }))
  const setSort = (sort) => setView((prev) => ({ ...prev, sort }))
  const setQuery = (query) => setView((prev) => ({ ...prev, query }))

  let body
  if (sessionLost) {
    body = <ErrorState error={index.error} onRetry={() => index.refetch()} className="py-6" />
  } else if (index.isPending && !data) {
    body = (
      <div role="status" aria-busy="true">
        <span className="sr-only">{t('library.loading')}</span>
        <div className="mb-8 h-10" />
        <RowSkeleton />
        <div className="mt-10">
          <PosterGridSkeleton />
        </div>
      </div>
    )
  } else if (!data) {
    body = (
      <ErrorState
        error={index.error}
        onRetry={() => index.refetch()}
        retrying={index.isFetching}
        onChangeServer={onChangeServer}
        backLink={false}
        className="py-10"
      />
    )
  } else if (counts.all === 0) {
    body = (
      <EmptyState
        icon={<VideoIcon width={32} height={32} />}
        title={t('library.empty.title')}
        text={t('library.empty.text')}
      >
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="flex items-center gap-x-2 rounded-md bg-purple-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-purple-500 disabled:opacity-60"
        >
          <ReloadIcon aria-hidden="true" />
          {t('library.server.refresh')}
        </button>
      </EmptyState>
    )
  } else {
    const showResume = !deferredQuery.trim() && view.filter !== 'favorites' && resume.length > 0
    body = (
      <>
        {index.isError && (
          <ErrorState
            compact
            error={index.error}
            onRetry={() => index.refetch()}
            retrying={index.isFetching}
            onChangeServer={onChangeServer}
          />
        )}
        <FilterBar
          filter={view.filter}
          onFilter={setFilter}
          query={view.query}
          onQuery={setQuery}
          sort={view.sort}
          onSort={setSort}
          counts={counts}
        />

        {showResume && (
          <Row title={t('library.continue.title')} className="mt-8">
            {resume.map((item) => (
              <ContinueCard key={`${item.key}:${item.videoId}`} item={item} />
            ))}
          </Row>
        )}

        <p role="status" className="sr-only">
          {t('library.results', { count: visible.length })}
        </p>

        {visible.length === 0 ? (
          <GridEmpty
            filter={view.filter}
            query={deferredQuery.trim()}
            onClear={() => setQuery('')}
          />
        ) : (
          <section aria-label={t('library.grid.label')} className="mt-8">
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-x-4 gap-y-8">
              {shown.map((item) => (
                <PosterCard
                  key={item.key || item.id}
                  item={item}
                  showRating={view.sort === 'rating'}
                  onToggleFavorite={(entry) =>
                    toggleFavorite.mutate({ id: entry.id, favorite: !entry.favorite })
                  }
                />
              ))}
            </ul>
            {more > 0 && (
              <div ref={sentinel} className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={() => setLimit((value) => value + PAGE)}
                  className="rounded-md border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-purple-400 hover:text-white"
                >
                  {t('library.showMore', { count: more })}
                </button>
              </div>
            )}
          </section>
        )}
      </>
    )
  }

  const current = data?.server || server
  return (
    <div className="animate-fade px-8 pb-24 pt-24 font-space-mono">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageTitle>{t('library.title')}</PageTitle>
          {data && <p className="mt-1 text-xs text-gray-500">{countsText(data.counts)}</p>}
        </div>
        <ServerChip
          server={current}
          fetchedAt={data?.fetchedAt}
          refreshing={refresh.isPending}
          disconnecting={disconnecting}
          onRefresh={() => refresh.mutate()}
          onDisconnect={disconnect}
        />
      </div>
      {body}
    </div>
  )
}

export default function Library() {
  const location = useLocation()
  const status = useLibraryStatus()
  const reset = useResetLibrary()
  const [changing, setChanging] = useState(location.state?.changeServer === true)

  if (status.isPending) return <LibraryPageSkeleton />

  if (!status.data) {
    return (
      <ErrorState
        error={status.error}
        onRetry={() => status.refetch()}
        retrying={status.isFetching}
        backLink={false}
      />
    )
  }

  if (!status.data.connected || changing) {
    return (
      <div className="flex flex-col items-center gap-y-6 px-4 pb-24 pt-24 font-space-mono">
        <PageTitle>{t('library.title')}</PageTitle>
        <ConnectCard
          mode="connect"
          onConnected={(next) => {
            reset.afterConnect({ connected: true, server: next })
            setChanging(false)
          }}
          onCancel={status.data.connected ? () => setChanging(false) : undefined}
        />
      </div>
    )
  }

  return <Browser server={status.data.server} onChangeServer={() => setChanging(true)} />
}
