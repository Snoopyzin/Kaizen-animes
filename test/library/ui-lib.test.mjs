// Pure parts of the library UI: helpers (lib.js), the progress reporter (progress.js) and the HTTP
// client (api.js, with a fake fetch). No DOM, no React, no network.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as lib from '../../src/renderer/src/library/lib.js'
import { createProgressReporter } from '../../src/renderer/src/library/progress.js'

const ID = 'a'.repeat(32)
const ID2 = 'b'.repeat(32)

/* ------------------------------ ids, text ------------------------------ */

test('normalizeId accepts 32 hex (any case, dashed) and rejects everything else', () => {
  assert.equal(lib.normalizeId('A'.repeat(32)), ID)
  assert.equal(lib.normalizeId('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), ID)
  assert.equal(lib.normalizeId(`  ${ID}  `), ID)
  for (const bad of ['', null, undefined, 'abc', 'g'.repeat(32), `${ID}0`, '../etc/passwd', `${ID}/x`, 42]) {
    assert.equal(lib.normalizeId(bad), '', String(bad))
  }
  assert.equal(lib.isValidId(ID), true)
  assert.equal(lib.isValidId('nope'), false)
})

test('normalizeText ignores case, accents and extra spaces', () => {
  assert.equal(lib.normalizeText('  Ação   RÁPIDA '), 'acao rapida')
  assert.equal(lib.normalizeText(null), '')
  assert.equal(lib.normalizeText('Amélie'), 'amelie')
})

/* ------------------------------ filter / sort ------------------------------ */

const movie = (over) => ({ key: `m:${over.id}`, year: null, rating: null, addedAt: 0, favorite: false, ...over })
const show = (over) => ({ key: `s:${over.id}`, year: null, rating: null, addedAt: 0, favorite: false, seasons: 1, episodes: 10, watched: 0, ...over })

const CATALOG = [
  movie({ id: 'm1', title: 'Amélie', year: 2001, rating: 8.3, addedAt: 300 }),
  movie({ id: 'm2', title: 'A Ilha', year: 2010, rating: null, addedAt: 100, favorite: true }),
  movie({ id: 'm3', title: 'Zodíaco', year: null, rating: 7.7, addedAt: 0 }),
  show({ id: 's1', title: 'Breaking Bad', year: 2008, rating: 9.5, addedAt: 200, favorite: true }),
  show({ id: 's2', title: 'Ação 10', year: 2020, rating: 6, addedAt: 400 }),
  show({ id: 's3', title: 'Ação 2', year: 2019, rating: 6, addedAt: 50 })
]

test('kindOf uses the key, then falls back to the shape', () => {
  assert.equal(lib.kindOf({ key: 'm:1' }), 'movie')
  assert.equal(lib.kindOf({ key: 's:1' }), 'series')
  assert.equal(lib.kindOf({ seasons: 2 }), 'series')
  assert.equal(lib.kindOf({}), 'movie')
  assert.equal(lib.kindOf(null), 'movie')
})

test('filterItems: chips, favorites and accent-insensitive multi-word search', () => {
  const ids = (list) => list.map((item) => item.id)
  assert.deepEqual(ids(lib.filterItems(CATALOG, { filter: 'movies' })), ['m1', 'm2', 'm3'])
  assert.deepEqual(ids(lib.filterItems(CATALOG, { filter: 'series' })), ['s1', 's2', 's3'])
  assert.deepEqual(ids(lib.filterItems(CATALOG, { filter: 'favorites' })), ['m2', 's1'])
  assert.deepEqual(ids(lib.filterItems(CATALOG, { query: 'amelie' })), ['m1'])
  assert.deepEqual(ids(lib.filterItems(CATALOG, { query: 'ACAO' })), ['s2', 's3'])
  assert.deepEqual(ids(lib.filterItems(CATALOG, { query: 'acao 2' })), ['s2', 's3'], 'all words must match (2 is in "2020" and "2")')
  assert.deepEqual(ids(lib.filterItems(CATALOG, { query: '2008' })), ['s1'], 'the year is searchable')
  assert.deepEqual(ids(lib.filterItems(CATALOG, { query: 'zzz' })), [])
  assert.deepEqual(ids(lib.filterItems(CATALOG, { filter: 'favorites', query: 'ilha' })), ['m2'])
  assert.deepEqual(lib.filterItems(null), [])
  assert.deepEqual(lib.filterItems([null, undefined, CATALOG[0]]).length, 1)
})

test('sortItems: added desc, title A-Z (natural), year desc, rating desc, missing values last', () => {
  const ids = (sort) => lib.sortItems(CATALOG, sort).map((item) => item.id)
  assert.deepEqual(ids('added'), ['s2', 'm1', 's1', 'm2', 's3', 'm3'])
  assert.deepEqual(ids('title'), ['m2', 's3', 's2', 'm1', 's1', 'm3'])
  assert.deepEqual(ids('year'), ['s2', 's3', 'm2', 's1', 'm1', 'm3'])
  assert.deepEqual(ids('rating'), ['s1', 'm1', 'm3', 's3', 's2', 'm2'], 'a tie falls back to the title')
  const before = CATALOG.map((item) => item.id)
  lib.sortItems(CATALOG, 'title')
  assert.deepEqual(CATALOG.map((item) => item.id), before, 'the input is not mutated')
  assert.deepEqual(lib.sortItems(null, 'title'), [])
})

test('title sort is alphabetical without accents and numbers are natural', () => {
  const titles = lib.sortItems(CATALOG, 'title').map((item) => item.title)
  assert.deepEqual(titles, ['A Ilha', 'Ação 2', 'Ação 10', 'Amélie', 'Breaking Bad', 'Zodíaco'])
})

test('countByFilter and catalogOf', () => {
  assert.deepEqual(lib.countByFilter(CATALOG), { all: 6, movies: 3, series: 3, favorites: 2 })
  assert.deepEqual(lib.countByFilter(undefined), { all: 0, movies: 0, series: 0, favorites: 0 })
  assert.equal(lib.catalogOf({ movies: [1], series: [2, 3] }).length, 3)
  assert.deepEqual(lib.catalogOf({}), [])
  assert.deepEqual(lib.catalogOf(null), [])
  assert.deepEqual(lib.catalogOf({ movies: 'x', series: null }), [])
})

test('filterContinue follows the movie / series chips and ignores junk', () => {
  const list = [{ type: 'movie' }, { type: 'episode' }, null, { type: 'episode' }]
  assert.equal(lib.filterContinue(list, 'all').length, 3)
  assert.equal(lib.filterContinue(list, 'movies').length, 1)
  assert.equal(lib.filterContinue(list, 'series').length, 2)
  assert.deepEqual(lib.filterContinue(undefined), [])
  assert.ok(lib.isFilter('favorites') && !lib.isFilter('x') && lib.isSort('year') && !lib.isSort('x'))
})

/* ------------------------------ patches ------------------------------ */

test('favorite patches touch only the item', () => {
  const index = { movies: [{ id: ID, favorite: false }, { id: ID2, favorite: false }], series: [{ id: 'z', favorite: true }], x: 1 }
  const next = lib.patchIndexFavorite(index, ID, true)
  assert.equal(next.movies[0].favorite, true)
  assert.equal(next.movies[1].favorite, false)
  assert.equal(index.movies[0].favorite, false, 'immutable')
  assert.equal(next.x, 1)
  assert.equal(lib.patchIndexFavorite(undefined, ID, true), undefined)
  assert.deepEqual(lib.patchSeriesFavorite({ a: 1 }, true), { a: 1, favorite: true })
  assert.equal(lib.patchVideoFavorite(undefined, true), undefined)
})

const SERIES = () => ({
  id: ID,
  counts: { seasons: 2, episodes: 3, watched: 1 },
  seasons: [
    {
      id: 'sea1',
      season: 1,
      episodes: [
        { id: 'e1', duration: 100, progress: { position: 0, duration: 100, watched: true } },
        { id: 'e2', duration: 100, progress: { position: 30, duration: 100, watched: false } }
      ]
    },
    { id: 'sea0', season: 0, episodes: [{ id: 'e3', duration: 50, progress: null }] }
  ]
})

test('patchSeriesWatched handles an episode, a season and the whole series', () => {
  const one = lib.patchSeriesWatched(SERIES(), ['e2'], true)
  assert.equal(one.seasons[0].episodes[1].progress.watched, true)
  assert.equal(one.counts.watched, 2)

  const undone = lib.patchSeriesWatched(SERIES(), ['e1'], false)
  assert.equal(undone.seasons[0].episodes[0].progress, null)
  assert.equal(undone.counts.watched, 0)

  const season = lib.patchSeriesWatched(SERIES(), ['sea1'], true)
  assert.equal(season.counts.watched, 2)
  assert.equal(season.seasons[1].episodes[0].progress, null, 'other seasons are untouched')

  const all = lib.patchSeriesWatched(SERIES(), [ID], true)
  assert.equal(all.counts.watched, 3)
  assert.equal(all.counts.episodes, 3)
  assert.equal(all.seasons[1].episodes[0].progress.duration, 50)

  const original = SERIES()
  lib.patchSeriesWatched(original, [ID], true)
  assert.equal(original.counts.watched, 1, 'immutable')
  assert.equal(lib.patchSeriesWatched(undefined, [ID], true), undefined)
  assert.deepEqual(lib.patchSeriesWatched({ id: 'x' }, [ID], true), { id: 'x' })

  assert.deepEqual(lib.patchVideoWatched({ duration: 9, progress: null }, true).progress, { position: 0, duration: 9, watched: true })
  assert.equal(lib.patchVideoWatched({ progress: { watched: true } }, false).progress, null)
})

/* ------------------------------ progress numbers ------------------------------ */

test('progressPercent, resumePosition, remainingSeconds, seriesProgress', () => {
  assert.equal(lib.progressPercent(null), 0)
  assert.equal(lib.progressPercent({ position: 50, duration: 200, watched: false }), 25)
  assert.equal(lib.progressPercent({ position: 500, duration: 200, watched: false }), 100)
  assert.equal(lib.progressPercent({ position: 1, duration: 0, watched: false }), 0)
  assert.equal(lib.progressPercent({ position: 10, duration: 100, watched: true }), 100)
  assert.equal(lib.progressPercent({ position: 'x', duration: 100 }), 0)

  assert.equal(lib.resumePosition(null), 0)
  assert.equal(lib.resumePosition({ position: 5, watched: false }), 0, '5 s or less is not worth resuming')
  assert.equal(lib.resumePosition({ position: 5.5, watched: false }), 5.5)
  assert.equal(lib.resumePosition({ position: 600, watched: true }), 0)
  assert.equal(lib.isWatched({ watched: true }), true)
  assert.equal(lib.isWatched(null), false)

  assert.equal(lib.remainingSeconds({ position: 40, duration: 100 }), 60)
  assert.equal(lib.remainingSeconds({ position: 140, duration: 100 }), 0)
  assert.equal(lib.remainingSeconds({}), 0)

  assert.deepEqual(lib.seriesProgress({ episodes: 18, watched: 5 }), { episodes: 18, watched: 5, percent: 27.8, complete: false })
  assert.equal(lib.seriesProgress({ episodes: 4, watched: 4 }).complete, true)
  assert.equal(lib.seriesProgress({ episodes: 4, watched: 9 }).watched, 4)
  assert.equal(lib.seriesProgress({}).complete, false)
})

/* ------------------------------ formatting ------------------------------ */

test('formatDuration', () => {
  assert.equal(lib.formatDuration(6720), '1h 52min')
  assert.equal(lib.formatDuration(2700), '45min')
  assert.equal(lib.formatDuration(7200), '2h')
  assert.equal(lib.formatDuration(10), '<1min')
  assert.equal(lib.formatDuration(0), '')
  assert.equal(lib.formatDuration(null), '')
  assert.equal(lib.formatDuration('abc'), '')
  assert.equal(lib.formatDuration(3570), '1h')
})

test('formatClock', () => {
  assert.equal(lib.formatClock(754), '12:34')
  assert.equal(lib.formatClock(65), '1:05')
  assert.equal(lib.formatClock(3725), '1:02:05')
  assert.equal(lib.formatClock(0), '0:00')
  assert.equal(lib.formatClock(-4), '0:00')
  assert.equal(lib.formatClock(undefined), '0:00')
  assert.equal(lib.formatClock(59.9), '0:59')
})

test('formatSize and formatRating follow the locale', () => {
  assert.equal(lib.formatSize(1.5 * 1024 ** 3, 'pt-BR'), '1,5 GB')
  assert.equal(lib.formatSize(1.5 * 1024 ** 3, 'en-US'), '1.5 GB')
  assert.equal(lib.formatSize(734003200, 'pt-BR'), '700 MB')
  assert.equal(lib.formatSize(500, 'pt-BR'), '500 B')
  assert.equal(lib.formatSize(0), '')
  assert.equal(lib.formatSize(null), '')
  assert.equal(lib.formatRating(7.84, 'pt-BR'), '7,8')
  assert.equal(lib.formatRating(7.84, 'en-US'), '7.8')
  assert.equal(lib.formatRating(10, 'en-US'), '10.0')
  assert.equal(lib.formatRating(0), '')
  assert.equal(lib.formatRating(null), '')
})

test('formatDate reads midnight-UTC strings as that very day', () => {
  assert.match(lib.formatDate('2019-04-14T00:00:00.0000000Z', 'en-US'), /Apr 14, 2019/)
  assert.match(lib.formatDate('2019-04-14', 'en-US'), /Apr 14, 2019/)
  assert.equal(lib.formatDate(null), '')
  assert.equal(lib.formatDate(''), '')
  assert.equal(lib.formatDate('not a date'), '')
  assert.ok(lib.formatDate(1555200000000, 'pt-BR').includes('2019'))
  assert.equal(lib.formatClockTime(0), '')
  assert.match(lib.formatClockTime(Date.UTC(2024, 0, 1, 12, 5), 'en-US'), /\d{1,2}:\d{2}/)
})

test('episode labels', () => {
  assert.equal(lib.formatEpisodeLabel(1, 2), 'S01E02')
  assert.equal(lib.formatEpisodeLabel(1, 2, 3), 'S01E02-E03')
  assert.equal(lib.formatEpisodeLabel(1, 2, 2), 'S01E02')
  assert.equal(lib.formatEpisodeLabel(0, 1), 'S00E01')
  assert.equal(lib.formatEpisodeLabel(12, 103), 'S12E103')
  assert.equal(lib.formatEpisodeLabel(null, 1), '')
  assert.equal(lib.formatEpisodeLabel(1, null), '')
  assert.equal(lib.episodeLabel({ label: 'S02E05', season: 1, episode: 1 }), 'S02E05')
  assert.equal(lib.episodeLabel({ season: 1, episode: 4, episodeEnd: 5 }), 'S01E04-E05')
  assert.equal(lib.episodeLabel(null), '')
})

test('resolution, codec and language names', () => {
  assert.equal(lib.formatResolution(1920, 1080), '1080p')
  assert.equal(lib.formatResolution(1920, 800), '1080p', 'scope movies are not downgraded')
  assert.equal(lib.formatResolution(3840, 2160), '4K')
  assert.equal(lib.formatResolution(1280, 720), '720p')
  assert.equal(lib.formatResolution(720, 480), '480p')
  assert.equal(lib.formatResolution(0, 0), '')
  assert.equal(lib.formatVideoCodec('h264', 'High'), 'H.264 High')
  assert.equal(lib.formatVideoCodec('hevc'), 'HEVC (H.265)')
  assert.equal(lib.formatVideoCodec('weird'), 'WEIRD')
  assert.equal(lib.formatVideoCodec(''), '')
  assert.equal(lib.languageName('jpn', 'en'), 'Japanese')
  assert.equal(lib.languageName('por', 'pt-BR'), 'Português')
  assert.equal(lib.languageName('ger', 'en'), 'German', 'ISO 639-2/B codes of mkv files')
  assert.equal(lib.languageName('und'), '')
  assert.equal(lib.languageName(''), '')
  assert.deepEqual(lib.trackLanguages([{ lang: 'jpn' }, { lang: 'eng' }, { lang: 'jpn' }, { lang: 'und' }, null], 'en'), ['Japanese', 'English'])
  assert.deepEqual(lib.trackLanguages(undefined), [])
})

/* ------------------------------ seasons ------------------------------ */

test('season names and the first season to show', () => {
  assert.equal(lib.isGenericSeasonName('Season 1', 1), true)
  assert.equal(lib.isGenericSeasonName('Temporada 03', 3), true)
  assert.equal(lib.isGenericSeasonName('Specials', 0), true)
  assert.equal(lib.isGenericSeasonName('Especiais', 0), true)
  assert.equal(lib.isGenericSeasonName('', 2), true)
  assert.equal(lib.isGenericSeasonName('Dark Phoenix Saga', 2), false)
  assert.equal(lib.isGenericSeasonName('Season 2', 1), false)

  const series = SERIES()
  assert.equal(lib.pickInitialSeasonId(series), 'sea1', 'first real season')
  assert.equal(lib.pickInitialSeasonId({ ...series, nextUp: { id: 'e3' } }), 'sea0', 'the season of the next episode')
  assert.equal(lib.pickInitialSeasonId({ seasons: [{ id: 'only', season: 0, episodes: [] }] }), 'only')
  assert.equal(lib.pickInitialSeasonId({}), '')
  assert.equal(lib.pickInitialSeasonId(null), '')
})

test('seriesAction: start, continue, watch again, nothing', () => {
  const s = SERIES()
  assert.equal(lib.seriesAction({ ...s, counts: { watched: 0 }, nextUp: { id: 'e1', progress: null } }).kind, 'start')
  assert.equal(lib.seriesAction({ ...s, counts: { watched: 2 }, nextUp: { id: 'e2', progress: null } }).kind, 'continue')
  assert.equal(
    lib.seriesAction({ ...s, counts: { watched: 0 }, nextUp: { id: 'e1', progress: { position: 90, duration: 1000, watched: false } } }).kind,
    'continue'
  )
  const again = lib.seriesAction({ ...s, nextUp: null })
  assert.equal(again.kind, 'again')
  assert.equal(again.episode.id, 'e1')
  assert.equal(lib.seriesAction({ seasons: [] }).kind, 'none')
  assert.equal(lib.seriesAction(null).episode, null)
})

/* ------------------------------ urls ------------------------------ */

test('urls carry the token and never take anything but a valid id', () => {
  assert.equal(lib.buildUrl(64621, '/status', { token: 'tok' }), 'http://localhost:64621/library/status?t=tok')
  assert.equal(lib.buildUrl(64621, '/', { token: 'tok', params: { refresh: 1 } }), 'http://localhost:64621/library?refresh=1&t=tok')
  assert.equal(lib.buildUrl(64621, '', {}), 'http://localhost:64621/library')
  assert.equal(lib.buildUrl('nonsense', '/x', { token: 'a b' }), 'http://localhost:64621/library/x?t=a+b', 'bad port -> default, token is encoded')
  assert.equal(lib.buildUrl(1234, 'x', { token: 't', host: '127.0.0.1' }), 'http://127.0.0.1:1234/library/x?t=t')

  assert.equal(lib.imageUrl(1, 'T', ID, { type: 'thumb', width: 360 }), `http://localhost:1/library/image/${ID}?type=thumb&w=360&t=T`)
  assert.match(lib.imageUrl(1, 'T', ID, { width: 99999 }), /w=1920/)
  assert.match(lib.imageUrl(1, 'T', ID, { width: 1 }), /w=16/)
  assert.equal(lib.imageUrl(1, 'T', 'bad'), '')
  assert.equal(lib.imageUrl(1, 'T', null), '')

  assert.equal(lib.streamUrl(5, 'T', ID), `http://localhost:5/library/stream/${ID}?t=T`)
  assert.equal(lib.streamUrl(5, 'T', ID, '127.0.0.1'), `http://127.0.0.1:5/library/stream/${ID}?t=T`)
  assert.equal(lib.streamUrl(5, 'T', '../x'), '')
  assert.equal(lib.trackUrl(5, 'T', ID, 'subtitles'), `http://localhost:5/library/subtitles/${ID}?t=T`)
  assert.equal(lib.trackUrl(5, 'T', ID, 'delete'), '')
  assert.equal(lib.trackUrl(5, '', ID, 'audio'), `http://localhost:5/library/audio/${ID}`, 'no token outside Electron')
})

test('mimeForContainer', () => {
  assert.equal(lib.mimeForContainer('mov,mp4,m4a,3gp,3g2,mj2'), 'video/mp4')
  assert.equal(lib.mimeForContainer('mp4'), 'video/mp4')
  assert.equal(lib.mimeForContainer('matroska,webm'), 'video/webm')
  assert.equal(lib.mimeForContainer('mkv'), 'video/webm')
  assert.equal(lib.mimeForContainer('ogg'), 'video/ogg')
  assert.equal(lib.mimeForContainer(undefined), 'video/webm')
})

/* ------------------------------ text ------------------------------ */

test('plainText strips markup and paragraphs splits it', () => {
  assert.equal(lib.plainText('A<br>B <i>c</i> &amp; d'), 'A\nB c & d')
  assert.equal(lib.plainText('<script>alert(1)</script>ok'), 'alert(1)ok')
  assert.equal(lib.plainText(null), '')
  assert.deepEqual(lib.paragraphs('One.\n\n\nTwo.<br/>Three.'), ['One.', 'Two.', 'Three.'])
  assert.deepEqual(lib.paragraphs(''), [])
})

test('looksPortuguese only skips translation of clearly Portuguese text', () => {
  assert.equal(
    lib.looksPortuguese('Um jovem descobre que o mundo não é como ele pensava e precisa lutar para salvar a família.'),
    true
  )
  assert.equal(
    lib.looksPortuguese('A young man discovers that the world is not what he thought and must fight to save his family.'),
    false
  )
  assert.equal(lib.looksPortuguese(''), false)
  assert.equal(lib.looksPortuguese('Dune'), false, 'when in doubt it is translated')
})

/* ------------------------------ misc ------------------------------ */

test('small predicates', () => {
  assert.equal(lib.isTypingTarget({ tagName: 'input' }), true)
  assert.equal(lib.isTypingTarget({ tagName: 'TEXTAREA' }), true)
  assert.equal(lib.isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(lib.isTypingTarget({ tagName: 'BUTTON' }), false)
  assert.equal(lib.isTypingTarget(null), false)

  assert.equal(lib.usesPlainHttp('http://192.168.0.10:8096'), true)
  assert.equal(lib.usesPlainHttp('HTTP://x'), true)
  assert.equal(lib.usesPlainHttp('192.168.0.10:8096'), true, 'no scheme means http')
  assert.equal(lib.usesPlainHttp('https://media.example.com'), false)
  assert.equal(lib.usesPlainHttp('ftp://x'), false)
  assert.equal(lib.usesPlainHttp('   '), false)

  assert.equal(lib.errorKind('AUTH_EXPIRED'), 'auth')
  assert.equal(lib.errorKind('NOT_CONNECTED'), 'not-connected')
  assert.equal(lib.errorKind('SERVER_UNREACHABLE'), 'unreachable')
  assert.equal(lib.errorKind('NOT_FOUND'), 'not-found')
  assert.equal(lib.errorKind('UNAUTHORIZED'), 'local')
  assert.equal(lib.errorKind('BACKEND_DOWN'), 'local')
  assert.equal(lib.errorKind('INTERNAL'), 'generic')
  assert.equal(lib.errorKind(undefined), 'generic')
  assert.equal(lib.isFatalCode('AUTH_EXPIRED'), true)
  assert.equal(lib.isFatalCode('UPSTREAM_ERROR'), false)

  assert.equal(lib.normalizeReason('container'), 'container')
  assert.equal(lib.normalizeReason('???'), 'unknown')
  assert.equal(lib.normalizeReason(null), 'unknown')
  assert.equal(lib.reasonForMediaError(1), null, 'an aborted load is not a failure')
  assert.equal(lib.reasonForMediaError(2), 'network-error')
  assert.equal(lib.reasonForMediaError(3), 'playback-error')
  assert.equal(lib.reasonForMediaError(4), 'playback-error')
  assert.equal(lib.reasonForMediaError(0), null)
  assert.equal(lib.NEXT_EPISODE_SECONDS, 10)
})

/* ------------------------------ progress reporter ------------------------------ */

function reporterHarness(options = {}) {
  const calls = []
  let clock = 1_000_000
  const reporter = createProgressReporter({
    send: async (body, opts) => {
      calls.push({ ...body, keepalive: opts.keepalive })
      if (options.fail) throw new Error('boom')
    },
    now: () => clock,
    onError: options.onError,
    onStopped: options.onStopped
  })
  return { reporter, calls, tick: (ms) => (clock += ms) }
}

test('reporter: start once, progress every 10 s while playing, pause, resume, stop once', async () => {
  const { reporter, calls, tick } = reporterHarness()
  await reporter.update(1, 100) // not playing yet: nothing
  assert.equal(calls.length, 0)

  await reporter.playing(12.34, 100)
  await reporter.playing(12.5, 100) // a second 'playing' (after buffering) is not a new session
  assert.deepEqual(calls.map((c) => c.state), ['start'])
  assert.equal(calls[0].position, 12.3)
  assert.equal(calls[0].duration, 100)

  tick(4000)
  await reporter.update(16, 100)
  assert.equal(calls.length, 1, 'too soon')
  tick(6500)
  await reporter.update(22, 100)
  assert.deepEqual(calls.map((c) => c.state), ['start', 'progress'])
  assert.equal(calls[1].position, 22)

  await reporter.pause(25, 100)
  await reporter.pause(25, 100)
  assert.deepEqual(calls.map((c) => c.state), ['start', 'progress', 'pause'], 'one pause only')
  tick(60_000)
  await reporter.update(25, 100)
  assert.equal(calls.length, 3, 'nothing while paused')

  await reporter.playing(25, 100)
  assert.equal(calls.at(-1).state, 'progress', 'resuming says so right away')

  await reporter.stop(40, 100)
  await reporter.stop(41, 100)
  assert.deepEqual(calls.map((c) => c.state), ['start', 'progress', 'pause', 'progress', 'stop'])
  assert.equal(calls.at(-1).position, 40)
  tick(60_000)
  await reporter.update(50, 100)
  assert.equal(calls.length, 5, 'nothing after stop')
  assert.ok(calls.every((c) => c.keepalive === false))
})

test('reporter: never reports a video that did not play; a replay after the end starts a new session', async () => {
  const { reporter, calls } = reporterHarness()
  await reporter.stop(0, 100)
  await reporter.checkpoint(5, 100)
  await reporter.pause(5, 100)
  assert.equal(calls.length, 0)

  await reporter.playing(0, 100)
  await reporter.stop(100, 100)
  await reporter.playing(2, 100)
  assert.deepEqual(calls.map((c) => c.state), ['start', 'stop', 'start'])
})

test('reporter: keepalive checkpoint / stop skip the queue; stop uses the last known position', async () => {
  const { reporter, calls } = reporterHarness()
  await reporter.playing(10, 200)
  reporter.update(33, 200)
  await reporter.checkpoint(undefined, undefined, { keepalive: true })
  assert.equal(calls.at(-1).state, 'progress')
  assert.equal(calls.at(-1).position, 33)
  assert.equal(calls.at(-1).keepalive, true)
  await reporter.stop(undefined, undefined, { keepalive: true })
  assert.equal(calls.at(-1).state, 'stop')
  assert.equal(calls.at(-1).position, 33, 'a destroyed <video> reports NaN: the last known position is used')
  assert.equal(calls.at(-1).keepalive, true)

  const second = reporterHarness()
  await second.reporter.playing(5, 50)
  await second.reporter.pause(6, 50)
  await second.reporter.checkpoint(6, 50, { keepalive: true })
  assert.equal(second.calls.at(-1).state, 'pause', 'a paused video is checkpointed as paused')
})

test('reporter: requests go out in order and failures never throw', async () => {
  const order = []
  const slow = createProgressReporter({
    send: async (body) => {
      await new Promise((resolve) => setTimeout(resolve, body.state === 'start' ? 30 : 1))
      order.push(body.state)
    }
  })
  slow.playing(1, 10)
  slow.pause(2, 10)
  await slow.stop(3, 10)
  assert.deepEqual(order, ['start', 'pause', 'stop'])

  const errors = []
  let stopped = 0
  const { reporter } = reporterHarness({ fail: true, onError: (e, state) => errors.push(state), onStopped: () => stopped++ })
  await reporter.playing(1, 10)
  await reporter.stop(2, 10)
  assert.deepEqual(errors, ['start', 'stop'])
  assert.equal(stopped, 1, 'onStopped fires even when the request failed')
})

test('reporter: bad numbers are ignored and duration is optional', async () => {
  const { reporter, calls } = reporterHarness()
  await reporter.playing(Number.NaN, 0)
  assert.equal(calls[0].position, 0)
  assert.equal('duration' in calls[0], false)
  await reporter.stop(-5, Number.POSITIVE_INFINITY)
  assert.equal(calls.at(-1).position, 0)
})

/* ------------------------------ api client (fake fetch) ------------------------------ */

const { LibraryError, connectServer, disconnectServer, fetchIndex, fetchSeries, fetchStatus, getToken, libraryUrls, sendProgress, sendWatched, sendFavorite } =
  await import('../../src/renderer/src/library/api.js')

function fakeFetch(handler) {
  const seen = []
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), init })
    const out = await handler(String(url), init)
    return {
      ok: out.status >= 200 && out.status < 300,
      status: out.status,
      text: async () => (out.body === undefined ? '' : typeof out.body === 'string' ? out.body : JSON.stringify(out.body))
    }
  }
  return seen
}

function withWindow(library) {
  globalThis.window = { api: { library } }
}

test.afterEach(() => {
  delete globalThis.window
  delete globalThis.fetch
})

test('api: token and base url, JSON bodies, keepalive', async () => {
  withWindow({ token: 'secret' })
  const seen = fakeFetch(() => ({ status: 200, body: { ok: 1 } }))
  assert.equal(getToken(), 'secret')

  await fetchIndex(64000)
  await fetchIndex(64000, { refresh: true })
  await fetchSeries(64000, ID.toUpperCase())
  await sendProgress(64000, ID, { position: 4, state: 'stop' }, { keepalive: true })
  await sendWatched(64000, [ID, ID2], true)
  await sendFavorite(64000, ID, false)

  assert.equal(seen[0].url, 'http://localhost:64000/library?t=secret')
  assert.equal(seen[1].url, 'http://localhost:64000/library?refresh=1&t=secret')
  assert.equal(seen[2].url, `http://localhost:64000/library/series/${ID}?t=secret`)
  assert.equal(seen[3].url, `http://localhost:64000/library/progress/${ID}?t=secret`)
  assert.equal(seen[3].init.method, 'POST')
  assert.equal(seen[3].init.keepalive, true)
  assert.equal(seen[3].init.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(seen[3].init.body), { position: 4, state: 'stop' })
  assert.deepEqual(JSON.parse(seen[4].init.body), { ids: [ID, ID2], watched: true })
  assert.deepEqual(JSON.parse(seen[5].init.body), { id: ID, favorite: false })
  assert.equal(seen[0].init.keepalive, false)

  const urls = libraryUrls(64000)
  assert.equal(urls.image(ID, 'thumb', 300), `http://localhost:64000/library/image/${ID}?type=thumb&w=300&t=secret`)
  assert.equal(urls.externalStream(ID), `http://127.0.0.1:64000/library/stream/${ID}?t=secret`)
  assert.equal(urls.track(ID, 'mediainfo'), `http://localhost:64000/library/mediainfo/${ID}?t=secret`)
})

test('api: bad ids never reach the network', async () => {
  withWindow({ token: 'secret' })
  const seen = fakeFetch(() => ({ status: 200, body: {} }))
  for (const bad of ['../etc', '', 'zz', `${ID}/../x`]) {
    await assert.rejects(fetchSeries(1, bad), (error) => error instanceof LibraryError && error.code === 'BAD_REQUEST')
  }
  await assert.rejects(sendWatched(1, [ID, 'bad'], true), { code: 'BAD_REQUEST' })
  assert.equal(seen.length, 0)
})

test('api: errors carry the code of the JSON body', async () => {
  withWindow({ token: 't' })
  const cases = [
    [{ status: 409, body: { error: 'AUTH_EXPIRED', message: 'x' } }, 'AUTH_EXPIRED'],
    [{ status: 409, body: { error: 'NOT_CONNECTED' } }, 'NOT_CONNECTED'],
    [{ status: 502, body: { error: 'SERVER_UNREACHABLE' } }, 'SERVER_UNREACHABLE'],
    [{ status: 404, body: { error: 'NOT_FOUND' } }, 'NOT_FOUND'],
    [{ status: 401, body: { error: 'UNAUTHORIZED' } }, 'UNAUTHORIZED'],
    [{ status: 401, body: '' }, 'UNAUTHORIZED'],
    [{ status: 404, body: 'plain' }, 'NOT_FOUND'],
    [{ status: 500, body: '<html>' }, 'INTERNAL'],
    [{ status: 200, body: '<html>' }, 'BAD_RESPONSE'],
    [{ status: 200, body: '' }, 'BAD_RESPONSE']
  ]
  for (const [response, code] of cases) {
    fakeFetch(() => response)
    await assert.rejects(fetchIndex(1), (error) => error.code === code && error.name === 'LibraryError', code)
  }
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch')
  }
  await assert.rejects(fetchIndex(1), { code: 'BACKEND_DOWN' })
  globalThis.fetch = async () => {
    throw Object.assign(new Error('aborted'), { name: 'AbortError' })
  }
  await assert.rejects(fetchIndex(1), { name: 'AbortError' })
})

test('api: no token outside Electron', async () => {
  const seen = fakeFetch(() => ({ status: 200, body: {} }))
  assert.equal(getToken(), '')
  await fetchIndex(64000)
  assert.equal(seen[0].url, 'http://localhost:64000/library')
})

test('api: status prefers the IPC bridge and falls back to HTTP', async () => {
  withWindow({ status: async () => ({ connected: true, server: { name: 'Casa', host: 'h:1', userName: 'g', version: '10' } }) })
  assert.deepEqual(await fetchStatus(1), { connected: true, server: { name: 'Casa', host: 'h:1', userName: 'g', version: '10' } })

  withWindow({ status: async () => ({ connected: false, server: null }) })
  assert.deepEqual(await fetchStatus(1), { connected: false, server: null })

  withWindow({ status: async () => ({ connected: true, server: null }) })
  assert.deepEqual(await fetchStatus(1), { connected: false, server: null }, 'connected without a server is not connected')

  withWindow({ token: 't', status: async () => Promise.reject(new Error('ipc')) })
  const seen = fakeFetch(() => ({ status: 200, body: { connected: false, server: null } }))
  assert.deepEqual(await fetchStatus(7), { connected: false, server: null })
  assert.equal(seen[0].url, 'http://localhost:7/library/status?t=t')
})

test('api: connect / disconnect never throw and never echo the password', async () => {
  const sent = []
  withWindow({
    connect: async (args) => {
      sent.push(args)
      if (args.password === 'bad') return { ok: false, error: 'BAD_CREDENTIALS', message: 'x' }
      if (args.password === 'tls') return { ok: false, error: 'TLS_ERROR' }
      if (args.password === 'crash') throw new Error('ipc down')
      if (args.password === 'junk') return 'junk'
      return { ok: true, server: { name: 'Casa' } }
    },
    disconnect: async () => ({ ok: true })
  })
  const base = { url: 'http://x', username: 'u', allowInvalidCert: false }
  assert.deepEqual(await connectServer({ ...base, password: 'good' }), { ok: true, server: { name: 'Casa' } })
  assert.deepEqual(await connectServer({ ...base, password: 'bad' }), { ok: false, error: 'BAD_CREDENTIALS' })
  assert.deepEqual(await connectServer({ ...base, password: 'tls' }), { ok: false, error: 'TLS_ERROR' })
  assert.deepEqual(await connectServer({ ...base, password: 'crash' }), { ok: false, error: 'SERVER_ERROR' })
  assert.deepEqual(await connectServer({ ...base, password: 'junk' }), { ok: false, error: 'SERVER_ERROR' })
  assert.equal(sent[0].allowInvalidCert, false)
  assert.deepEqual(await disconnectServer(), { ok: true })

  delete globalThis.window
  assert.deepEqual(await connectServer({ ...base, password: 'x' }), { ok: false, error: 'UNAVAILABLE' })
  assert.deepEqual(await disconnectServer(), { ok: false, error: 'UNAVAILABLE' })
})
