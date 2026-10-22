// Records the golden samples of this folder from a REAL Jellyfin server (the testbed):
//
//   node scripts/jellyfin-testbed.mjs --root <dir> --cache <dir>        (prints { baseUrl, user, password, media, ... })
//   node test/library/golden/record.mjs --attach <baseUrl> [--user kaizen] [--password ...]
//
// Responses are saved with the exact shapes Jellyfin sends (the mock server in ../mock-jellyfin.mjs
// serves them back). Machine specific values are replaced: no paths, tokens, user / server ids or
// addresses of the machine that recorded them. This script is not part of `npm test`.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJellyfinClient } from '../../../src/main/library/jellyfin.js'
import { INDEX_QUERIES, NEIGHBOUR_EPISODES_FIELDS, SERIES_EPISODES_FIELDS } from '../../../src/main/library/queries.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const baseUrl = arg('--attach')
if (!baseUrl) throw new Error('usage: record.mjs --attach <baseUrl> [--user u] [--password p]')
const username = arg('--user', 'kaizen')
const password = arg('--password', 'Testbed-Pass-123')
const T = 1e7

const FAKE = {
  serverId: '5e7a1c2f6b3d4e8f9a0b1c2d3e4f5a6b',
  userId: 'c0ffee00c0ffee00c0ffee00c0ffee00',
  userName: 'kaizen'
}

/* ------------------------------ sanitising ------------------------------ */

const secrets = [] // [real, replacement]
let sanitizeJson = (value) => value
function sanitizeText(text) {
  let out = text
  for (const [real, fake] of secrets) out = out.split(real).join(fake)
  return out
}
function cleanTree(value) {
  if (Array.isArray(value)) return value.map(cleanTree)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, v] of Object.entries(value)) {
      if (key === 'ImageBlurHashes') continue // big and irrelevant
      if (key === 'Path' && typeof v === 'string') {
        out[key] = '/media/' + v.split(/[\\/]/).slice(-2).join('/')
      } else if (key === 'SessionInfo') continue
      else if (key === 'AccessToken') out[key] = 'REDACTED'
      else out[key] = cleanTree(v)
    }
    return out
  }
  return value
}
sanitizeJson = (value) => JSON.parse(sanitizeText(JSON.stringify(cleanTree(value))))

const written = []
function save(name, data) {
  const file = path.join(here, name)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const text = typeof data === 'string' ? sanitizeText(data) : JSON.stringify(sanitizeJson(data), null, 2) + '\n'
  fs.writeFileSync(file, text)
  written.push(name)
}

/* ------------------------------ session ------------------------------ */

const anon = createJellyfinClient({ baseUrl, deviceId: 'golden-recorder', appVersion: '3.0.0' })
const pub = await anon.publicInfo()
secrets.push([pub.Id, FAKE.serverId], [new URL(baseUrl).host, '127.0.0.1:8096'])
const auth = await anon.authenticate(username, password)
const token = auth.AccessToken
const userId = auth.User.Id
secrets.push([userId, FAKE.userId], [token, 'REDACTED'])
const client = createJellyfinClient({ baseUrl, token, userId, deviceId: 'golden-recorder', appVersion: '3.0.0' })

// raw requests (errors, headers)
const AUTH = (withToken) =>
  `MediaBrowser Client="Kaizen", Device="Kaizen Desktop", DeviceId="golden-recorder", Version="3.0.0"${withToken ? `, Token="${withToken}"` : ''}`
async function raw(method, route, { tok = token, headers = {}, body, keepOpen = false } = {}) {
  const controller = new AbortController()
  const res = await fetch(baseUrl + route, {
    method,
    headers: { Authorization: AUTH(tok), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal
  })
  const wanted = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag', 'cache-control']
  const picked = Object.fromEntries(wanted.filter((h) => res.headers.has(h)).map((h) => [h, res.headers.get(h)]))
  let text = ''
  if (!keepOpen) text = await res.text()
  else controller.abort()
  return { status: res.status, headers: picked, body: text.slice(0, 600) }
}

/* ------------------------------ helpers ------------------------------ */

const allItems = async (query) => {
  const out = []
  for (let start = 0; ; start += 500) {
    const page = await client.items({ ...query, StartIndex: start, Limit: 500 })
    out.push(...page.Items)
    if (out.length >= page.TotalRecordCount || page.Items.length === 0) return { Items: out, TotalRecordCount: page.TotalRecordCount, StartIndex: 0 }
  }
}

async function resetState() {
  const top = (await allItems({ IncludeItemTypes: 'Movie,Series', Recursive: true })).Items
  for (const item of top) {
    await client.setPlayed(item.Id, false)
    await client.setFavorite(item.Id, false)
  }
  const eps = (await allItems({ IncludeItemTypes: 'Episode', Recursive: true })).Items
  for (const e of eps) await client.setPlayed(e.Id, false)
}

const play = async (item, positionSeconds) => {
  await client.playback('start', { ItemId: item.Id, MediaSourceId: item.Id, PositionTicks: 0, PlayMethod: 'DirectPlay', CanSeek: true })
  await client.playback('stop', { ItemId: item.Id, MediaSourceId: item.Id, PositionTicks: Math.round(positionSeconds * T) })
}

async function snapshot(suffix) {
  save(`movies-page${suffix}.json`, await client.items({ ...INDEX_QUERIES.movies, StartIndex: 0, Limit: 500 }))
  save(`series-page${suffix}.json`, await client.items({ ...INDEX_QUERIES.series, StartIndex: 0, Limit: 500 }))
  save(`resume${suffix}.json`, await client.resume(INDEX_QUERIES.resume))
  save(`nextup${suffix}.json`, await client.nextUp(INDEX_QUERIES.nextUp))
  save(`played-episodes${suffix}.json`, await client.items({ ...INDEX_QUERIES.played, StartIndex: 0, Limit: 500 }))
}

/* ------------------------------ record ------------------------------ */

try {
  await resetState()

  // ---- public / auth / errors
  save('public-info.json', pub)
  save('auth-result.json', auth)
  const wrongPw = await raw('POST', '/Users/AuthenticateByName', { tok: null, body: { Username: username, Pw: 'wrong' } })
  const noUser = await raw('POST', '/Users/AuthenticateByName', { tok: null, body: { Username: 'nobody-here', Pw: 'x' } })
  const badToken = await raw('GET', '/Items?ids=00000000000000000000000000000001', { tok: 'deadbeefdeadbeefdeadbeefdeadbeef' })
  const noToken = await raw('GET', '/Items?ids=00000000000000000000000000000001', { tok: null })
  const legacyHeader = await fetch(baseUrl + '/Users/Me', { headers: { 'X-Emby-Token': token } })
  const apiKeyQuery = await fetch(baseUrl + '/Users/Me?api_key=' + token)

  // ---- catalog (clean state)
  await snapshot('')
  save('specials-seasons.json', await client.items({ ...INDEX_QUERIES.specials, StartIndex: 0, Limit: 500 }))
  const movies = (await client.items({ ...INDEX_QUERIES.movies, StartIndex: 0, Limit: 500 })).Items
  const series = (await client.items({ ...INDEX_QUERIES.series, StartIndex: 0, Limit: 500 })).Items
  const byName = (list, name) => list.find((i) => i.Name === name || i.Name.startsWith(name))
  const testMovie = byName(movies, 'Test Movie')
  const secondMovie = byName(movies, 'Second Movie')
  const testShow = byName(series, 'Test Show')
  const shortShow = byName(series, 'Short Show')

  const movieNames = { 'Test Movie': 'test-movie', 'Second Movie': 'second-movie', 'Hevc Movie': 'hevc-movie', 'Odd Layout': 'odd-layout', 'Cover Movie': 'cover-movie' }
  for (const [name, slug] of Object.entries(movieNames)) save(`item-${slug}.json`, await client.item(byName(movies, name).Id))
  save('item-series-test-show.json', await client.item(testShow.Id))
  save('item-series-short-show.json', await client.item(shortShow.Id))
  save('seasons-test-show.json', await client.seasons(testShow.Id))
  save('seasons-short-show.json', await client.seasons(shortShow.Id))
  const epsTest = await client.episodes(testShow.Id, { Fields: SERIES_EPISODES_FIELDS })
  save('episodes-test-show.json', epsTest)
  save('episodes-test-show-light.json', await client.episodes(testShow.Id, { Fields: NEIGHBOUR_EPISODES_FIELDS }))
  save('episodes-short-show.json', await client.episodes(shortShow.Id, { Fields: SERIES_EPISODES_FIELDS }))
  const e = (s, n) => epsTest.Items.find((x) => x.ParentIndexNumber === s && x.IndexNumber === n)
  save('item-episode-multi.json', await client.item(e(1, 3).Id))
  save('item-episode-pilot.json', await client.item(e(1, 1).Id))

  // ---- subtitles / stream / images
  const tm = await client.item(testMovie.Id)
  const sm = await client.item(secondMovie.Id)
  const streams = tm.MediaSources[0].MediaStreams
  const embedded = streams.find((s) => s.Type === 'Subtitle' && !s.IsExternal && s.Title === 'English')
  const external = streams.find((s) => s.IsExternal)
  save('subtitle-embedded-eng.vtt', await client.subtitleVtt(tm.Id, tm.MediaSources[0].Id, embedded.Index))
  save('subtitle-external-por.vtt', await client.subtitleVtt(tm.Id, tm.MediaSources[0].Id, external.Index))
  save('subtitle-movtext-eng.vtt', await client.subtitleVtt(sm.Id, sm.MediaSources[0].Id, sm.MediaSources[0].MediaStreams.find((s) => s.Type === 'Subtitle').Index))
  const subError = await raw('GET', `/Videos/${tm.Id}/${tm.MediaSources[0].Id}/Subtitles/1/0/Stream.vtt`)
  const subUnknown = await raw('GET', `/Videos/00000000000000000000000000000001/00000000000000000000000000000001/Subtitles/1/0/Stream.vtt`)
  const sUrl = `/Videos/${tm.Id}/stream?static=true&mediaSourceId=${tm.MediaSources[0].Id}`
  const streamHeaders = {
    head: await raw('HEAD', sUrl),
    full: await raw('GET', sUrl, { keepOpen: true }),
    range: await raw('GET', sUrl, { headers: { Range: 'bytes=0-99' } }),
    openRange: await raw('GET', sUrl, { headers: { Range: 'bytes=100-' }, keepOpen: true }),
    suffixRange: await raw('GET', sUrl, { headers: { Range: 'bytes=-50' } }),
    beyond: await raw('GET', sUrl, { headers: { Range: 'bytes=999999999-' } }),
    invalid: await raw('GET', sUrl, { headers: { Range: 'bytes=abc' }, keepOpen: true }),
    unknownItem: await raw('GET', `/Videos/00000000000000000000000000000001/stream?static=true`)
  }
  for (const r of Object.values(streamHeaders)) r.body = r.body.slice(0, 0)
  const img = async (route) => {
    const r = await raw('GET', route)
    return { status: r.status, headers: r.headers, body: r.status === 200 ? '<image bytes>' : r.body }
  }
  const imageResults = {
    primary: await img(`/Items/${tm.Id}/Images/Primary?maxWidth=100&quality=85`),
    backdrop: await img(`/Items/${tm.Id}/Images/Backdrop?maxWidth=800&quality=85`),
    thumbMissing: await img(`/Items/${tm.Id}/Images/Thumb?maxWidth=400`),
    noImageItem: await img(`/Items/${sm.Id}/Images/Primary?maxWidth=400`),
    badType: await img(`/Items/${tm.Id}/Images/Nonsense`),
    unknownItem: await img(`/Items/00000000000000000000000000000001/Images/Primary`)
  }
  const unknownIds = await client.items({ ids: '00000000000000000000000000000001' })

  save('errors.json', {
    wrongPassword: wrongPw,
    unknownUser: noUser,
    badToken,
    noToken,
    legacyTokenHeader: { status: legacyHeader.status },
    apiKeyQuery: { status: apiKeyQuery.status },
    subtitleNotASubtitle: subError,
    subtitleUnknownItem: subUnknown,
    unknownIds,
    imageResults,
    streamHeaders
  })

  // ---- user data endpoints
  const played = await raw('POST', `/UserPlayedItems/${e(1, 2).Id}?userId=${userId}`)
  const playedFull = await client.setPlayed(e(1, 2).Id, true)
  const unplayedFull = await client.setPlayed(e(1, 2).Id, false)
  const fav = await client.setFavorite(secondMovie.Id, true)
  const unfav = await client.setFavorite(secondMovie.Id, false)
  void played
  save('userdata-played.json', playedFull)
  save('userdata-unplayed.json', unplayedFull)
  save('userdata-favorite.json', fav)
  save('userdata-unfavorite.json', unfav)
  const seriesPlayed = await client.setPlayed(testShow.Id, true)
  save('userdata-series-played.json', seriesPlayed)
  await client.setPlayed(testShow.Id, false)

  // ---- progress: state after some activity
  await play(testMovie, 120) // in progress
  await play(e(1, 1), 305) // played
  await play(e(1, 2), 100) // in progress
  await client.setFavorite(secondMovie.Id, true)
  await snapshot('-progress')
  save('episodes-test-show-progress.json', await client.episodes(testShow.Id, { Fields: SERIES_EPISODES_FIELDS }))
  save('item-test-movie-progress.json', await client.item(testMovie.Id))
  save('seasons-test-show-progress.json', await client.seasons(testShow.Id))

  // a stop below 5 % clears the position, a progress report is kept as is (documented in the test)
  await client.playback('start', { ItemId: testMovie.Id, MediaSourceId: testMovie.Id, PositionTicks: 0 })
  await client.playback('stop', { ItemId: testMovie.Id, MediaSourceId: testMovie.Id, PositionTicks: 2 * T })
  save('item-test-movie-after-short-stop.json', await client.item(testMovie.Id))
} finally {
  await resetState()
}

// nothing of the recording machine may be left
const forbidden = [/AppData/i, /kaizen-jf-/i, /Users[\\/]/,new RegExp(token), new RegExp(userId), new RegExp(pub.Id), /Testbed-Pass/]
for (const name of written) {
  const text = fs.readFileSync(path.join(here, name), 'utf8')
  for (const re of forbidden) {
    if (re.test(text)) throw new Error(`${name} still contains ${re}`)
  }
}
console.log(`recorded ${written.length} samples in ${here}`)
