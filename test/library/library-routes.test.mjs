// The HTTP API (/library) end to end against the mock Jellyfin: security, shapes, caching, error mapping, user data.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startMockJellyfin } from './mock-jellyfin.mjs'
import { startBackend, TOKEN, sleep } from './helpers.mjs'

let mock
let b
test.before(async () => {
  mock = await startMockJellyfin()
  b = await startBackend({ mock })
})
test.after(async () => {
  await b.close()
  await mock.close()
})

const upstream = (re) => mock.requests.filter((r) => re.test(`${r.method} ${r.path}`))
const fresh = async () => {
  await b.json('/?refresh=1')
}
const ids = () => mock.ids
const pilot = () => mock.episode('Test Show', 1, 1)
const second = () => mock.episode('Test Show', 1, 2)

/* ------------------------------ security ------------------------------ */

test('the token is required on every route, in the query or in X-Kaizen-Token, compared safely', async () => {
  const id = ids().testMovie
  const routes = [
    ['GET', '/status'], ['GET', '/'], ['GET', `/series/${ids().testShow}`], ['GET', `/video/${id}`], ['GET', `/image/${id}`],
    ['GET', `/stream/${id}`], ['HEAD', `/stream/${id}`], ['GET', `/mediainfo/${id}`], ['GET', `/subtitles/${id}?track=0`],
    ['GET', `/audio/${id}?track=2`], ['POST', `/progress/${id}`], ['POST', '/watched'], ['POST', '/favorite'], ['GET', '/nope']
  ]
  const before = mock.requests.length
  for (const [method, route] of routes) {
    for (const token of [null, '', 'wrong', TOKEN.slice(0, -1), TOKEN + 'x', 'é'.repeat(40), 'a'.repeat(5000)]) {
      const res = await b.api(route, { method, token, body: method === 'POST' ? {} : undefined })
      assert.equal(res.status, 401, `${method} ${route} token=${String(token).slice(0, 8)}`)
      if (method !== 'HEAD') assert.deepEqual(await res.json(), { error: 'UNAUTHORIZED', message: 'missing or wrong token' })
    }
    // the same token twice, or as an array, is not accepted either
    assert.equal((await b.api(`${route}${route.includes('?') ? '&' : '?'}t=zzz`, { method, body: method === 'POST' ? {} : undefined })).status, 401, `${route} duplicated t`)
  }
  assert.equal(mock.requests.length, before, 'nothing reached Jellyfin without a token')
  assert.equal((await b.api('/status', { token: null, headers: { 'X-Kaizen-Token': TOKEN } })).status, 200)
  assert.equal((await b.api('/status', { token: null, headers: { 'X-Kaizen-Token': 'nope' } })).status, 401)
  assert.equal((await b.api('/status', { token: 'wrong', headers: { 'X-Kaizen-Token': TOKEN } })).status, 401, 'a wrong query token is not rescued by the header')
})

test('error bodies are JSON { error, message }, never HTML, stack traces or tokens', async () => {
  const res = await b.api('/nope')
  assert.equal(res.status, 404)
  assert.match(res.headers.get('content-type'), /application\/json/)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  const body = await res.json()
  assert.deepEqual(Object.keys(body).sort(), ['error', 'message'])
  assert.equal(body.error, 'NOT_FOUND')
  const jellyfinToken = [...mock.state.tokens][0]
  for (const route of ['/video/' + '0'.repeat(31) + '1', '/series/zzz', '/nope']) {
    const text = await (await b.api(route)).text()
    assert.equal(text.includes(jellyfinToken), false)
    assert.equal(/at \w+.*\.js|stack|node_modules/i.test(text), false)
  }
})

test('ids are validated before anything is sent to Jellyfin (traversal, SSRF, injection)', async () => {
  const bad = [
    '..%2F..%2FSystem%2FInfo', '%2e%2e%2f%2e%2e%2f', 'http%3A%2F%2Fevil.test%2F', 'http://evil.test', '127.0.0.1%3A8096', '%00', 'abc',
    '1'.repeat(33), 'g'.repeat(32), `${'a'.repeat(32)}%2Fimages`, `${'a'.repeat(32)}%3Fapi_key%3D1`, `${'a'.repeat(31)}%0A`, '43f9fd2b-bf55-a40e-1bf2-de36cc27f48'
  ]
  const before = mock.requests.length
  for (const id of bad) {
    for (const kind of ['series', 'video', 'image', 'stream', 'mediainfo', 'subtitles', 'audio', 'progress']) {
      const route = `/${kind}/${id}${kind === 'subtitles' || kind === 'audio' ? '?track=1' : ''}`
      const res = await b.api(route, { method: kind === 'progress' ? 'POST' : 'GET', body: kind === 'progress' ? { position: 1 } : undefined })
      // ids with a slash are not even a route (404); every other bad id is a 400
      assert.ok(res.status === 400 || (res.status === 404 && id.includes('/')), `${route} -> ${res.status}`)
      await res.arrayBuffer()
    }
  }
  assert.equal(mock.requests.length, before, 'no upstream request was made')
  // user-supplied URLs / paths in the query are never used
  const ok = await b.api(`/image/${ids().testMovie}?type=primary&url=http://evil.test/x&path=C:/Windows&server=evil`)
  assert.equal(ok.status, 200)
  await ok.arrayBuffer()
  const last = mock.requests.at(-1)
  assert.equal(last.path, `/Items/${ids().testMovie}/Images/Primary`)
  assert.deepEqual(Object.keys(last.query).sort(), ['maxWidth', 'quality'])
})

test('dashed GUIDs are accepted and normalised', async () => {
  const id = ids().testMovie
  const dashed = id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5')
  const a = await b.json(`/video/${dashed}`)
  assert.equal(a.status, 200)
  assert.equal(a.json.id, id)
  assert.equal((await b.json(`/video/${id.toUpperCase()}`)).json.id, id)
})

/* ------------------------------ status / index ------------------------------ */

test('status', async () => {
  const r = await b.json('/status')
  assert.deepEqual(r.json, { connected: true, server: { name: 'Kaizen Testbed', host: new URL(mock.url).host, url: mock.url, userName: 'kaizen', version: '12.2.0', allowInvalidCert: false } })
})

test('index: exact shape, counts, stable title order, compact rows', async () => {
  await fresh()
  const r = await b.json('/')
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('cache-control'), 'no-store')
  const index = r.json
  assert.deepEqual(Object.keys(index).sort(), ['continueWatching', 'counts', 'fetchedAt', 'movies', 'series', 'server'])
  assert.deepEqual(index.counts, { movies: 5, series: 2, episodes: 7 })
  assert.deepEqual(index.movies.map((m) => m.title), ['Cover Movie', 'Hevc Movie', 'Odd Layout', 'Second Movie', 'Test Movie'])
  assert.deepEqual(index.series.map((s) => s.title), ['Short Show', 'Test Show'])
  assert.deepEqual(Object.keys(index.movies[0]).sort(), ['addedAt', 'duration', 'favorite', 'genres', 'hasImage', 'height', 'id', 'key', 'progress', 'rating', 'title', 'width', 'year'])
  assert.deepEqual(Object.keys(index.series[0]).sort(), ['addedAt', 'episodes', 'favorite', 'genres', 'hasImage', 'id', 'key', 'lastWatchedAt', 'rating', 'seasons', 'title', 'watched', 'year'])
  assert.equal(r.text.includes('Overview'), false)
  assert.equal(r.text.includes('overview'), false, 'no overviews in the index')
  assert.ok(Math.abs(index.fetchedAt - Date.now()) < 5000)
  const test = index.series.find((s) => s.title === 'Test Show')
  assert.deepEqual([test.seasons, test.episodes, test.watched], [2, 5, 0])
  assert.deepEqual(index.continueWatching, [])
})

test('index: asks Jellyfin for the fields it needs, in pages, and survives optional queries failing', async () => {
  await fresh()
  const movieQuery = upstream(/GET \/Items$/).filter((r) => r.query.IncludeItemTypes === 'Movie').at(-1).query
  assert.equal(movieQuery.Recursive, 'true')
  assert.equal(movieQuery.Limit, '500')
  assert.equal(movieQuery.StartIndex, '0')
  assert.match(movieQuery.Fields, /Width/)
  assert.match(movieQuery.Fields, /Height/)
  assert.match(movieQuery.Fields, /Genres/)
  assert.doesNotMatch(movieQuery.Fields, /Overview|MediaSources/)
  assert.equal(movieQuery.userId, mock.userId)
  // NextUp / the played history failing must not take the whole catalog down
  mock.fail(/GET \/Shows\/NextUp/, 500)
  mock.fail(/GET \/Items\?.*Filters=IsPlayed/, 500)
  mock.fail(/GET \/UserItems\/Resume/, 500)
  const r = await b.json('/?refresh=1')
  assert.equal(r.status, 200)
  assert.equal(r.json.movies.length, 5)
  assert.deepEqual(r.json.continueWatching, [])
  mock.clearRules()
})

test('index: cached for the next calls, single-flight for simultaneous ones, ?refresh=1 forces a fetch', async () => {
  await fresh()
  const base = upstream(/GET \/Items$/).length
  const a = await b.json('/')
  const c = await b.json('/')
  assert.equal(a.json.fetchedAt, c.json.fetchedAt)
  assert.equal(upstream(/GET \/Items$/).length, base, 'second and third call: no upstream query')
  await sleep(3)
  const forced = await b.json('/?refresh=1')
  assert.ok(forced.json.fetchedAt > a.json.fetchedAt)
  assert.ok(upstream(/GET \/Items$/).length > base)

  // ten calls at once after a refresh make ONE upstream round
  await b.json('/?refresh=true')
  mock.slow(/GET \/Items/, 120, 6)
  const startCount = upstream(/GET \/Items$/).filter((r) => r.query.IncludeItemTypes === 'Movie').length
  b.library.service.invalidate()
  const results = await Promise.all(Array.from({ length: 10 }, () => b.json('/')))
  assert.equal(new Set(results.map((r) => r.json.fetchedAt)).size, 1)
  assert.equal(upstream(/GET \/Items$/).filter((r) => r.query.IncludeItemTypes === 'Movie').length - startCount, 1)
  mock.clearRules()
})

test('index is invalidated by progress stop, watched and favorite (not by progress ticks)', async () => {
  const id = ids().testMovie
  const stamp = async () => (await b.json('/')).json.fetchedAt
  let t = await stamp()
  await sleep(3)
  await b.post(`/progress/${id}`, { position: 0, state: 'start' })
  await b.post(`/progress/${id}`, { position: 30, state: 'progress' })
  await b.post(`/progress/${id}`, { position: 31, state: 'pause' })
  assert.equal(await stamp(), t, 'start / progress / pause leave the cache alone')
  await b.post(`/progress/${id}`, { position: 40, state: 'stop' })
  const afterStop = await stamp()
  assert.ok(afterStop > t, 'stop invalidates')
  await sleep(3)
  await b.post('/watched', { ids: [id], watched: false })
  const afterWatched = await stamp()
  assert.ok(afterWatched > afterStop, 'watched invalidates')
  await sleep(3)
  await b.post('/favorite', { id, favorite: true })
  const afterFavorite = await stamp()
  assert.ok(afterFavorite > afterWatched, 'favorite invalidates')
  await b.post('/favorite', { id, favorite: false })
})

/* ------------------------------ series and video ------------------------------ */

test('series page', async () => {
  const r = await b.json(`/series/${ids().testShow}`)
  assert.equal(r.status, 200)
  const s = r.json
  assert.deepEqual(Object.keys(s).sort(), ['counts', 'favorite', 'genres', 'hasBackdrop', 'hasImage', 'id', 'nextUp', 'officialRating', 'overview', 'rating', 'seasons', 'status', 'title', 'year'])
  assert.deepEqual(s.seasons.map((x) => [x.season, x.name, x.episodes.length]), [[1, 'Season 1', 3], [2, 'Season 2', 1], [0, 'Specials', 1]])
  assert.deepEqual(Object.keys(s.seasons[0]).sort(), ['episodes', 'id', 'name', 'season'])
  assert.deepEqual(s.counts, { seasons: 2, episodes: 5, watched: 0 })
  assert.equal(s.nextUp.label, 'S01E01')
  const q = upstream(/GET \/Shows\/.*\/Episodes/).at(-1).query
  assert.match(q.Fields, /Overview/)
  assert.equal(r.headers.get('cache-control'), 'no-store')
})

test('series: unknown id and a movie id are NOT_FOUND', async () => {
  assert.equal((await b.json(`/series/${'0'.repeat(31)}1`)).json.error, 'NOT_FOUND')
  const asMovie = await b.json(`/series/${ids().testMovie}`)
  assert.equal(asMovie.status, 404)
  assert.equal((await b.json(`/series/${ids().shortShow}`)).status, 200)
})

test('video page: movie and episode, every field', async () => {
  const m = (await b.json(`/video/${ids().testMovie}`)).json
  assert.equal(m.kind, 'movie')
  assert.equal(m.audio.length, 3)
  assert.equal(m.subs.length, 4)
  assert.equal(m.fileName, 'Test Movie (2020).mkv')
  const e = (await b.json(`/video/${second().Id}`)).json
  assert.deepEqual([e.kind, e.label, e.seriesTitle, e.title], ['episode', 'S01E02', 'Test Show', 'Second Wind'])
  assert.equal(e.prev.label, 'S01E01')
  assert.equal(e.next.label, 'S01E03-E04')
  const last = mock.episode('Test Show', 1, 3)
  assert.equal((await b.json(`/video/${last.Id}`)).json.next.label, 'S02E01')
  assert.equal((await b.json(`/video/${mock.episode('Test Show', 2, 1).Id}`)).json.next, null, 'the last regular episode has no next (specials are not part of the run)')
  const special = (await b.json(`/video/${mock.episode('Test Show', 0, 1).Id}`)).json
  assert.deepEqual([special.label, special.prev, special.next], ['S00E01', null, null])
})

test('video: not a video / unknown id', async () => {
  assert.equal((await b.json(`/video/${ids().testShow}`)).json.error, 'NOT_FOUND')
  assert.equal((await b.json(`/video/${'0'.repeat(31)}1`)).json.error, 'NOT_FOUND')
})

test('Jellyfin\'s GET /Items/{id} serves stale user data after a series cascade: the backend never uses it', async () => {
  const sid = ids().testShow
  const first = pilot().Id
  await b.post(`/progress/${first}`, { position: 0, state: 'start' })
  await b.post(`/progress/${first}`, { position: 100, state: 'stop' })
  assert.equal((await b.json(`/video/${first}`)).json.progress.position, 100)
  await b.post('/watched', { ids: [sid], watched: true })
  const v = (await b.json(`/video/${first}`)).json
  assert.equal(v.progress.watched, true, 'fresh user data, not the cached 100 s')
  assert.equal((await b.json(`/series/${sid}`)).json.counts.watched, 5)
  await b.post('/watched', { ids: [sid], watched: false })
  assert.equal((await b.json(`/video/${first}`)).json.progress, null)
  assert.equal(upstream(/GET \/Items\/[0-9a-f]{32}$/).length, 0, 'GET /Items/{id} is never called')
})

/* ------------------------------ continue watching ------------------------------ */

test('continue watching and next-up through the real flow', async () => {
  const sid = ids().testShow
  const e1 = pilot().Id
  const e2 = second().Id
  const movie = ids().testMovie
  await b.post('/watched', { ids: [sid, movie], watched: false })
  await b.post(`/progress/${movie}`, { position: 0, state: 'start' })
  await b.post(`/progress/${movie}`, { position: 120, state: 'stop' })
  await b.post(`/progress/${e1}`, { position: 0, state: 'start' })
  await b.post(`/progress/${e1}`, { position: 305, state: 'stop' }) // finished
  let index = (await b.json('/?refresh=1')).json
  assert.deepEqual(index.continueWatching.map((c) => [c.type, c.label, c.next, c.position, c.title]).sort(), [
    ['episode', 'S01E02', true, 0, 'Second Wind'],
    ['movie', null, false, 120, 'Test Movie']
  ])
  const nextEntry = index.continueWatching.find((c) => c.type === 'episode')
  assert.deepEqual(
    Object.keys(nextEntry).sort(),
    ['duration', 'episode', 'episodeEnd', 'hasImage', 'key', 'label', 'next', 'position', 'season', 'seriesId', 'seriesTitle', 'title', 'type', 'updatedAt', 'videoId', 'year'].sort()
  )
  const movieEntry = index.continueWatching.find((c) => c.type === 'movie')
  assert.deepEqual(Object.keys(movieEntry).sort(), Object.keys(nextEntry).sort(), 'movies and episodes share one shape')
  assert.equal(nextEntry.videoId, e2)
  assert.equal(nextEntry.key, 's:' + sid)
  assert.equal(nextEntry.seriesTitle, 'Test Show')
  assert.deepEqual(index.series.find((s) => s.id === sid).lastWatchedAt > 0, true)
  assert.equal(index.series.find((s) => s.id === sid).watched, 1)
  assert.equal(index.movies.find((m) => m.id === movie).progress.position, 120)

  await b.post(`/progress/${e2}`, { position: 0, state: 'start' })
  await b.post(`/progress/${e2}`, { position: 100, state: 'stop' })
  index = (await b.json('/')).json
  const entry = index.continueWatching.filter((c) => c.key === 's:' + sid)
  assert.equal(entry.length, 1, 'one entry per series')
  assert.deepEqual([entry[0].next, entry[0].position, entry[0].label], [false, 100, 'S01E02'])
  assert.deepEqual(index.continueWatching.map((c) => c.updatedAt), [...index.continueWatching.map((c) => c.updatedAt)].sort((x, y) => y - x))
  assert.equal((await b.json(`/series/${sid}`)).json.nextUp.label, 'S01E02')
  await b.post('/watched', { ids: [sid, movie], watched: false })
})

/* ------------------------------ user data ------------------------------ */

test('progress: maps start / progress / pause / stop to Jellyfin playback reports', async () => {
  const id = ids().secondMovie
  mock.state.playback.length = 0
  const mediaSourceId = mock.items.get(id).MediaSources[0].Id
  const start = await b.post(`/progress/${id}`, { position: 0, duration: 12, state: 'start' })
  assert.equal(start.status, 200)
  assert.deepEqual(start.json, { progress: { position: 0, duration: 12, watched: false }, watched: false })
  await b.post(`/progress/${id}`, { position: 7.25, duration: 12 }) // state defaults to 'progress'
  await b.post(`/progress/${id}`, { position: 7.5, state: 'pause' })
  const stop = await b.post(`/progress/${id}`, { position: 8, state: 'stop' })
  assert.deepEqual(stop.json, { progress: { position: 0, duration: 12, watched: true }, watched: true }, 'an item shorter than 5 minutes counts as played on stop')
  const [s, p, pause, st] = mock.state.playback
  assert.deepEqual([s.kind, p.kind, pause.kind, st.kind], ['Start', 'Progress', 'Progress', 'Stopped'])
  assert.deepEqual([s.body.PositionTicks, p.body.PositionTicks, pause.body.PositionTicks, st.body.PositionTicks], [0, 72500000, 75000000, 80000000])
  assert.deepEqual([p.body.IsPaused, pause.body.IsPaused], [false, true])
  for (const e of [s, p, pause, st]) {
    assert.equal(e.body.ItemId, id)
    assert.equal(e.body.MediaSourceId, mediaSourceId)
  }
  for (const e of [s, p, pause]) assert.deepEqual([e.body.PlayMethod, e.body.CanSeek], ['DirectPlay', true])
  const sessions = new Set([s, p, pause, st].map((e) => e.body.PlaySessionId))
  assert.equal(sessions.size, 1, 'one play session id for the whole play')
  assert.match([...sessions][0], /^[0-9a-f-]{36}$/)
  await b.post('/watched', { ids: [id], watched: false })
})

test('progress: a position above the duration is clamped; below 5 s never erases a saved position', async () => {
  const id = ids().testMovie
  await b.post('/watched', { ids: [id], watched: false })
  await b.post(`/progress/${id}`, { position: 0, state: 'start' })
  await b.post(`/progress/${id}`, { position: 150, state: 'stop' })
  assert.equal((await b.json(`/video/${id}`)).json.progress.position, 150)
  // the user opens it again "from the start" and leaves after 3 seconds
  mock.state.playback.length = 0
  await b.post(`/progress/${id}`, { position: 0, state: 'start' })
  const early = await b.post(`/progress/${id}`, { position: 3, state: 'stop' })
  assert.equal(early.json.progress.position, 150)
  assert.equal(mock.state.playback.at(-1).body.PositionTicks, 1500000000, 'Jellyfin is told the saved position, not 3 s')
  const pause = await b.post(`/progress/${id}`, { position: 4, state: 'pause' })
  assert.equal(pause.status, 200)
  assert.equal(mock.state.playback.at(-1).body.PositionTicks, 1500000000)
  // 5 s and more are reported as they are
  await b.post(`/progress/${id}`, { position: 20, state: 'stop' })
  assert.equal(mock.state.playback.at(-1).body.PositionTicks, 200000000)
  // without a saved position the real (tiny) position goes through
  await b.post('/watched', { ids: [id], watched: false })
  await b.post(`/progress/${id}`, { position: 2, state: 'stop' })
  assert.equal(mock.state.playback.at(-1).body.PositionTicks, 20000000)
  // a position beyond the runtime is clamped to it
  await b.post(`/progress/${id}`, { position: 99999, state: 'stop' })
  assert.equal(mock.state.playback.at(-1).body.PositionTicks, 3100210000)
  assert.equal((await b.json(`/video/${id}`)).json.progress.watched, true)
  await b.post('/watched', { ids: [id], watched: false })
})

test('progress: validation and errors', async () => {
  const id = ids().testMovie
  const bad = [{}, { position: -1 }, { position: 'x' }, { position: null }, { position: 1e8 }, { position: NaN }, { position: 1, state: 'dance' }, { position: 1, state: 5 }, { position: 5, duration: 'long' }, { position: 5, duration: -1 }, []]
  for (const body of bad) assert.equal((await b.post(`/progress/${id}`, body)).status, 400, JSON.stringify(body))
  assert.equal((await b.api(`/progress/${id}`, { method: 'POST', body: '[1,2]', headers: { 'Content-Type': 'application/json' } })).status, 400)
  assert.equal((await b.api(`/progress/${id}`, { method: 'POST', body: 'position=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 400)
  assert.equal((await b.post(`/progress/${'0'.repeat(31)}1`, { position: 1, state: 'stop' })).json.error, 'NOT_FOUND')
  assert.equal((await b.post(`/progress/${ids().testShow}`, { position: 1 })).json.error, 'NOT_FOUND', 'a series is not playable')
  const huge = await b.api(`/progress/${id}`, { method: 'POST', body: { position: 1, filler: 'x'.repeat(9000) } })
  assert.equal(huge.status, 400, 'bodies over 8 KB are refused')
  assert.equal((await b.api(`/progress/${id}`, { method: 'GET' })).status, 404, 'POST only')
})

test('watched: movie, episode, season and series ids; dedupe; counts; errors', async () => {
  const sid = ids().testShow
  const eps = (await b.json(`/series/${sid}`)).json.seasons
  const season1 = eps[0].id
  const r = await b.post('/watched', { ids: [season1, season1.toUpperCase(), ids().secondMovie], watched: true })
  assert.deepEqual(r.json, { updated: 2 }, 'duplicates collapse')
  let detail = (await b.json(`/series/${sid}`)).json
  assert.equal(detail.counts.watched, 3)
  assert.equal(detail.seasons[0].episodes.every((e) => e.progress?.watched), true)
  assert.equal(detail.seasons[1].episodes[0].progress, null)
  assert.equal((await b.json('/')).json.movies.find((m) => m.id === ids().secondMovie).progress.watched, true)
  assert.deepEqual((await b.post('/watched', { ids: [season1, ids().secondMovie], watched: false })).json, { updated: 2 })
  detail = (await b.json(`/series/${sid}`)).json
  assert.equal(detail.counts.watched, 0)
  // one unknown id among good ones still updates the rest; only unknown ids = NOT_FOUND
  assert.deepEqual((await b.post('/watched', { ids: [ids().secondMovie, '0'.repeat(31) + '1'], watched: true })).json, { updated: 1 })
  assert.equal((await b.post('/watched', { ids: ['0'.repeat(31) + '1'], watched: true })).json.error, 'NOT_FOUND')
  await b.post('/watched', { ids: [ids().secondMovie], watched: false })
  for (const body of [{}, { ids: [] }, { ids: 'x', watched: true }, { ids: ['nothex'], watched: true }, { ids: [5], watched: true }, { ids: [ids().testMovie] }, { ids: [ids().testMovie], watched: 'yes' }, { ids: Array.from({ length: 501 }, (_, i) => String(i).padStart(32, '0')), watched: true }]) {
    assert.equal((await b.post('/watched', body)).status, 400, JSON.stringify(body).slice(0, 80))
  }
  // exactly 500 ids are accepted (all unknown here -> 404, not 400)
  const five = await b.post('/watched', { ids: Array.from({ length: 500 }, (_, i) => String(i + 1).padStart(32, '0')), watched: true })
  assert.equal(five.status, 404)
})

test('favorite: toggles and returns the new state', async () => {
  const id = ids().coverMovie
  assert.deepEqual((await b.post('/favorite', { id, favorite: true })).json, { id, favorite: true })
  assert.equal((await b.json(`/video/${id}`)).json.favorite, true)
  assert.equal((await b.json('/')).json.movies.find((m) => m.id === id).favorite, true)
  assert.deepEqual((await b.post('/favorite', { id, favorite: false })).json, { id, favorite: false })
  const series = ids().shortShow
  assert.equal((await b.post('/favorite', { id: series, favorite: true })).json.favorite, true)
  assert.equal((await b.json(`/series/${series}`)).json.favorite, true)
  await b.post('/favorite', { id: series, favorite: false })
  for (const body of [{}, { id, favorite: 1 }, { id: 'zzz', favorite: true }, { favorite: true }, { id: [id], favorite: true }]) {
    assert.equal((await b.post('/favorite', body)).status, 400, JSON.stringify(body))
  }
  assert.equal((await b.post('/favorite', { id: '0'.repeat(31) + '1', favorite: true })).json.error, 'NOT_FOUND')
})

/* ------------------------------ images ------------------------------ */

test('image proxy: type and size mapping, headers, 404s', async () => {
  const id = ids().testMovie
  const res = await b.api(`/image/${id}?type=primary&w=360`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/jpeg')
  assert.equal(res.headers.get('cache-control'), 'private, max-age=86400')
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(res.headers.get('x-mock-maxwidth'), null, 'unknown upstream headers are not relayed')
  assert.equal(res.headers.get('server'), null)
  assert.equal((await res.arrayBuffer()).byteLength, 306)
  assert.equal(upstream(/GET \/Items\/.*\/Images\/Primary/).at(-1).query.maxWidth, '360')

  const sizes = { '': '400', '&w=100': '100', '&w=5000': '1920', '&w=1': '16', '&w=abc': '400', '&w=-5': '400', '&w=0': '400', '&w=100.4': '100' }
  for (const [param, expected] of Object.entries(sizes)) {
    const r = await b.api(`/image/${id}?type=backdrop${param}`)
    assert.equal(r.status, 200, param)
    await r.arrayBuffer()
    assert.equal(upstream(/GET \/Items\/.*\/Images\/Backdrop/).at(-1).query.maxWidth, expected, param)
  }
  await (await b.api(`/image/${id}`)).arrayBuffer()
  assert.equal(upstream(/Images\/Primary/).at(-1).path, `/Items/${id}/Images/Primary`, 'type defaults to primary')
  assert.equal((await b.api(`/image/${id}?type=THUMB`)).status, 404, 'Thumb type exists in the mapping; this item has none')
  assert.equal(upstream(/Images\/Thumb/).length > 0, true)
  assert.equal((await b.json(`/image/${ids().secondMovie}?type=primary`)).json.error, 'NOT_FOUND')
  assert.equal((await b.json(`/image/${id}?type=logo`)).json.error, 'BAD_REQUEST')
  assert.equal((await b.json(`/image/${id}?type=../Primary`)).status, 400)
  assert.equal((await b.json(`/image/${'0'.repeat(31)}1`)).json.error, 'NOT_FOUND')
})

/* ------------------------------ error mapping ------------------------------ */

test('Jellyfin 401 -> AUTH_EXPIRED (the connection stays stored); 5xx -> UPSTREAM_ERROR; gone -> SERVER_UNREACHABLE', async () => {
  const own = await startMockJellyfin()
  const c = await startBackend({ mock: own, clientOptions: { headersTimeoutMs: 500 } })
  try {
    assert.equal((await c.json('/')).status, 200)
    own.revokeTokens()
    for (const route of ['/?refresh=1', `/series/${own.ids.testShow}`, `/video/${own.ids.testMovie}`, `/mediainfo/${own.ids.testMovie}`, `/image/${own.ids.testMovie}`, `/stream/${own.ids.testMovie}`]) {
      const r = await c.api(route)
      assert.equal(r.status, 409, route)
      assert.equal((await r.json()).error, 'AUTH_EXPIRED', route)
    }
    assert.equal((await c.post('/watched', { ids: [own.ids.testMovie], watched: true })).json.error, 'AUTH_EXPIRED')
    assert.equal((await c.post('/favorite', { id: own.ids.testMovie, favorite: true })).json.error, 'AUTH_EXPIRED')
    assert.equal((await c.post(`/progress/${own.ids.testMovie}`, { position: 1, state: 'stop' })).json.error, 'AUTH_EXPIRED')
    assert.equal((await c.ipc.invoke('library:status')).connected, true, 'the stored server stays so the UI can reconnect')
    assert.equal((await c.connect()).ok, true)
    assert.equal((await c.json('/?refresh=1')).status, 200)

    own.fail(/GET \/Items/, 500)
    const err = await c.json('/?refresh=1')
    assert.deepEqual([err.status, err.json.error], [502, 'UPSTREAM_ERROR'])
    own.clearRules()
    own.fail(/GET \/Items/, 404)
    assert.equal((await c.json(`/video/${own.ids.testMovie}`)).status, 404)
    own.clearRules()

    own.hang(/GET \/Items/, 1)
    const slow = await c.json('/?refresh=1')
    assert.deepEqual([slow.status, slow.json.error], [502, 'SERVER_UNREACHABLE'])
    own.clearRules()

    await own.close()
    const gone = await c.json('/?refresh=1')
    assert.deepEqual([gone.status, gone.json.error], [502, 'SERVER_UNREACHABLE'])
    assert.equal((await c.json(`/video/${own.ids.testMovie}`)).json.error, 'SERVER_UNREACHABLE')
    assert.equal(JSON.stringify(gone.json).includes('127.0.0.1'), false, 'no server address in errors')
  } finally {
    await c.close()
    await own.close().catch(() => {})
  }
})

test('before connecting every data route answers NOT_CONNECTED (409) and /status says so', async () => {
  const c = await startBackend({ mock, connect: false })
  try {
    assert.deepEqual((await c.json('/status')).json, { connected: false, server: null })
    for (const route of ['/', `/series/${ids().testShow}`, `/video/${ids().testMovie}`, `/image/${ids().testMovie}`, `/stream/${ids().testMovie}`, `/mediainfo/${ids().testMovie}`, `/subtitles/${ids().testMovie}?track=0`, `/audio/${ids().testMovie}?track=2`]) {
      const r = await c.json(route)
      assert.deepEqual([r.status, r.json.error], [409, 'NOT_CONNECTED'], route)
    }
    assert.equal((await c.post('/watched', { ids: [ids().testMovie], watched: true })).json.error, 'NOT_CONNECTED')
  } finally {
    await c.close()
  }
})

test('a stored token that cannot be decrypted asks the UI for the password again', async () => {
  const c = await startBackend({ mock })
  const dataDir = c.dataDir
  const safe = c.safeStorage
  const stranger = { isEncryptionAvailable: () => true, encryptString: () => Buffer.alloc(0), decryptString: () => { throw new Error('other user') } }
  const d = await startBackend({ mock, connect: false, dataDir, safeStorage: stranger })
  try {
    assert.equal((await d.json('/status')).json.connected, true)
    assert.equal((await d.json('/')).json.error, 'AUTH_EXPIRED')
  } finally {
    await d.close()
    await c.close()
    void safe
  }
})
