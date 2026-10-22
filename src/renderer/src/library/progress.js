// Playback progress reporting (spec section 7): start / progress / pause / stop.
// Free of React and of the network (`send` is injected), so the state machine is unit tested.
//
//  - 'start' once, when playback really begins (the first `playing` event of a session)
//  - 'progress' every ~10 s while playing, and right after a pause ends
//  - 'pause' when the video is paused (not when it ended)
//  - 'stop' once, when the user leaves or the video ends; nothing is sent for a video that never played
//  - requests are sent one after the other (a late 'pause' must not land after 'stop'); only
//    `keepalive` ones (the page is going away) jump the queue

export const PROGRESS_INTERVAL_MS = 10000

const round1 = (n) => Math.round(n * 10) / 10

export function createProgressReporter({
  send,
  intervalMs = PROGRESS_INTERVAL_MS,
  now = Date.now,
  onError,
  onStopped
} = {}) {
  let started = false
  let stopped = false
  let paused = false
  let lastSentAt = 0
  let chain = Promise.resolve()
  const last = { position: 0, duration: 0 }

  const remember = (position, duration) => {
    if (Number.isFinite(position) && position >= 0) last.position = position
    if (Number.isFinite(duration) && duration > 0) last.duration = duration
  }

  const payload = (state) => {
    const body = { position: round1(last.position), state }
    if (last.duration > 0) body.duration = round1(last.duration)
    return body
  }

  const post = (state, { keepalive = false } = {}) => {
    lastSentAt = now()
    const body = payload(state)
    if (keepalive) {
      try {
        return Promise.resolve(send(body, { keepalive: true })).catch((error) =>
          onError?.(error, state)
        )
      } catch (error) {
        onError?.(error, state)
        return Promise.resolve()
      }
    }
    chain = chain
      .then(() => send(body, { keepalive: false }))
      .catch((error) => onError?.(error, state))
    return chain
  }

  return {
    get started() {
      return started
    },
    get stopped() {
      return stopped
    },
    get paused() {
      return paused
    },

    // every timeupdate: remembers the position and sends a 'progress' when it is time
    update(position, duration) {
      remember(position, duration)
      if (started && !stopped && !paused && now() - lastSentAt >= intervalMs) {
        return post('progress')
      }
      return Promise.resolve()
    },

    // the <video> 'playing' event: the first one starts a session, the one after a pause continues it
    playing(position, duration) {
      remember(position, duration)
      if (!started || stopped) {
        started = true
        stopped = false
        paused = false
        return post('start')
      }
      if (paused) {
        paused = false
        return post('progress')
      }
      return Promise.resolve()
    },

    pause(position, duration) {
      remember(position, duration)
      if (!started || stopped || paused) return Promise.resolve()
      paused = true
      return post('pause')
    },

    // the window is hidden or about to close: save where we are without waiting for the queue
    checkpoint(position, duration, options = {}) {
      remember(position, duration)
      if (!started || stopped) return Promise.resolve()
      return post(paused ? 'pause' : 'progress', options)
    },

    // leaving the page / end of the video; sent once per session
    stop(position, duration, options = {}) {
      remember(position, duration)
      if (!started || stopped) return Promise.resolve()
      stopped = true
      const done = post('stop', options)
      return done.then(() => onStopped?.())
    }
  }
}
