// End-to-end run of the library backend against a REAL Jellyfin server (NOT part of `npm test`).
//
//   node scripts/jellyfin-e2e.mjs [--root <parent dir for the testbed>] [--cache <zip cache dir>]
//   node scripts/jellyfin-e2e.mjs --attach <baseUrl> --media <media dir>   (reuse a running testbed; it is left running)
//
// It starts scripts/jellyfin-testbed.mjs (unless --attach), instantiates the real backend modules
// (src/main/library) with fake Electron dependencies (an http server on a free port serving the router,
// a fake safeStorage, the real ffmpeg / ffprobe from vendor/) and exercises the whole API.
// Exit code 0 = everything passed. Everything it starts is stopped / deleted, even on failure.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import cors from 'cors'
import express from 'express'
import { APP, startTestbed, TESTBED_PASSWORD, TESTBED_USER } from './jellyfin-testbed.mjs'
import { registerLibrary } from '../src/main/library/index.js'
import { PROBE_ENTRIES, buildMediaInfo } from '../src/main/media.js'
import { resolveTool, runProcess } from '../src/main/tools.js'

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}
const ffmpeg = resolveTool('ffmpeg', { resourcesPath: '', appPath: APP })
const ffprobe = resolveTool('ffprobe', { resourcesPath: '', appPath: APP })
const TOKEN = crypto.randomBytes(16).toString('hex')

const results = []
const log = (...parts) => process.stderr.write(parts.join(' ') + '\n')
async function check(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    log('  PASS', name)
  } catch (error) {
    results.push({
      name,
      ok: false,
      error: error?.stack?.split('\n').slice(0, 4).join(' | ') || String(error)
    })
    log('  FAIL', name, '->', error?.message || error)
  }
}

/* ------------------------------ fakes ------------------------------ */

function fakeSafeStorage() {
  const flip = (b) => Buffer.from([...b].reverse())
  return {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.concat([Buffer.from('FAKE:'), flip(Buffer.from(s))]),
    decryptString: (b) => flip(b.subarray(5)).toString()
  }
}

function fakeIpc() {
  const handlers = new Map()
  const listeners = new Map()
  return {
    on: (channel, fn) => listeners.set(channel, fn),
    handle: (channel, fn) => handlers.set(channel, fn),
    invoke: (channel, ...args) => handlers.get(channel)({}, ...args),
    sendSync: (channel) => {
      const event = {}
      listeners.get(channel)(event)
      return event.returnValue
    }
  }
}

// a "translator" that proves it was used
const translateCues = async (cues) => ({
  cues: cues.map((c) => ({ ...c, t: `[PT] ${c.t}` })),
  failed: false
})

/* ------------------------------ helpers ------------------------------ */

let base = ''
const api = (route, { token = TOKEN, headers = {}, method = 'GET', body, signal } = {}) => {
  const url = `${base}${route}${token === null ? '' : (route.includes('?') ? '&' : '?') + 't=' + token}`
  return fetch(url, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal
  })
}
const getJson = async (route, options) => {
  const res = await api(route, options)
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* not json */
  }
  return { status: res.status, json, text, headers: res.headers }
}
const postJson = (route, body) => getJson(route, { method: 'POST', body })

const probeFile = async (file) =>
  JSON.parse(
    await runProcess(ffprobe, ['-v', 'error', '-show_entries', PROBE_ENTRIES, '-of', 'json', file])
  )

// frequency of the dominant tone in an audio file (decoded to mono PCM, counted by zero crossings)
async function toneHz(file) {
  const pcm = await new Promise((resolve, reject) => {
    const proc = spawn(
      ffmpeg,
      ['-v', 'error', '-i', file, '-ac', '1', '-ar', '48000', '-f', 's16le', 'pipe:1'],
      { windowsHide: true }
    )
    const chunks = []
    proc.stdout.on('data', (c) => chunks.push(c))
    proc.on('error', reject)
    proc.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`ffmpeg decode exited ${code}`))
    )
  })
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2))
  let crossings = 0
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] < 0 !== samples[i] < 0) crossings++
  return Math.round(crossings / 2 / (samples.length / 48000))
}

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------ run ------------------------------ */

const cleanup = []
let bed = null

async function main() {
  const attach = arg('--attach')
  let server
  let mediaDir
  if (attach) {
    server = {
      baseUrl: attach,
      user: arg('--user') || TESTBED_USER,
      password: arg('--password') || TESTBED_PASSWORD
    }
    mediaDir = arg('--media')
    assert.ok(mediaDir, '--media <media dir of the running testbed> is required with --attach')
  } else {
    bed = await startTestbed({ parentDir: arg('--root') || os.tmpdir(), cacheDir: arg('--cache') })
    cleanup.push(() => bed.stop())
    server = bed
    mediaDir = bed.dirs.media
  }
  const moviesDir = path.join(mediaDir, 'Movies')
  const movieFile = (name, ext) => path.join(moviesDir, name, `${name}.${ext}`)

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaizen-e2e-'))
  cleanup.push(() => fs.rmSync(dataDir, { recursive: true, force: true }))

  // the backend as main/index.js builds it: cors + json + the library router
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '200kb' }))
  const ipc = fakeIpc()
  const safeStorage = fakeSafeStorage()
  const httpServer = http.createServer(app)
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  const port = httpServer.address().port
  base = `http://127.0.0.1:${port}/library`
  const library = registerLibrary(app, {
    app: null,
    ipcMain: ipc,
    safeStorage,
    appVersion: '3.0.0-e2e',
    getMainWindow: () => null,
    dataDir,
    ffmpegPath: ffmpeg,
    ffprobePath: ffprobe,
    translateCues,
    getBackendPort: () => port,
    token: TOKEN,
    log: (m) => log('    [library]', m)
  })
  cleanup.push(() => library.close())
  cleanup.push(
    () => new Promise((resolve) => (httpServer.closeAllConnections?.(), httpServer.close(resolve)))
  )
  const stored = () =>
    JSON.parse(fs.readFileSync(path.join(dataDir, 'library-server.json'), 'utf8'))

  /* ---------------- connect ---------------- */
  log('\n== connect')
  await check('ipc token is the per-run secret', async () =>
    assert.equal(ipc.sendSync('library:token'), TOKEN)
  )
  await check('status before connecting', async () =>
    assert.deepEqual(await ipc.invoke('library:status'), { connected: false, server: null })
  )
  await check('routes answer NOT_CONNECTED before connecting', async () => {
    const r = await getJson('/')
    assert.equal(r.status, 409)
    assert.equal(r.json.error, 'NOT_CONNECTED')
  })
  await check('connect: bad URL', async () => {
    for (const url of ['ftp://host', 'http://', '', 'javascript:alert(1)']) {
      const r = await ipc.invoke('library:connect', { url, username: 'a', password: 'b' })
      assert.equal(r.error, 'BAD_URL', url)
    }
  })
  await check('connect: unreachable server', async () => {
    const r = await ipc.invoke('library:connect', {
      url: 'http://127.0.0.1:1',
      username: 'a',
      password: 'b'
    })
    assert.deepEqual([r.ok, r.error], [false, 'UNREACHABLE'])
  })
  await check('connect: not a Jellyfin server (our own backend)', async () => {
    const r = await ipc.invoke('library:connect', {
      url: `http://127.0.0.1:${port}`,
      username: 'a',
      password: 'b'
    })
    assert.deepEqual([r.ok, r.error], [false, 'NOT_JELLYFIN'])
  })
  await check('connect: wrong password', async () => {
    const r = await ipc.invoke('library:connect', {
      url: server.baseUrl,
      username: server.user,
      password: 'wrong'
    })
    assert.deepEqual([r.ok, r.error], [false, 'BAD_CREDENTIALS'])
    assert.equal(JSON.stringify(r).includes('wrong'), false)
  })
  await check('connect: unknown user', async () => {
    const r = await ipc.invoke('library:connect', {
      url: server.baseUrl,
      username: 'nobody-here',
      password: 'x'
    })
    assert.deepEqual([r.ok, r.error], [false, 'BAD_CREDENTIALS'])
  })
  await check('connect: good (url written the messy way)', async () => {
    const r = await ipc.invoke('library:connect', {
      url: `  ${server.baseUrl}/web/index.html#/home.html `,
      username: server.user,
      password: server.password
    })
    assert.equal(r.ok, true, JSON.stringify(r))
    assert.deepEqual(Object.keys(r.server).sort(), [
      'allowInvalidCert',
      'host',
      'name',
      'url',
      'userName',
      'version'
    ])
    assert.equal(r.server.url, server.baseUrl)
    assert.equal(r.server.allowInvalidCert, false)
    assert.equal(r.server.userName, server.user)
    assert.match(r.server.version, /^\d+\.\d+/)
    assert.equal(r.server.host, new URL(server.baseUrl).host)
  })
  await check('stored file: no password, token not in clear text', async () => {
    const raw = fs.readFileSync(path.join(dataDir, 'library-server.json'), 'utf8')
    assert.equal(raw.includes(server.password), false)
    const file = stored()
    assert.equal(file.server.token.enc, true)
    assert.ok(file.deviceId && file.server.deviceId === file.deviceId)
    // the clear token is a 32 hex chars Jellyfin access token: it must not appear anywhere in the file
    assert.equal(
      /[a-f0-9]{32}/.test(raw.replace(file.server.userId, '').replace(file.server.serverId, '')),
      false
    )
  })
  await check('status after connecting', async () => {
    const s = await ipc.invoke('library:status')
    assert.equal(s.connected, true)
    const http = await getJson('/status')
    assert.deepEqual(http.json, s)
    assert.equal(JSON.stringify(http.json).includes('Token'), false)
  })

  /* ---------------- security ---------------- */
  log('\n== security')
  await check('token required on every route (query or header), wrong token refused', async () => {
    for (const route of [
      '/status',
      '/',
      '/series/' + 'a'.repeat(32),
      '/video/' + 'a'.repeat(32),
      '/image/' + 'a'.repeat(32),
      '/stream/' + 'a'.repeat(32),
      '/mediainfo/' + 'a'.repeat(32),
      '/subtitles/' + 'a'.repeat(32) + '?track=0',
      '/audio/' + 'a'.repeat(32) + '?track=0'
    ]) {
      const none = await api(route, { token: null })
      assert.equal(none.status, 401, route)
      assert.equal((await none.json()).error, 'UNAUTHORIZED')
      assert.equal((await api(route, { token: 'nope' })).status, 401, route)
    }
    const viaHeader = await api('/status', { token: null, headers: { 'X-Kaizen-Token': TOKEN } })
    assert.equal(viaHeader.status, 200)
  })
  await check('ids are validated before any upstream call', async () => {
    for (const bad of [
      '..%2F..%2Fetc%2Fpasswd',
      'abc',
      'x'.repeat(32),
      '%00',
      '1'.repeat(33),
      'http%3A%2F%2Fevil.test'
    ]) {
      for (const kind of ['series', 'video', 'image', 'stream', 'mediainfo']) {
        const r = await api(`/${kind}/${bad}`)
        assert.equal(r.status, 400, `${kind}/${bad}`)
      }
    }
  })

  /* ---------------- index ---------------- */
  log('\n== catalog')
  let index
  await check('index: shape, counts, ordering', async () => {
    const r = await getJson('/')
    assert.equal(r.status, 200)
    index = r.json
    assert.equal(r.headers.get('cache-control'), 'no-store')
    assert.deepEqual(Object.keys(index).sort(), [
      'continueWatching',
      'counts',
      'fetchedAt',
      'movies',
      'series',
      'server'
    ])
    assert.deepEqual(index.counts, { movies: 5, series: 2, episodes: 7 })
    const titles = index.movies.map((m) => m.title)
    assert.deepEqual(
      titles,
      [...titles].sort((a, b) => a.localeCompare(b, 'und', { sensitivity: 'base', numeric: true }))
    )
    const m = index.movies.find((x) => x.title === 'Test Movie')
    assert.match(m.key, /^m:[a-f0-9]{32}$/)
    assert.equal(m.id, m.key.slice(2))
    assert.deepEqual(
      Object.keys(m).sort(),
      [
        'addedAt',
        'duration',
        'favorite',
        'genres',
        'hasImage',
        'height',
        'id',
        'key',
        'progress',
        'rating',
        'title',
        'width',
        'year'
      ].sort()
    )
    assert.equal(m.year, 2020)
    assert.equal(m.duration, 310.021)
    assert.deepEqual([m.width, m.height], [320, 180])
    assert.equal(m.rating, 7.8)
    assert.deepEqual(m.genres, ['Drama', 'Science Fiction'])
    assert.equal(m.hasImage, true)
    assert.equal(m.progress, null)
    assert.ok(m.addedAt > Date.now() - 24 * 3600 * 1000)
    const second = index.movies.find((x) => x.title.startsWith('Second Movie'))
    assert.equal(
      second.title,
      'Second Movie',
      'the "(2018)" of the folder name is not part of the title'
    )
    assert.equal(second.hasImage, false)
    assert.equal(second.rating, null)
    const s = index.series.find((x) => x.title === 'Test Show')
    assert.match(s.key, /^s:[a-f0-9]{32}$/)
    assert.equal(s.seasons, 2, 'specials are not counted as a season')
    assert.equal(s.episodes, 5)
    assert.equal(s.watched, 0)
    assert.equal(s.hasImage, true)
    assert.equal(s.rating, 8.4)
    assert.equal(s.lastWatchedAt, null)
    assert.equal(index.series.find((x) => x.title === 'Short Show').seasons, 1)
  })
  await check(
    'index: second call is served from the cache; ?refresh=1 forces a new fetch',
    async () => {
      const a = await getJson('/')
      assert.equal(a.json.fetchedAt, index.fetchedAt)
      await sleep(5)
      const b = await getJson('/?refresh=1')
      assert.ok(b.json.fetchedAt > index.fetchedAt)
    }
  )

  const seriesId = () => index.series.find((s) => s.title === 'Test Show').id
  let series
  await check('series: seasons (specials last), episodes, multi-episode, nextUp', async () => {
    const r = await getJson('/series/' + seriesId())
    assert.equal(r.status, 200)
    series = r.json
    assert.equal(series.title, 'Test Show')
    assert.equal(series.status, 'Continuing')
    assert.equal(series.officialRating, 'TV-14')
    assert.equal(series.overview, 'A generated show used to test the Kaizen library backend.')
    assert.equal(series.hasImage, true)
    assert.equal(series.hasBackdrop, true)
    assert.deepEqual(series.counts, { seasons: 2, episodes: 5, watched: 0 })
    assert.deepEqual(
      series.seasons.map((s) => s.season),
      [1, 2, 0]
    )
    const s1 = series.seasons[0]
    assert.deepEqual(
      s1.episodes.map((e) => e.label),
      ['S01E01', 'S01E02', 'S01E03-E04']
    )
    const multi = s1.episodes[2]
    assert.deepEqual([multi.episode, multi.episodeEnd], [3, 4])
    assert.equal(multi.title, 'Double Feature / Double Feature 2')
    const pilot = s1.episodes[0]
    assert.equal(pilot.title, 'Pilot')
    assert.equal(pilot.overview, 'The first episode.')
    assert.equal(pilot.duration, 310.021)
    assert.equal(pilot.hasImage, true)
    assert.equal(pilot.airDate, '2015-01-01T00:00:00.000Z')
    assert.equal(pilot.progress, null)
    assert.equal(s1.episodes[1].hasImage, false)
    assert.equal(series.seasons[2].episodes[0].label, 'S00E01')
    assert.equal(series.nextUp.label, 'S01E01', 'nothing watched: start at the first episode')
  })
  await check('series: a movie id is NOT_FOUND, an unknown id is NOT_FOUND', async () => {
    const movieId = index.movies[0].id
    assert.equal((await getJson('/series/' + movieId)).status, 404)
    assert.equal((await getJson('/series/' + '0'.repeat(31) + '1')).json.error, 'NOT_FOUND')
  })

  const movie = (title) => index.movies.find((m) => m.title === title)
  await check('video: movie with 3 audio tracks, embedded + external subtitles', async () => {
    const r = await getJson('/video/' + movie('Test Movie').id)
    assert.equal(r.status, 200)
    const v = r.json
    assert.equal(v.kind, 'movie')
    assert.equal(v.fileName, 'Test Movie (2020).mkv')
    assert.ok(v.size > 1000000)
    assert.equal(v.container, 'mkv')
    assert.equal(v.vcodec, 'h264')
    assert.equal(v.audio.length, 3)
    assert.deepEqual(
      v.audio.map((a) => a.lang),
      ['jpn', 'eng', 'por']
    )
    assert.equal(v.audio[1].channels, 6)
    assert.equal(v.subs.length, 4)
    assert.equal(v.subs.filter((s) => s.external).length, 1)
    assert.equal(v.subs.find((s) => s.external).lang, 'por')
    assert.equal(v.subs.find((s) => s.forced).title, 'Signs & Songs')
    assert.deepEqual(v.playback, { supported: true, reason: null })
    assert.equal(v.prev, null)
    assert.equal(v.next, null)
    assert.equal(v.seriesId, null)
    assert.equal(v.label, null)
    assert.equal(v.hasBackdrop, true)
  })
  await check('video: hevc is flagged as not directly playable', async () => {
    const r = await getJson('/video/' + movie('Hevc Movie').id)
    assert.deepEqual(r.json.playback, { supported: false, reason: 'video-codec' })
  })
  await check('video: episode with prev / next across seasons', async () => {
    const s1 = series.seasons[0].episodes
    const second = (await getJson('/video/' + s1[1].id)).json
    assert.equal(second.kind, 'episode')
    assert.equal(second.label, 'S01E02')
    assert.equal(second.seriesTitle, 'Test Show')
    assert.equal(second.seriesId, seriesId())
    assert.deepEqual(second.prev, { id: s1[0].id, label: 'S01E01', title: 'Pilot' })
    assert.equal(second.next.label, 'S01E03-E04')
    const lastOfS1 = (await getJson('/video/' + s1[2].id)).json
    assert.equal(lastOfS1.next.label, 'S02E01', 'next crosses into the following season')
    const first = (await getJson('/video/' + s1[0].id)).json
    assert.equal(first.prev, null)
    const special = (await getJson('/video/' + series.seasons[2].episodes[0].id)).json
    assert.deepEqual([special.prev, special.next], [null, null], 'specials only link to specials')
  })

  /* ---------------- images ---------------- */
  log('\n== images / stream')
  await check('image proxy: primary, backdrop, sizes, 404s, cache header', async () => {
    const id = movie('Test Movie').id
    const small = await api(`/image/${id}?type=primary&w=100`)
    assert.equal(small.status, 200)
    assert.match(small.headers.get('content-type'), /^image\//)
    assert.equal(small.headers.get('cache-control'), 'private, max-age=86400')
    const smallBytes = (await small.arrayBuffer()).byteLength
    const big = await (await api(`/image/${id}?type=primary&w=1200`)).arrayBuffer()
    assert.ok(big.byteLength > smallBytes, 'w changes the size')
    assert.equal((await api(`/image/${id}?type=backdrop&w=800`)).status, 200)
    assert.equal((await api(`/image/${id}?type=thumb`)).status, 404)
    assert.equal((await api(`/image/${movie('Second Movie').id}?type=primary`)).status, 404)
    assert.equal((await api(`/image/${id}?type=bogus`)).status, 400)
    assert.equal((await api(`/image/${id}`)).status, 200, 'type defaults to primary')
  })

  const tm = () => movie('Test Movie').id
  await check('stream: 200, Range 206, open ranges, HEAD, 416, bytes equal the file', async () => {
    const file = movieFile('Test Movie (2020)', 'mkv')
    const size = fs.statSync(file).size
    const head = await api('/stream/' + tm(), { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(Number(head.headers.get('content-length')), size)
    assert.equal(head.headers.get('accept-ranges'), 'bytes')
    assert.match(head.headers.get('content-type'), /matroska/)
    const part = await api('/stream/' + tm(), { headers: { Range: 'bytes=1000-1999' } })
    assert.equal(part.status, 206)
    assert.equal(part.headers.get('content-range'), `bytes 1000-1999/${size}`)
    const bytes = Buffer.from(await part.arrayBuffer())
    const onDisk = Buffer.alloc(1000)
    const fd = fs.openSync(file, 'r')
    fs.readSync(fd, onDisk, 0, 1000, 1000)
    fs.closeSync(fd)
    assert.ok(bytes.equals(onDisk), 'the proxied bytes are the file bytes')
    const tail = await api('/stream/' + tm(), { headers: { Range: 'bytes=-100' } })
    assert.equal(tail.status, 206)
    assert.equal((await tail.arrayBuffer()).byteLength, 100)
    const beyond = await api('/stream/' + tm(), { headers: { Range: `bytes=${size + 10}-` } })
    assert.equal(beyond.status, 416)
    await beyond.arrayBuffer()
    // junk Range headers are ignored (full answer), never forwarded
    const junk = await api('/stream/' + tm(), { headers: { Range: 'bytes=0-1;evil' } })
    assert.equal(junk.status, 200)
    await junk.body.cancel()
  })
  await check(
    'stream: the client Authorization header is not forwarded (upstream would reject a bad token)',
    async () => {
      const r = await api('/stream/' + tm(), {
        headers: {
          Authorization: 'MediaBrowser Token="deadbeef"',
          Range: 'bytes=0-9',
          Cookie: 'x=y'
        }
      })
      assert.equal(r.status, 206)
      await r.arrayBuffer()
    }
  )
  await check('stream: aborting the download closes the upstream connection', async () => {
    const controller = new AbortController()
    const res = await api('/stream/' + tm(), { signal: controller.signal })
    const reader = res.body.getReader()
    await reader.read()
    controller.abort()
    await sleep(300)
    // the proxy must still serve the next request fine and must not hold sockets forever
    const again = await api('/stream/' + tm(), { headers: { Range: 'bytes=0-9' } })
    assert.equal(again.status, 206)
    await again.arrayBuffer()
  })

  /* ---------------- tracks ---------------- */
  log('\n== tracks')
  await check(
    'mediainfo: Test Movie (side-car subtitle shifts Jellyfin indexes by one)',
    async () => {
      const info = (await getJson('/mediainfo/' + tm())).json
      const truth = buildMediaInfo(await probeFile(movieFile('Test Movie (2020)', 'mkv')))
      assert.equal(info.audio.length, 3)
      assert.deepEqual(
        info.audio.map((a) => [a.lang, a.title, a.codec, a.channels, a.supported]),
        truth.audio.map((a) => [a.lang, a.title, a.codec, a.channels, a.supported])
      )
      assert.deepEqual(
        info.subtitles.filter((s) => !s.external).map((s) => [s.lang, s.title, s.codec, s.text]),
        truth.subtitles.map((s) => [s.lang, s.title, s.codec, s.text])
      )
      assert.equal(info.subtitles.filter((s) => s.external).length, 1)
      assert.equal(
        info.autoPtSource,
        null,
        'a Portuguese track exists, so no automatic translation'
      )
      assert.deepEqual(info.playback, { supported: true, reason: null })
      assert.equal(info.container, truth.container)
      assert.deepEqual(
        info.video,
        { ...truth.video, id: truth.video.id + 1 },
        'same video, Jellyfin numbers it after the external subtitle'
      )
      // ids differ from ffprobe's on purpose (Jellyfin Index); that is why the audio route maps by position
      assert.notEqual(info.audio[0].id, truth.audio[0].id)
    }
  )
  await check(
    'mediainfo: files without side-car subtitles equal buildMediaInfo(ffprobe)',
    async () => {
      for (const [name, ext] of [
        ['Odd Layout (2022)', 'mkv'],
        ['Second Movie (2018)', 'mp4'],
        ['Hevc Movie (2019)', 'mkv'],
        ['Cover Movie (2023)', 'mp4']
      ]) {
        const title = name.replace(/ \(\d{4}\)$/, '')
        const info = (await getJson('/mediainfo/' + movie(title).id)).json
        const truth = buildMediaInfo(await probeFile(movieFile(name, ext)))
        const { playback, ...rest } = info
        // mp4: ffmpeg writes a track's `title` as the QuickTime handler name, which ffprobe lists as
        // `handler_name` (not `title`) and Jellyfin shows as the title
        const noTitle = (list) => (ext === 'mp4' ? list.map((t) => ({ ...t, title: '' })) : list)
        const subs = rest.subtitles.map(({ external, ...s }) => s)
        assert.deepEqual(
          {
            ...rest,
            audio: noTitle(rest.audio),
            subtitles: noTitle(subs),
            duration: Math.round(rest.duration)
          },
          {
            ...truth,
            audio: noTitle(truth.audio),
            subtitles: noTitle(truth.subtitles),
            duration: Math.round(truth.duration)
          },
          name
        )
        assert.equal(typeof playback.supported, 'boolean')
      }
    }
  )

  await check('subtitles: embedded track, window slicing, external track, defaults', async () => {
    const info = (await getJson('/mediainfo/' + tm())).json
    const eng = info.subtitles.find((s) => s.lang === 'eng' && s.title === 'English')
    const r = await getJson(`/subtitles/${tm()}?track=${eng.id}&from=0&len=25`)
    assert.equal(r.status, 200)
    assert.deepEqual([r.json.from, r.json.len, r.json.source], [0, 25, 'native'])
    assert.deepEqual(
      r.json.cues.map((c) => c.t),
      ['English 1', 'English 2', 'English 3']
    )
    assert.deepEqual(r.json.cues[0], { s: 1, e: 3, t: 'English 1' })
    const later = await getJson(`/subtitles/${tm()}?track=${eng.id}&from=100&len=30`)
    assert.ok(later.json.cues.length >= 3 && later.json.cues.every((c) => c.e >= 100 && c.s <= 130))
    const ext = info.subtitles.find((s) => s.external)
    const e = await getJson(`/subtitles/${tm()}?track=${ext.id}&from=0&len=15`)
    assert.deepEqual(
      e.json.cues.map((c) => c.t),
      ['Legenda externa 1', 'Legenda externa 2']
    )
    const clamp = await getJson(`/subtitles/${tm()}?track=${eng.id}&from=-5&len=1`)
    assert.deepEqual([clamp.json.from, clamp.json.len], [0, 10])
  })
  await check(
    'subtitles: errors (video track, missing track, bad param, auto-pt without source)',
    async () => {
      const info = (await getJson('/mediainfo/' + tm())).json
      assert.equal((await getJson(`/subtitles/${tm()}?track=${info.video.id}`)).status, 404)
      assert.equal((await getJson(`/subtitles/${tm()}?track=999`)).status, 404)
      assert.equal((await getJson(`/subtitles/${tm()}?track=abc`)).status, 400)
      assert.equal((await getJson(`/subtitles/${tm()}`)).status, 400)
      assert.equal((await getJson(`/subtitles/${tm()}?track=auto-pt`)).json.error, 'NOT_FOUND')
    }
  )
  await check('subtitles: auto-pt translates the English source (fake translator)', async () => {
    const id = movie('Second Movie').id
    const info = (await getJson('/mediainfo/' + id)).json
    assert.notEqual(info.autoPtSource, null)
    const r = await getJson(`/subtitles/${id}?track=auto-pt&from=0&len=60`)
    assert.equal(r.json.source, 'translated')
    assert.deepEqual(
      r.json.cues.map((c) => c.t),
      ['[PT] English 1', '[PT] English 2', '[PT] English 3']
    )
    const native = await getJson(`/subtitles/${id}?track=${info.autoPtSource}&from=0&len=60`)
    assert.equal(native.json.source, 'native')
    assert.equal(native.json.cues[0].t, 'English 1')
  })

  await check('audio: the 2nd audio track (eac3 5.1, 880 Hz) comes out as stereo AAC', async () => {
    const info = (await getJson('/mediainfo/' + tm())).json
    const eng = info.audio.find((a) => a.lang === 'eng')
    assert.equal(eng.codec, 'eac3')
    const tmpFile = path.join(dataDir, 'audio-eng.aac')
    const res = await api(`/audio/${tm()}?track=${eng.id}&start=0`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'audio/aac')
    const out = fs.createWriteStream(tmpFile)
    const reader = res.body.getReader()
    let total = 0
    while (total < 60000) {
      const { value, done } = await reader.read()
      if (done) break
      out.write(value)
      total += value.length
    }
    await reader.cancel()
    await new Promise((resolve) => out.end(resolve))
    const probe = JSON.parse(
      await runProcess(ffprobe, [
        '-v',
        'error',
        '-show_entries',
        'stream=codec_name,channels,codec_type',
        '-of',
        'json',
        tmpFile
      ])
    )
    assert.deepEqual(
      [probe.streams[0].codec_type, probe.streams[0].codec_name, probe.streams[0].channels],
      ['audio', 'aac', 2]
    )
    const hz = await toneHz(tmpFile)
    assert.ok(Math.abs(hz - 880) < 25, `expected ~880 Hz (the 2nd track), got ${hz}`)
    // and the first / third tracks are different tones
    for (const [lang, expected] of [
      ['jpn', 440],
      ['por', 660]
    ]) {
      const a = info.audio.find((x) => x.lang === lang)
      const r2 = await api(`/audio/${tm()}?track=${a.id}&start=5`)
      const file = path.join(dataDir, `audio-${lang}.aac`)
      const reader2 = r2.body.getReader()
      const out2 = fs.createWriteStream(file)
      let got = 0
      while (got < 40000) {
        const { value, done } = await reader2.read()
        if (done) break
        out2.write(value)
        got += value.length
      }
      await reader2.cancel()
      await new Promise((resolve) => out2.end(resolve))
      const f = await toneHz(file)
      assert.ok(Math.abs(f - expected) < 25, `${lang}: expected ~${expected} Hz, got ${f}`)
    }
  })
  await check('audio: bad requests, and aborting the download stops ffmpeg', async () => {
    assert.equal((await api(`/audio/${tm()}`)).status, 400)
    assert.equal((await api(`/audio/${tm()}?track=999`)).status, 404)
    const info = (await getJson('/mediainfo/' + tm())).json
    const controller = new AbortController()
    const res = await api(`/audio/${tm()}?track=${info.audio[0].id}`, { signal: controller.signal })
    const reader = res.body.getReader()
    await reader.read()
    assert.ok(library.tracks.activeAudio >= 1)
    const pids = [...library.tracks.processes].map((p) => p.pid)
    controller.abort()
    for (let i = 0; i < 40 && (library.tracks.activeAudio > 0 || pids.some(pidAlive)); i++)
      await sleep(100)
    assert.equal(library.tracks.activeAudio, 0)
    assert.equal(pids.some(pidAlive), false, 'ffmpeg exited')
  })

  /* ---------------- progress / user data ---------------- */
  log('\n== progress / watched / favorite')
  const progress = (id, body) => postJson('/progress/' + id, body)
  await check(
    'progress: start / progress / stop saves the position and feeds continueWatching',
    async () => {
      const id = tm()
      assert.equal((await progress(id, { position: 0, duration: 310, state: 'start' })).status, 200)
      const p = await progress(id, { position: 100, duration: 310, state: 'progress' })
      assert.deepEqual(p.json, {
        progress: { position: 100, duration: 310.021, watched: false },
        watched: false
      })
      const s = await progress(id, { position: 120, state: 'stop' })
      assert.deepEqual(s.json, {
        progress: { position: 120, duration: 310.021, watched: false },
        watched: false
      })
      const fresh = (await getJson('/')).json
      const m = fresh.movies.find((x) => x.id === id)
      assert.deepEqual(m.progress, { position: 120, duration: 310.021, watched: false })
      const c = fresh.continueWatching.find((x) => x.videoId === id)
      assert.ok(c, 'in continueWatching')
      assert.deepEqual(
        {
          type: c.type,
          key: c.key,
          title: c.title,
          position: c.position,
          next: c.next,
          label: c.label,
          seriesId: c.seriesId
        },
        {
          type: 'movie',
          key: 'm:' + id,
          title: 'Test Movie',
          position: 120,
          next: false,
          label: null,
          seriesId: null
        }
      )
      assert.ok(c.updatedAt > Date.now() - 60000)
    }
  )
  await check('progress: a stop below 5 s does not erase the saved position', async () => {
    const id = tm()
    await progress(id, { position: 0, state: 'start' })
    const s = await progress(id, { position: 2, state: 'stop' })
    assert.equal(s.json.progress.position, 120)
    await progress(id, { position: 3, state: 'pause' })
    const fresh = (await getJson('/video/' + id)).json
    assert.equal(fresh.progress.position, 120)
  })
  await check('progress: validation', async () => {
    const id = tm()
    for (const body of [
      {},
      { position: -1 },
      { position: 'x' },
      { position: 1, state: 'dance' },
      { position: 1e9 },
      { position: 5, duration: 'long' }
    ]) {
      assert.equal((await progress(id, body)).status, 400, JSON.stringify(body))
    }
    assert.equal((await postJson('/progress/nothex', { position: 1 })).status, 400)
    assert.equal((await progress('0'.repeat(31) + '1', { position: 1, state: 'stop' })).status, 404)
    const huge = await api('/progress/' + id, {
      method: 'POST',
      body: { position: 1, pad: 'x'.repeat(9000) }
    })
    assert.equal(huge.status, 400, 'bodies over 8 KB are refused')
  })
  await check(
    'progress: finishing the movie marks it watched; the resume point is gone',
    async () => {
      const id = tm()
      const r = await progress(id, { position: 300, state: 'stop' })
      assert.equal(r.json.watched, true)
      assert.deepEqual(r.json.progress, { position: 0, duration: 310.021, watched: true })
      const fresh = (await getJson('/')).json
      assert.equal(
        fresh.continueWatching.some((x) => x.videoId === id),
        false
      )
      assert.equal(fresh.movies.find((x) => x.id === id).progress.watched, true)
    }
  )
  await check('watched: toggle a movie back, then a whole series', async () => {
    const id = tm()
    assert.deepEqual((await postJson('/watched', { ids: [id], watched: false })).json, {
      updated: 1
    })
    assert.equal((await getJson('/')).json.movies.find((x) => x.id === id).progress, null)
    const sid = seriesId()
    assert.deepEqual((await postJson('/watched', { ids: [sid], watched: true })).json, {
      updated: 1
    })
    const after = (await getJson('/?refresh=1')).json
    const s = after.series.find((x) => x.id === sid)
    assert.equal(s.watched, 5)
    const detail = (await getJson('/series/' + sid)).json
    assert.equal(detail.counts.watched, 5)
    assert.equal(detail.nextUp, null, 'everything watched')
    // Jellyfin 12.2's GET /Items/{id} serves stale user data after a cascade like this one: the client must not use it
    const firstEpisode = detail.seasons[0].episodes[0].id
    assert.equal((await getJson('/video/' + firstEpisode)).json.progress.watched, true)
    assert.deepEqual((await postJson('/watched', { ids: [sid], watched: false })).json, {
      updated: 1
    })
    assert.equal((await getJson('/series/' + sid)).json.counts.watched, 0)
    assert.equal((await getJson('/video/' + firstEpisode)).json.progress, null)
  })
  await check('watched: validation', async () => {
    assert.equal((await postJson('/watched', { ids: [], watched: true })).status, 400)
    assert.equal((await postJson('/watched', { ids: ['zzz'], watched: true })).status, 400)
    assert.equal((await postJson('/watched', { ids: [tm()], watched: 'yes' })).status, 400)
    assert.equal(
      (await postJson('/watched', { ids: Array.from({ length: 501 }, () => tm()), watched: true }))
        .status,
      400
    )
    assert.equal(
      (await postJson('/watched', { ids: ['0'.repeat(31) + '1'], watched: true })).status,
      404
    )
  })
  await check('series: continue / next-up after watching episodes', async () => {
    const sid = seriesId()
    const [e1, e2] = series.seasons[0].episodes
    await progress(e1.id, { position: 0, state: 'start' })
    const stopped = await progress(e1.id, { position: 100, state: 'stop' })
    assert.deepEqual(
      stopped.json,
      { progress: { position: 100, duration: 310.021, watched: false }, watched: false },
      'stop@100 of E01'
    )
    let d = (await getJson('/series/' + sid)).json
    assert.equal(d.nextUp.label, 'S01E01', 'the unfinished episode')
    assert.equal(d.seasons[0].episodes[0].progress.position, 100)
    let idx = (await getJson('/')).json
    const c1 = idx.continueWatching.find((x) => x.key === 's:' + sid)
    assert.deepEqual(
      [c1.type, c1.label, c1.position, c1.next, c1.seriesTitle, c1.title],
      ['episode', 'S01E01', 100, false, 'Test Show', 'Pilot']
    )
    assert.ok(idx.series.find((s) => s.id === sid).lastWatchedAt > Date.now() - 60000)
    // finish E01 -> the next episode is offered as "next"
    await progress(e1.id, { position: 0, state: 'start' })
    await progress(e1.id, { position: 305, state: 'stop' })
    d = (await getJson('/series/' + sid)).json
    assert.equal(d.nextUp.label, 'S01E02')
    idx = (await getJson('/')).json
    const c2 = idx.continueWatching.filter((x) => x.key === 's:' + sid)
    assert.equal(c2.length, 1, 'one entry per series')
    assert.deepEqual(
      [c2[0].videoId, c2[0].label, c2[0].next, c2[0].position],
      [e2.id, 'S01E02', true, 0]
    )
    await postJson('/watched', { ids: [sid], watched: false })
  })
  await check('favorite: toggle on a movie and a series', async () => {
    const id = tm()
    assert.deepEqual((await postJson('/favorite', { id, favorite: true })).json, {
      id,
      favorite: true
    })
    assert.equal((await getJson('/')).json.movies.find((x) => x.id === id).favorite, true)
    assert.equal((await getJson('/video/' + id)).json.favorite, true)
    assert.deepEqual((await postJson('/favorite', { id, favorite: false })).json, {
      id,
      favorite: false
    })
    const sid = seriesId()
    assert.equal((await postJson('/favorite', { id: sid, favorite: true })).json.favorite, true)
    assert.equal((await getJson('/series/' + sid)).json.favorite, true)
    assert.equal((await getJson('/')).json.series.find((x) => x.id === sid).favorite, true)
    await postJson('/favorite', { id: sid, favorite: false })
    assert.equal((await postJson('/favorite', { id: 'bad', favorite: true })).status, 400)
    assert.equal((await postJson('/favorite', { id, favorite: 1 })).status, 400)
  })

  /* ---------------- session / reconnect ---------------- */
  log('\n== session')
  await check('an expired token answers AUTH_EXPIRED and keeps the stored server', async () => {
    // log the token out on the server side behind the backend's back
    const file = stored()
    assert.ok(file.server.url)
    const current = library.store.current()
    const res = await fetch(`${server.baseUrl}/Sessions/Logout`, {
      method: 'POST',
      headers: {
        Authorization: `MediaBrowser Client="Kaizen", Device="Kaizen Desktop", DeviceId="${current.deviceId}", Version="x", Token="${current.token}"`
      }
    })
    assert.equal(res.status, 204)
    library.service.invalidate()
    const r = await getJson('/?refresh=1')
    assert.equal(r.status, 409)
    assert.equal(r.json.error, 'AUTH_EXPIRED')
    assert.equal((await ipc.invoke('library:status')).connected, true)
    assert.equal(JSON.stringify(r.json).includes(current.token), false)
  })
  await check('reconnecting with the same server restores access (same device id)', async () => {
    const before = stored().deviceId
    const r = await ipc.invoke('library:connect', {
      url: server.baseUrl,
      username: server.user,
      password: server.password
    })
    assert.equal(r.ok, true)
    assert.equal(stored().deviceId, before)
    assert.equal((await getJson('/')).status, 200)
  })
  await check('disconnect: logs out, forgets the server, routes answer NOT_CONNECTED', async () => {
    const r = await ipc.invoke('library:disconnect')
    assert.deepEqual(r, { ok: true })
    assert.deepEqual(await ipc.invoke('library:status'), { connected: false, server: null })
    assert.equal((await getJson('/')).json.error, 'NOT_CONNECTED')
    assert.equal(stored().server, null)
    assert.ok(stored().deviceId)
  })
}

let failed = false
try {
  await main()
} catch (error) {
  failed = true
  log('\nE2E ABORTED:', error?.stack || error)
} finally {
  for (const fn of cleanup.reverse()) {
    try {
      await fn()
    } catch (error) {
      log('cleanup problem:', error?.message)
    }
  }
}

const passed = results.filter((r) => r.ok).length
const failures = results.filter((r) => !r.ok)
log(`\nE2E SUMMARY: ${passed} passed, ${failures.length} failed, ${results.length} total`)
for (const f of failures) log(`  FAIL ${f.name}\n       ${f.error}`)
process.exit(failed || failures.length ? 1 : 0)
