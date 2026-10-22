// The library player's glue: finding the <video> Plyr creates, resuming, and feeding the progress
// reporter. The state machine itself lives in progress.js (pure). The DOM wiring is written as plain
// functions (`attachPlayback`, `attachSessionGuards`, `nextShortcutHandler`) that the hooks below only
// call from effects, so they can be tested in Node with an EventTarget standing in for the <video>.
import { useEffect, useRef, useState } from 'react'
import { RESUME_MIN_SECONDS, isTypingTarget } from './lib.js'

const isMedia = (el) => !!el && typeof el.addEventListener === 'function' && 'currentTime' in el

// A pause shorter than this is not reported (seeking with an external audio track pauses and
// resumes the video within a blink).
export const PAUSE_REPORT_DELAY_MS = 700

// Starts the video once its metadata is known (jumping to the saved position first) and forwards what
// the <video> does to the progress reporter. Returns the cleanup.
//   handlers: { onResume(seconds), onPlaying(), onEnded(durationSeconds), onError(mediaErrorCode) }
//   memo: { begunFor } kept by the caller, so a re-run on the same element never seeks twice
export function attachPlayback(
  media,
  { reporter, durationHint = 0, resumeAt = 0, handlers = {}, memo = {} }
) {
  let pauseTimer = null

  const total = () =>
    Number.isFinite(media.duration) && media.duration > 0 ? media.duration : durationHint || 0

  // metadata is there: jump to the saved position (when there is one) and play. Never earlier -
  // browsers ignore a currentTime set before loadedmetadata.
  const begin = () => {
    if (memo.begunFor === media) return
    memo.begunFor = media
    const length = total()
    if (resumeAt > RESUME_MIN_SECONDS && (!length || resumeAt < length - RESUME_MIN_SECONDS)) {
      try {
        media.currentTime = resumeAt
        handlers.onResume?.(resumeAt)
      } catch {
        /* not seekable yet: play from the start */
      }
    }
    try {
      const started = media.play()
      if (started && typeof started.catch === 'function') started.catch(() => {})
    } catch {
      /* autoplay refused: the big play button is there */
    }
  }

  const clearPauseTimer = () => {
    if (pauseTimer) clearTimeout(pauseTimer)
    pauseTimer = null
  }
  const onTimeUpdate = () => reporter.update(media.currentTime, total())
  const onPlaying = () => {
    clearPauseTimer()
    handlers.onPlaying?.()
    reporter.playing(media.currentTime, total())
  }
  const onPause = () => {
    if (media.ended) return // the end of the video is reported as 'ended'
    clearPauseTimer()
    pauseTimer = setTimeout(() => {
      pauseTimer = null
      if (media.paused && !media.ended) reporter.pause(media.currentTime, total())
    }, PAUSE_REPORT_DELAY_MS)
  }
  const onEnded = () => {
    clearPauseTimer()
    handlers.onEnded?.(total())
  }
  const onError = () => handlers.onError?.(media.error?.code ?? 0)

  const events = {
    loadedmetadata: begin,
    timeupdate: onTimeUpdate,
    playing: onPlaying,
    pause: onPause,
    ended: onEnded,
    error: onError
  }
  for (const [name, fn] of Object.entries(events)) media.addEventListener(name, fn)
  if (media.readyState >= 1) begin()
  if (media.error) onError()

  return () => {
    clearPauseTimer()
    for (const [name, fn] of Object.entries(events)) media.removeEventListener(name, fn)
  }
}

// Saves the position when the window is hidden and ends the session when the page goes away.
// `fetch(..., { keepalive: true })` is what lets these requests outlive the page. Returns the cleanup,
// which also ends the session (leaving the page inside the app).
export function attachSessionGuards(reporter, win, doc) {
  const leave = () => reporter.stop(undefined, undefined, { keepalive: true })
  const hide = () => {
    if (doc.visibilityState === 'hidden') {
      reporter.checkpoint(undefined, undefined, { keepalive: true })
    }
  }
  win.addEventListener('pagehide', leave)
  win.addEventListener('beforeunload', leave)
  doc.addEventListener('visibilitychange', hide)
  return () => {
    win.removeEventListener('pagehide', leave)
    win.removeEventListener('beforeunload', leave)
    doc.removeEventListener('visibilitychange', hide)
    reporter.stop()
  }
}

// keydown handler: `N` jumps to the next episode (ignored while typing or with a modifier key)
export function nextShortcutHandler(onNext) {
  return (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key !== 'n' && event.key !== 'N') return
    if (isTypingTarget(event.target)) return
    event.preventDefault()
    onNext()
  }
}

/* ------------------------------ hooks ------------------------------ */

// Plyr is created in an effect (so its ref is empty at first) and replaces its <video> when the
// source is set: poll until it is there, and keep noticing if the element ever changes.
export function usePlyrElements(plyrRef) {
  const [elements, setElements] = useState({ media: null, container: null })
  useEffect(() => {
    const look = () => {
      const plyr = plyrRef.current?.plyr
      const media = isMedia(plyr?.media) ? plyr.media : null
      const container = plyr?.elements?.container || null
      setElements((prev) =>
        prev.media === media && prev.container === container ? prev : { media, container }
      )
    }
    look()
    const timer = setInterval(look, 400)
    return () => clearInterval(timer)
  }, [plyrRef])
  return elements
}

// Handlers are read through a ref, so they can change on every render without re-attaching.
export function usePlaybackEvents({ media, reporter, durationHint = 0, resumeAt = 0, callbacks }) {
  const latest = useRef(callbacks)
  latest.current = callbacks
  const memo = useRef({ begunFor: null })

  useEffect(() => {
    if (!media) return undefined
    return attachPlayback(media, {
      reporter,
      durationHint,
      resumeAt,
      memo: memo.current,
      handlers: {
        onResume: (seconds) => latest.current?.onResume?.(seconds),
        onPlaying: () => latest.current?.onPlaying?.(),
        onEnded: (total) => latest.current?.onEnded?.(total),
        onError: (code) => latest.current?.onError?.(code)
      }
    })
  }, [media, reporter, durationHint, resumeAt])
}

export function useSessionGuards(reporter) {
  useEffect(() => attachSessionGuards(reporter, window, document), [reporter])
}

export function useNextShortcut(enabled, onNext) {
  const latest = useRef(onNext)
  latest.current = onNext
  useEffect(() => {
    if (!enabled) return undefined
    const handler = nextShortcutHandler(() => latest.current?.())
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enabled])
}

// counts down to 0 once started, then calls onDone; `remaining === null` means it is not running
export function useCountdown(onDone) {
  const [remaining, setRemaining] = useState(null)
  const latest = useRef(onDone)
  latest.current = onDone
  useEffect(() => {
    if (remaining === null) return undefined
    if (remaining <= 0) {
      setRemaining(null)
      latest.current?.()
      return undefined
    }
    const timer = setTimeout(
      () => setRemaining((value) => (value === null ? null : value - 1)),
      1000
    )
    return () => clearTimeout(timer)
  }, [remaining])
  return { remaining, start: (seconds) => setRemaining(seconds), cancel: () => setRemaining(null) }
}
