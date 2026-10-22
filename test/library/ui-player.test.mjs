// The wiring of the library player (usePlayback.js) with an EventTarget standing in for the <video>
// element: resume, autoplay, what reaches the progress reporter, session guards, the N shortcut.
import test, { mock } from 'node:test'
import assert from 'node:assert/strict'
import {
  PAUSE_REPORT_DELAY_MS,
  attachPlayback,
  attachSessionGuards,
  nextShortcutHandler
} from '../../src/renderer/src/library/usePlayback.js'

class FakeMedia extends EventTarget {
  constructor(over = {}) {
    super()
    Object.assign(
      this,
      { currentTime: 0, duration: Number.NaN, paused: true, ended: false, readyState: 0, error: null, plays: 0 },
      over
    )
  }
  play() {
    this.paused = false
    this.plays++
    return Promise.resolve()
  }
  fire(name) {
    this.dispatchEvent(new Event(name))
  }
}

function fakeReporter() {
  const calls = []
  const record =
    (name) =>
    (...args) => {
      calls.push([name, ...args])
      return Promise.resolve()
    }
  return {
    calls,
    update: record('update'),
    playing: record('playing'),
    pause: record('pause'),
    checkpoint: record('checkpoint'),
    stop: record('stop')
  }
}

test('resumes from the saved position once the metadata is known, then plays', () => {
  const media = new FakeMedia()
  const reporter = fakeReporter()
  const resumed = []
  const detach = attachPlayback(media, {
    reporter,
    resumeAt: 600,
    durationHint: 3000,
    handlers: { onResume: (seconds) => resumed.push(seconds) }
  })
  assert.equal(media.plays, 0, 'nothing happens before loadedmetadata')
  assert.equal(media.currentTime, 0)

  media.duration = 3000
  media.fire('loadedmetadata')
  assert.equal(media.currentTime, 600)
  assert.deepEqual(resumed, [600])
  assert.equal(media.plays, 1)

  media.fire('loadedmetadata')
  assert.equal(media.plays, 1, 'a second event never seeks or plays again')
  detach()
})

test('a re-run on the same element (same memo) does not seek twice', () => {
  const media = new FakeMedia({ readyState: 4, duration: 500 })
  const memo = {}
  const first = attachPlayback(media, { reporter: fakeReporter(), resumeAt: 100, memo })
  media.currentTime = 250 // the user moved on
  first()
  attachPlayback(media, { reporter: fakeReporter(), resumeAt: 100, memo })
  assert.equal(media.currentTime, 250)
  assert.equal(media.plays, 1)
})

test('no resume for a tiny position, the very end, or an explicit start from 0', () => {
  for (const [resumeAt, duration] of [[0, 100], [3, 100], [5, 100], [97, 100], [100, 100]]) {
    const media = new FakeMedia({ duration })
    const resumed = []
    attachPlayback(media, {
      reporter: fakeReporter(),
      resumeAt,
      handlers: { onResume: (seconds) => resumed.push(seconds) }
    })
    media.fire('loadedmetadata')
    assert.equal(media.currentTime, 0, `resumeAt ${resumeAt}`)
    assert.deepEqual(resumed, [])
    assert.equal(media.plays, 1, 'it still plays from the start')
  }
})

test('metadata already there, unknown duration and a refused play()', async () => {
  const early = new FakeMedia({ readyState: 4, duration: 500 })
  attachPlayback(early, { reporter: fakeReporter(), resumeAt: 120 })
  assert.equal(early.currentTime, 120, 'begins at once when the video was ready before the listener')

  const hint = new FakeMedia({ readyState: 1 })
  attachPlayback(hint, { reporter: fakeReporter(), resumeAt: 57, durationHint: 60 })
  assert.equal(hint.currentTime, 0, 'within 5 s of the end the server told us about: no resume')

  const refused = new FakeMedia({ readyState: 1, duration: 100 })
  refused.play = () => Promise.reject(new Error('NotAllowedError'))
  assert.doesNotThrow(() => attachPlayback(refused, { reporter: fakeReporter(), resumeAt: 0 }))
  await new Promise((resolve) => setImmediate(resolve)) // an unhandled rejection would fail the run

  const throws = new FakeMedia({ readyState: 1, duration: 100 })
  throws.play = () => {
    throw new Error('boom')
  }
  assert.doesNotThrow(() => attachPlayback(throws, { reporter: fakeReporter(), resumeAt: 0 }))
})

test('events reach the reporter; a blink of a pause is not reported, a long one is', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const media = new FakeMedia({ duration: 200, currentTime: 12 })
    const reporter = fakeReporter()
    const seen = []
    attachPlayback(media, {
      reporter,
      handlers: { onPlaying: () => seen.push('playing'), onEnded: (total) => seen.push(['ended', total]) }
    })

    media.fire('playing')
    media.fire('timeupdate')
    assert.deepEqual(reporter.calls, [['playing', 12, 200], ['update', 12, 200]])

    // pause + playing within a blink (external audio restarting after a seek)
    media.paused = true
    media.fire('pause')
    mock.timers.tick(PAUSE_REPORT_DELAY_MS - 100)
    media.paused = false
    media.fire('playing')
    mock.timers.tick(2000)
    assert.ok(!reporter.calls.some(([name]) => name === 'pause'))

    // a pause that lasts
    media.paused = true
    media.currentTime = 40
    media.fire('pause')
    mock.timers.tick(PAUSE_REPORT_DELAY_MS + 10)
    assert.deepEqual(reporter.calls.at(-1), ['pause', 40, 200])

    // the end: no 'pause' report, the page decides what happens next
    const before = reporter.calls.length
    media.ended = true
    media.paused = true
    media.fire('pause')
    media.fire('ended')
    mock.timers.tick(5000)
    assert.equal(reporter.calls.length, before)
    assert.deepEqual(seen, ['playing', 'playing', ['ended', 200]])
  } finally {
    mock.timers.reset()
  }
})

test('errors are forwarded (also the ones that happened before listening); cleanup detaches everything', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const media = new FakeMedia({ duration: 100 })
    const reporter = fakeReporter()
    const errors = []
    const detach = attachPlayback(media, { reporter, handlers: { onError: (code) => errors.push(code) } })
    media.error = { code: 4 }
    media.fire('error')
    assert.deepEqual(errors, [4])

    media.fire('pause')
    detach()
    mock.timers.tick(5000)
    media.fire('playing')
    media.fire('timeupdate')
    media.fire('error')
    assert.deepEqual(reporter.calls, [], 'the pending pause report was cancelled and no listener is left')
    assert.deepEqual(errors, [4])

    const broken = new FakeMedia({ error: { code: 3 } })
    const early = []
    attachPlayback(broken, { reporter, handlers: { onError: (code) => early.push(code) } })
    assert.deepEqual(early, [3])
  } finally {
    mock.timers.reset()
  }
})

test('session guards: hidden window checkpoints, closing the page stops with keepalive, leaving stops normally', () => {
  const win = new EventTarget()
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const reporter = fakeReporter()
  const detach = attachSessionGuards(reporter, win, doc)

  doc.dispatchEvent(new Event('visibilitychange'))
  assert.deepEqual(reporter.calls, [], 'visible: nothing')
  doc.visibilityState = 'hidden'
  doc.dispatchEvent(new Event('visibilitychange'))
  assert.deepEqual(reporter.calls.at(-1), ['checkpoint', undefined, undefined, { keepalive: true }])

  win.dispatchEvent(new Event('pagehide'))
  assert.deepEqual(reporter.calls.at(-1), ['stop', undefined, undefined, { keepalive: true }])

  detach()
  assert.deepEqual(reporter.calls.at(-1), ['stop'], 'a plain stop when the page is left inside the app')
  const count = reporter.calls.length
  win.dispatchEvent(new Event('pagehide'))
  doc.dispatchEvent(new Event('visibilitychange'))
  assert.equal(reporter.calls.length, count, 'listeners removed')
})

test('N shortcut: next episode unless typing or combined with a modifier', () => {
  let next = 0
  const handler = nextShortcutHandler(() => next++)
  const press = (over) => {
    let prevented = false
    handler({
      key: 'n',
      target: { tagName: 'BODY' },
      defaultPrevented: false,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault: () => {
        prevented = true
      },
      ...over
    })
    return prevented
  }
  assert.equal(press({}), true)
  assert.equal(press({ key: 'N' }), true)
  assert.equal(next, 2)
  assert.equal(press({ key: 'm' }), false)
  assert.equal(press({ ctrlKey: true }), false)
  assert.equal(press({ metaKey: true }), false)
  assert.equal(press({ altKey: true }), false)
  assert.equal(press({ defaultPrevented: true }), false)
  assert.equal(press({ target: { tagName: 'INPUT' } }), false)
  assert.equal(press({ target: { tagName: 'DIV', isContentEditable: true } }), false)
  assert.equal(next, 2)
})
