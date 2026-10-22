import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeftIcon, TrackNextIcon, TrackPreviousIcon } from '@radix-ui/react-icons'
import Plyr from 'plyr-react'
import 'plyr-react/plyr.css'
import { toast } from 'sonner'
import { t } from '../i18n'
import TracksMenu from '../components/TracksMenu'
import { useKaizenContext } from '../utils/ContextProvider'
import { sendProgress } from '../library/api'
import { errorMessage } from '../library/errors'
import {
  useInvalidateLibrary,
  useLibraryPort,
  useLibraryUrls,
  useSetWatched,
  useVideo
} from '../library/hooks'
import {
  NEXT_EPISODE_SECONDS,
  episodeLabel,
  formatClock,
  formatDuration,
  formatResolution,
  mimeForContainer,
  normalizeId,
  normalizeReason,
  reasonForMediaError,
  resumePosition
} from '../library/lib'
import { createProgressReporter } from '../library/progress'
import {
  useCountdown,
  useNextShortcut,
  usePlaybackEvents,
  usePlyrElements,
  useSessionGuards
} from '../library/usePlayback'
import ErrorState from '../components/library/ErrorState'
import NextEpisodeOverlay from '../components/library/NextEpisodeOverlay'
import { PlayerSkeleton } from '../components/library/Skeletons'
import UnsupportedPanel from '../components/library/UnsupportedPanel'

// Plyr's own labels, in the interface language. Stable object: plyr-react re-creates the player
// whenever `options` or `source` change identity.
const PLYR_OPTIONS = {
  controls: [
    'play-large',
    'rewind',
    'play',
    'fast-forward',
    'progress',
    'current-time',
    'duration',
    'mute',
    'volume',
    'settings',
    'fullscreen'
  ],
  settings: ['speed'],
  seekTime: 10,
  ratio: '16:9',
  keyboard: { focused: true, global: true },
  i18n: {
    restart: t('libraryPlayer.plyr.restart'),
    rewind: t('libraryPlayer.plyr.rewind'),
    play: t('libraryPlayer.plyr.play'),
    pause: t('libraryPlayer.plyr.pause'),
    fastForward: t('libraryPlayer.plyr.fastForward'),
    seek: t('libraryPlayer.plyr.seek'),
    seekLabel: t('libraryPlayer.plyr.seekLabel'),
    played: t('libraryPlayer.plyr.played'),
    buffered: t('libraryPlayer.plyr.buffered'),
    currentTime: t('libraryPlayer.plyr.currentTime'),
    duration: t('libraryPlayer.plyr.duration'),
    volume: t('libraryPlayer.plyr.volume'),
    mute: t('libraryPlayer.plyr.mute'),
    unmute: t('libraryPlayer.plyr.unmute'),
    enterFullscreen: t('libraryPlayer.plyr.enterFullscreen'),
    exitFullscreen: t('libraryPlayer.plyr.exitFullscreen'),
    settings: t('libraryPlayer.plyr.settings'),
    speed: t('libraryPlayer.plyr.speed'),
    normal: t('libraryPlayer.plyr.normal'),
    menuBack: t('libraryPlayer.plyr.menuBack')
  }
}

// Going to another episode drops out of fullscreen (the player element is replaced). When the jump
// is triggered by the user, the new player asks to go fullscreen again (works while the click or
// key press is still fresh; ignored by the browser otherwise).
let reenterFullscreenUntil = 0
const rememberFullscreen = () => {
  reenterFullscreenUntil = document.fullscreenElement ? Date.now() + 15000 : 0
}

const navButton =
  'flex items-center gap-x-2 rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 transition-colors hover:border-purple-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400'

/* ------------------------------ the player itself ------------------------------ */

function PlyrStage({ video, reporter, resumeAt, next, onGoNext, onFailure }) {
  const urls = useLibraryUrls()
  const setWatched = useSetWatched()
  const plyrRef = useRef(null)
  const { media, container } = usePlyrElements(plyrRef)
  const countdown = useCountdown(() => onGoNext())

  const src = useMemo(() => urls.stream(video.id), [urls, video.id])
  const source = useMemo(
    () => ({
      type: 'video',
      title: video.title,
      sources: [{ src, type: mimeForContainer(video.container) }]
    }),
    [src, video.title, video.container]
  )
  const buildUrl = useCallback((kind) => urls.track(video.id, kind), [urls, video.id])

  usePlaybackEvents({
    media,
    reporter,
    durationHint: video.duration,
    resumeAt,
    callbacks: {
      onResume: (seconds) =>
        toast(t('libraryPlayer.resuming', { time: formatClock(seconds) }), {
          duration: 8000,
          action: {
            label: t('libraryPlayer.startOver'),
            onClick: () => {
              media.currentTime = 0
            }
          }
        }),
      onPlaying: () => countdown.cancel(),
      onEnded: (total) => {
        // 'stop' first, then the played flag (so the server can't see them out of order)
        reporter.stop(total, total).then(() => {
          setWatched.mutate({
            ids: [video.id],
            watched: true,
            seriesId: normalizeId(video.seriesId) || undefined,
            videoId: video.id
          })
        })
        if (next) countdown.start(NEXT_EPISODE_SECONDS)
      },
      onError: (code) => {
        const reason = reasonForMediaError(code)
        if (reason) onFailure(reason)
      }
    }
  })

  // arriving by "next episode" from a fullscreen player: go fullscreen again if the browser lets us
  useEffect(() => {
    if (!container || Date.now() > reenterFullscreenUntil) return
    reenterFullscreenUntil = 0
    try {
      const request = container.requestFullscreen?.({ navigationUI: 'hide' })
      if (request && typeof request.catch === 'function') request.catch(() => {})
    } catch {
      /* needs a fresh user gesture */
    }
  }, [container])

  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-md bg-black">
        <Plyr ref={plyrRef} source={source} options={PLYR_OPTIONS} />
      </div>
      <TracksMenu
        plyrRef={plyrRef}
        streamUrl={src}
        buildUrl={buildUrl}
        storageKey={`lib:${video.id}`}
      />
      {countdown.remaining !== null && next && (
        <NextEpisodeOverlay
          container={container}
          next={next}
          seconds={countdown.remaining}
          onPlay={onGoNext}
          onCancel={countdown.cancel}
        />
      )}
    </div>
  )
}

/* ------------------------------ the page body ------------------------------ */

function PlayerView({ video }) {
  const navigate = useNavigate()
  const location = useLocation()
  const port = useLibraryPort()
  const urls = useLibraryUrls()
  const invalidate = useInvalidateLibrary()
  const { vlcPath } = useKaizenContext()

  const isEpisode = video.kind === 'episode'
  const seriesId = normalizeId(video.seriesId)
  const prev = video.prev?.id ? video.prev : null
  const next = video.next?.id ? video.next : null
  const backTo =
    isEpisode && seriesId ? `/library/series/${seriesId}` : `/library/movie/${video.id}`

  // where to start: the start asked for by the movie page ("Assistir do início"), else the saved position
  const [resumeAt] = useState(() => {
    const asked = location.state?.start
    return typeof asked === 'number' && asked >= 0 ? asked : resumePosition(video.progress)
  })

  // a file the built-in player can't play is never mounted
  const [failure, setFailure] = useState(() =>
    video.playback?.supported === false ? { reason: normalizeReason(video.playback.reason) } : null
  )
  const [attempt, setAttempt] = useState(0)

  const warned = useRef(false)
  const reporter = useMemo(
    () =>
      createProgressReporter({
        send: (body, options) => sendProgress(port, video.id, body, options),
        onError: (error) => {
          if (warned.current) return
          warned.current = true
          toast.warning(t('libraryPlayer.progressError'), { description: errorMessage(error) })
        },
        onStopped: invalidate
      }),
    [port, video.id, invalidate]
  )
  useSessionGuards(reporter)

  const goTo = useCallback(
    (id) => {
      rememberFullscreen()
      navigate(`/library/watch/${id}`)
    },
    [navigate]
  )
  const goNext = useCallback(() => {
    if (next) goTo(next.id)
  }, [next, goTo])
  useNextShortcut(!!next, goNext)

  const fail = useCallback(
    (reason) => {
      reporter.stop()
      setFailure({ reason })
    },
    [reporter]
  )

  const openExternal = () => {
    try {
      if (typeof window.api?.openVlc !== 'function') throw new Error('external player unavailable')
      window.api.openVlc(vlcPath, urls.externalStream(video.id))
      toast(t('libraryPlayer.externalOpened'))
    } catch (error) {
      console.error('Could not open the external player', error)
      toast.error(t('libraryPlayer.externalError'))
    }
  }

  const label = episodeLabel(video)
  const meta = [formatDuration(video.duration), formatResolution(video.width, video.height)]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="animate-fade px-6 pb-24 pt-24 font-space-mono">
      <div
        className="mx-auto w-full"
        style={{ maxWidth: 'min(1400px, calc((100vh - 13rem) * 1.7778))' }}
      >
        <Link
          to={backTo}
          className="mb-3 inline-flex items-center gap-x-1.5 text-xs text-gray-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
        >
          <ArrowLeftIcon aria-hidden="true" />
          {isEpisode ? t('libraryPlayer.backToSeries') : t('libraryPlayer.backToMovie')}
        </Link>

        {failure ? (
          <UnsupportedPanel
            reason={failure.reason}
            container={video.container}
            codec={video.vcodec}
            playerPath={String(vlcPath || '').replace(/"/g, '')}
            onExternal={openExternal}
            onRetry={() => {
              setFailure(null)
              setAttempt((value) => value + 1)
            }}
            backTo={backTo}
          />
        ) : (
          <PlyrStage
            key={attempt}
            video={video}
            reporter={reporter}
            resumeAt={resumeAt}
            next={next}
            onGoNext={goNext}
            onFailure={fail}
          />
        )}

        <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {isEpisode ? (
              <>
                {video.seriesTitle &&
                  (seriesId ? (
                    <Link
                      to={`/library/series/${seriesId}`}
                      className="text-xs text-purple-400 underline-offset-2 hover:underline"
                    >
                      {video.seriesTitle}
                    </Link>
                  ) : (
                    <p className="text-xs text-purple-400">{video.seriesTitle}</p>
                  ))}
                <h1 className="text-xl font-medium tracking-wide">
                  {[label, video.title].filter(Boolean).join(' - ')}
                </h1>
              </>
            ) : (
              <h1 className="text-xl font-medium tracking-wide">
                {video.title}
                {video.year ? (
                  <span className="ml-3 text-base opacity-50">{video.year}</span>
                ) : null}
              </h1>
            )}
            {meta && <p className="mt-1 text-xs opacity-50">{meta}</p>}
          </div>

          {(prev || next) && (
            <nav aria-label={t('libraryPlayer.episodeNav')} className="flex flex-wrap gap-2">
              {prev && (
                <Link
                  to={`/library/watch/${prev.id}`}
                  onClick={rememberFullscreen}
                  title={[prev.label, prev.title].filter(Boolean).join(' - ')}
                  className={navButton}
                >
                  <TrackPreviousIcon aria-hidden="true" />
                  {t('libraryPlayer.prev')}
                </Link>
              )}
              {next && (
                <Link
                  to={`/library/watch/${next.id}`}
                  onClick={rememberFullscreen}
                  title={[next.label, next.title].filter(Boolean).join(' - ')}
                  className={navButton}
                >
                  {t('libraryPlayer.next.button')}
                  <kbd className="rounded border border-gray-600 px-1 text-xs text-gray-400">N</kbd>
                  <TrackNextIcon aria-hidden="true" />
                </Link>
              )}
            </nav>
          )}
        </div>
      </div>
    </div>
  )
}

export default function LibraryPlayer() {
  const id = normalizeId(useParams().videoId)
  // fresh: the saved position is read from this answer, so an older one must never be reused
  const { data: video, error, isPending, isFetching, refetch } = useVideo(id, { fresh: true })

  if (!id) return <ErrorState error="NOT_FOUND" />
  if (isPending) return <PlayerSkeleton />
  if (!video || ['AUTH_EXPIRED', 'NOT_CONNECTED'].includes(error?.code)) {
    return <ErrorState error={error} onRetry={() => refetch()} retrying={isFetching} />
  }
  return <PlayerView key={video.id} video={video} />
}
