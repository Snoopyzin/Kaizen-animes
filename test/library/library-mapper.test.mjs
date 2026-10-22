// The pure mapper, fed with samples recorded from a real Jellyfin 12.2 (test/library/golden).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanTitle,
  compareEpisodes,
  containerToFormat,
  episodeLabel,
  mapEpisode,
  mapMediaInfo,
  mapMovie,
  mapNextUpItem,
  mapResumeItem,
  mapSeries,
  mapSeriesDetail,
  mapVideoDetail,
  mergeContinue,
  normalizeId,
  pickNextUp,
  secondsToTicks,
  ticksToSeconds,
  toProgress
} from '../../src/main/library/mapper.js'
import { golden } from './mock-jellyfin.mjs'

const movieRow = (list, name) => list.Items.find((m) => m.Name.startsWith(name))

/* ------------------------------ ids and numbers ------------------------------ */

test('normalizeId: lower-case 32 hex without dashes; dashed GUIDs accepted; everything else null', () => {
  assert.equal(normalizeId('43F9FD2BBF55A40E1BF2DE36CC27F485'), '43f9fd2bbf55a40e1bf2de36cc27f485')
  assert.equal(normalizeId('43f9fd2b-bf55-a40e-1bf2-de36cc27f485'), '43f9fd2bbf55a40e1bf2de36cc27f485')
  assert.equal(normalizeId(' 43f9fd2bbf55a40e1bf2de36cc27f485 '), '43f9fd2bbf55a40e1bf2de36cc27f485')
  for (const bad of ['', 'abc', '../../etc/passwd', 'g'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), '43f9fd2b-bf55-a40e-1bf2-de36cc27f48', null, undefined, 5, {}, ['a'.repeat(32)]]) {
    assert.equal(normalizeId(bad), null, String(bad))
  }
})

test('ticks <-> seconds, labels, titles', () => {
  assert.equal(ticksToSeconds(3100210000), 310.021)
  assert.equal(ticksToSeconds(0), 0)
  assert.equal(ticksToSeconds(undefined), 0)
  assert.equal(ticksToSeconds(-5), 0)
  assert.equal(secondsToTicks(120), 1200000000)
  assert.equal(secondsToTicks(-3), 0)
  assert.equal(episodeLabel(1, 2), 'S01E02')
  assert.equal(episodeLabel(1, 2, 3), 'S01E02-E03')
  assert.equal(episodeLabel(0, 1), 'S00E01')
  assert.equal(episodeLabel(12, 105), 'S12E105')
  assert.equal(episodeLabel(1, 2, 2), 'S01E02', 'an end equal to the start is a single episode')
  assert.equal(episodeLabel(1, null), null)
  assert.equal(episodeLabel(null, 3), null)
  assert.equal(cleanTitle('Second Movie (2018)', 2018), 'Second Movie')
  assert.equal(cleanTitle('Second Movie (2018)', 2019), 'Second Movie (2018)', 'only a year that matches is dropped')
  assert.equal(cleanTitle('Blade Runner 2049 (2017)', 2017), 'Blade Runner 2049')
  assert.equal(cleanTitle('2012', 2009), '2012')
  assert.equal(cleanTitle('Test Movie', 2020), 'Test Movie')
  assert.equal(cleanTitle(undefined, 2020), '')
})

test('toProgress: null when never played, watched items keep position 0', () => {
  assert.equal(toProgress({ PlaybackPositionTicks: 0, Played: false }, 100), null)
  assert.equal(toProgress(undefined, 100), null)
  assert.deepEqual(toProgress({ PlaybackPositionTicks: 1200000000, Played: false }, 3100210000), { position: 120, duration: 310.021, watched: false })
  assert.deepEqual(toProgress({ PlaybackPositionTicks: 0, Played: true }, 3100210000), { position: 0, duration: 310.021, watched: true })
  assert.deepEqual(toProgress({ Played: true }, undefined), { position: 0, duration: 0, watched: true })
})

/* ------------------------------ movies and series rows ------------------------------ */

test('mapMovie: the Test Movie row', () => {
  const m = mapMovie(movieRow(golden('movies-page.json'), 'Test Movie'))
  assert.deepEqual(m, {
    key: 'm:43f9fd2bbf55a40e1bf2de36cc27f485',
    id: '43f9fd2bbf55a40e1bf2de36cc27f485',
    title: 'Test Movie',
    year: 2020,
    duration: 310.021,
    width: 320,
    height: 180,
    addedAt: Date.parse(movieRow(golden('movies-page.json'), 'Test Movie').DateCreated),
    rating: 7.8,
    genres: ['Drama', 'Science Fiction'],
    progress: null,
    favorite: false,
    hasImage: true
  })
})

test('mapMovie: no metadata -> year from the folder name stripped from the title, no image, no rating', () => {
  const m = mapMovie(movieRow(golden('movies-page.json'), 'Second Movie'))
  assert.equal(m.title, 'Second Movie')
  assert.equal(m.year, 2018)
  assert.equal(m.rating, null)
  assert.deepEqual(m.genres, [])
  assert.equal(m.hasImage, false)
  assert.equal(m.duration, 12)
})

test('mapMovie: userdata after some playing (progress, favorite)', () => {
  const list = golden('movies-page-progress.json')
  assert.deepEqual(mapMovie(movieRow(list, 'Test Movie')).progress, { position: 120, duration: 310.021, watched: false })
  assert.equal(mapMovie(movieRow(list, 'Second Movie')).favorite, true)
  assert.equal(mapMovie(movieRow(list, 'Hevc Movie')).progress, null)
})

test('mapMovie survives a nearly empty item', () => {
  const m = mapMovie({ Id: 'ABCDEF0123456789ABCDEF0123456789' })
  assert.deepEqual(m, {
    key: 'm:abcdef0123456789abcdef0123456789',
    id: 'abcdef0123456789abcdef0123456789',
    title: '',
    year: null,
    duration: 0,
    width: 0,
    height: 0,
    addedAt: 0,
    rating: null,
    genres: [],
    progress: null,
    favorite: false,
    hasImage: false
  })
  // year falls back to the premiere date
  assert.equal(mapMovie({ Id: 'a'.repeat(32), PremiereDate: '1999-03-31T00:00:00.0000000Z' }).year, 1999)
})

test('mapSeries: seasons exclude specials, watched = episodes - unplayed', () => {
  const list = golden('series-page.json')
  const test = list.Items.find((s) => s.Name === 'Test Show')
  const short = list.Items.find((s) => s.Name === 'Short Show')
  assert.deepEqual(mapSeries(test, { hasSpecials: true }), {
    key: 's:96911d3a53fc2ef5c090d5c3342da3ba',
    id: '96911d3a53fc2ef5c090d5c3342da3ba',
    title: 'Test Show',
    year: 2015,
    seasons: 2,
    episodes: 5,
    watched: 0,
    addedAt: Date.parse(test.DateCreated),
    lastWatchedAt: null,
    rating: 8.4,
    genres: ['Drama', 'Mystery'],
    favorite: false,
    hasImage: true
  })
  assert.equal(mapSeries(test, { hasSpecials: false }).seasons, 3)
  const s = mapSeries(short, { hasSpecials: false, lastWatchedAt: 1700000000000 })
  assert.deepEqual([s.seasons, s.episodes, s.watched, s.hasImage, s.lastWatchedAt, s.rating], [1, 2, 0, false, 1700000000000, null])
  const progressed = golden('series-page-progress.json').Items.find((x) => x.Name === 'Test Show')
  assert.equal(mapSeries(progressed, { hasSpecials: true }).watched, 1)
})

test('the specials sample marks Test Show as having a Specials season', () => {
  const specials = golden('specials-seasons.json').Items
  assert.equal(specials.length, 1)
  assert.equal(specials[0].IndexNumber, 0)
  assert.equal(specials[0].SeriesId, '96911d3a53fc2ef5c090d5c3342da3ba')
})

/* ------------------------------ series page ------------------------------ */

test('mapSeriesDetail: seasons ascending with the specials last, multi-episode files, counts', () => {
  const d = mapSeriesDetail(golden('item-series-test-show.json'), golden('seasons-test-show.json').Items, golden('episodes-test-show.json').Items)
  assert.equal(d.title, 'Test Show')
  assert.equal(d.status, 'Continuing')
  assert.equal(d.officialRating, 'TV-14')
  assert.equal(d.overview, 'A generated show used to test the Kaizen library backend.')
  assert.deepEqual(d.genres, ['Drama', 'Mystery'])
  assert.deepEqual([d.hasImage, d.hasBackdrop, d.favorite, d.rating, d.year], [true, true, false, 8.4, 2015])
  assert.deepEqual(d.counts, { seasons: 2, episodes: 5, watched: 0 })
  assert.deepEqual(d.seasons.map((s) => [s.season, s.name, s.episodes.length]), [[1, 'Season 1', 3], [2, 'Season 2', 1], [0, 'Specials', 1]])
  const s1 = d.seasons[0].episodes
  assert.deepEqual(s1.map((e) => e.label), ['S01E01', 'S01E02', 'S01E03-E04'])
  assert.deepEqual(Object.keys(s1[0]).sort(), ['airDate', 'duration', 'episode', 'episodeEnd', 'hasImage', 'id', 'label', 'overview', 'progress', 'season', 'title'])
  assert.equal(s1[2].title, 'Double Feature / Double Feature 2')
  assert.deepEqual([s1[2].episode, s1[2].episodeEnd], [3, 4])
  assert.equal(s1[0].airDate, '2015-01-01T00:00:00.000Z')
  assert.equal(s1[0].hasImage, true)
  assert.equal(s1[1].hasImage, false)
  assert.equal(d.seasons[2].episodes[0].label, 'S00E01')
  assert.equal(d.nextUp.label, 'S01E01')
})

test('mapSeriesDetail: with progress the unfinished episode is the next up; watched ones are counted', () => {
  const d = mapSeriesDetail(golden('item-series-test-show.json'), golden('seasons-test-show-progress.json').Items, golden('episodes-test-show-progress.json').Items)
  assert.deepEqual(d.counts, { seasons: 2, episodes: 5, watched: 1 })
  const [pilot, second] = d.seasons[0].episodes
  assert.deepEqual(pilot.progress, { position: 0, duration: 310.021, watched: true })
  assert.deepEqual(second.progress, { position: 100, duration: 310.021, watched: false })
  assert.equal(d.nextUp.label, 'S01E02')
  assert.equal(d.nextUp.id, second.id)
})

test('mapSeriesDetail: a series without specials or numbering still maps', () => {
  const d = mapSeriesDetail(golden('item-series-short-show.json'), golden('seasons-short-show.json').Items, golden('episodes-short-show.json').Items)
  assert.equal(d.title, 'Short Show')
  assert.equal(d.status, null)
  assert.equal(d.officialRating, null)
  assert.equal(d.hasImage, false)
  assert.equal(d.hasBackdrop, false)
  assert.deepEqual(d.seasons.map((s) => s.season), [1])
  assert.deepEqual(d.counts, { seasons: 1, episodes: 2, watched: 0 })
  // an episode without season / episode numbers goes to season 1 with a null label
  const odd = mapSeriesDetail({ Id: 'a'.repeat(32), Name: 'X' }, [], [{ Id: 'b'.repeat(32), Name: 'Loose', SeasonId: 'c'.repeat(32) }])
  assert.deepEqual([odd.seasons[0].season, odd.seasons[0].episodes[0].label, odd.seasons[0].episodes[0].episode], [1, null, null])
})

test('pickNextUp rules', () => {
  const ep = (season, episode, progress = null) => ({ id: `${season}-${episode}`, season, episode, title: '', progress })
  const watched = { position: 0, duration: 1, watched: true }
  const partial = (position) => ({ position, duration: 100, watched: false })
  const all = [ep(0, 1), ep(1, 1), ep(1, 2), ep(2, 1)]
  assert.equal(pickNextUp(all).id, '1-1', 'nothing watched: the first regular episode, not the special')
  assert.equal(pickNextUp([ep(1, 1, watched), ep(1, 2), ep(1, 3)]).id, '1-2')
  assert.equal(pickNextUp([ep(1, 1, watched), ep(1, 2), ep(1, 3, watched)]).id, '1-2', 'a gap is still the first unwatched after... the last watched is E3, so wrap to the first unwatched')
  assert.equal(pickNextUp([ep(1, 1, watched), ep(1, 2, partial(40)), ep(1, 3)]).id, '1-2', 'unfinished wins')
  const dates = new Map([['1-2', 100], ['1-3', 500]])
  assert.equal(pickNextUp([ep(1, 1), ep(1, 2, partial(10)), ep(1, 3, partial(10))], dates).id, '1-3', 'latest play date among unfinished')
  assert.equal(pickNextUp([ep(1, 1, watched), ep(1, 2, watched)]), null, 'everything watched')
  assert.equal(pickNextUp([ep(1, 1, watched), ep(0, 1)]), null, 'only an unwatched special left: not offered')
  assert.equal(pickNextUp([ep(0, 1), ep(0, 2, watched)]).id, '0-1', 'a series with only specials uses them')
  assert.equal(pickNextUp([]), null)
  assert.deepEqual([ep(0, 1), ep(2, 1), ep(1, 2), ep(1, 1)].sort(compareEpisodes).map((e) => e.id), ['1-1', '1-2', '2-1', '0-1'])
})

test('mapEpisode tolerates missing fields', () => {
  const e = mapEpisode({ Id: 'A'.repeat(32) })
  assert.deepEqual(e, { id: 'a'.repeat(32), season: 1, episode: null, episodeEnd: null, label: null, title: '', overview: '', duration: 0, progress: null, hasImage: false, airDate: null })
})

/* ------------------------------ media streams ------------------------------ */

test('mapMediaInfo: side-car subtitle files shift Jellyfin\'s stream indexes; audio is found by position', () => {
  const { info, audioOrdinals, mediaSourceId } = mapMediaInfo(golden('item-test-movie.json'))
  assert.equal(mediaSourceId, '43f9fd2bbf55a40e1bf2de36cc27f485')
  assert.deepEqual(info.video, { id: 1, codec: 'h264', profile: 'Constrained Baseline', width: 320, height: 180, pixFmt: 'yuv420p' })
  assert.deepEqual(info.audio.map((a) => [a.id, a.codec, a.lang, a.title, a.channels, a.default, a.supported]), [
    [2, 'aac', 'jpn', 'Japanese', 2, true, true],
    [3, 'eac3', 'eng', 'English 5.1', 6, false, false],
    [4, 'aac', 'por', 'Brazilian', 2, false, true]
  ])
  assert.deepEqual([...audioOrdinals], [[2, 0], [3, 1], [4, 2]])
  assert.deepEqual(info.subtitles.map((s) => [s.id, s.codec, s.lang, s.title, s.text, s.external, s.default]), [
    [0, 'subrip', 'por', '', true, true, false],
    [5, 'subrip', 'eng', 'English', true, false, true],
    [6, 'subrip', 'eng', 'Signs & Songs', true, false, false],
    [7, 'subrip', 'spa', 'Spanish', true, false, false]
  ])
  assert.equal(info.autoPtSource, null, 'a Portuguese text track exists')
  assert.equal(info.container, 'matroska,webm')
  assert.equal(info.duration, 310.021)
  assert.deepEqual(info.playback, { supported: true, reason: null })
})

test('mapMediaInfo: embedded cover pictures and attachments are not tracks; english-only gets an auto-pt source', () => {
  const cover = mapMediaInfo(golden('item-cover-movie.json')).info
  assert.equal(cover.audio.length, 2)
  assert.equal(cover.subtitles.length, 1)
  assert.equal(cover.video.codec, 'h264', 'the png cover is not the video')
  assert.equal(cover.container, 'mov,mp4,m4a,3gp,3g2,mj2')
  const odd = mapMediaInfo(golden('item-odd-layout.json')).info
  assert.deepEqual(odd.subtitles.map((s) => s.id), [0, 4])
  assert.deepEqual(odd.audio.map((a) => [a.id, a.codec]), [[2, 'aac'], [3, 'eac3']])
  assert.equal(odd.video.id, 1)
  const second = mapMediaInfo(golden('item-second-movie.json')).info
  assert.equal(second.autoPtSource, 2)
  assert.deepEqual(second.playback, { supported: true, reason: null })
  const hevc = mapMediaInfo(golden('item-hevc-movie.json')).info
  assert.deepEqual(hevc.playback, { supported: false, reason: 'video-codec' })
})

test('mapMediaInfo: items without streams', () => {
  const { info } = mapMediaInfo({ Id: 'a'.repeat(32) })
  assert.deepEqual(info, { duration: 0, container: '', video: null, audio: [], subtitles: [], autoPtSource: null, playback: { supported: false, reason: 'no-video' } })
})

test('containerToFormat maps Jellyfin names to ffprobe format names', () => {
  const table = { mkv: 'matroska,webm', MKV: 'matroska,webm', webm: 'matroska,webm', mp4: 'mov,mp4,m4a,3gp,3g2,mj2', m4v: 'mov,mp4,m4a,3gp,3g2,mj2', mov: 'mov,mp4,m4a,3gp,3g2,mj2', avi: 'avi', ts: 'mpegts', 'mov,mp4,m4a,3gp,3g2,mj2': 'mov,mp4,m4a,3gp,3g2,mj2', weird: 'weird', '': '', undefined: 'undefined' }
  for (const [input, out] of Object.entries(table)) assert.equal(containerToFormat(input === 'undefined' ? undefined : input), out === 'undefined' ? '' : out, input)
})

/* ------------------------------ video page ------------------------------ */

test('mapVideoDetail: a movie', () => {
  const v = mapVideoDetail(golden('item-test-movie.json'))
  assert.deepEqual(
    Object.keys(v).sort(),
    ['audio', 'container', 'duration', 'episode', 'episodeEnd', 'favorite', 'fileName', 'genres', 'hasBackdrop', 'hasImage', 'height', 'id', 'kind', 'label', 'next', 'officialRating', 'overview', 'playback', 'prev', 'progress', 'rating', 'season', 'seriesId', 'seriesTitle', 'size', 'subs', 'title', 'vcodec', 'vprofile', 'width', 'year'].sort()
  )
  assert.deepEqual(
    [v.kind, v.title, v.year, v.fileName, v.container, v.vcodec, v.vprofile, v.width, v.height, v.duration, v.size, v.rating, v.officialRating],
    ['movie', 'Test Movie', 2020, 'Test Movie (2020).mkv', 'mkv', 'h264', 'Constrained Baseline', 320, 180, 310.021, 11929290, 7.8, 'PG-13']
  )
  assert.deepEqual([v.season, v.episode, v.episodeEnd, v.label, v.seriesId, v.seriesTitle, v.prev, v.next], [null, null, null, null, null, null, null, null])
  assert.deepEqual(v.audio[1], { id: 3, codec: 'eac3', lang: 'eng', title: 'English 5.1', channels: 6, default: false })
  assert.deepEqual(v.subs[0], { id: 0, codec: 'subrip', lang: 'por', title: '', external: true, default: false, forced: false })
  assert.equal(v.subs.find((s) => s.title === 'Signs & Songs').forced, true)
  assert.deepEqual(v.playback, { supported: true, reason: null })
  assert.deepEqual([v.hasImage, v.hasBackdrop, v.favorite, v.progress], [true, true, false, null])
  assert.equal(v.overview, 'A generated movie used to test the Kaizen library backend.')
  assert.equal(JSON.stringify(v).includes('/media/'), false, 'only the base name of the file leaves the main process')
})

test('mapVideoDetail: an episode (multi-episode file) with neighbours, and a position', () => {
  const eps = golden('episodes-test-show.json').Items.map(mapEpisode)
  const multi = golden('item-episode-multi.json')
  const v = mapVideoDetail(multi, { prev: eps[2], next: eps[4] })
  assert.deepEqual([v.kind, v.season, v.episode, v.episodeEnd, v.label, v.seriesTitle, v.title], ['episode', 1, 3, 4, 'S01E03-E04', 'Test Show', 'Double Feature / Double Feature 2'])
  assert.equal(v.seriesId, '96911d3a53fc2ef5c090d5c3342da3ba')
  assert.deepEqual(Object.keys(v.prev).sort(), ['id', 'label', 'title'])
  assert.deepEqual(v.next, { id: eps[4].id, label: eps[4].label, title: 'Return' })
  const resumed = mapVideoDetail(golden('item-test-movie-progress.json'))
  assert.deepEqual(resumed.progress, { position: 120, duration: 310.021, watched: false })
  const cleared = mapVideoDetail(golden('item-test-movie-after-short-stop.json'))
  assert.equal(cleared.progress, null, 'Jellyfin forgets the position when a play ends in its first 5 %')
})

/* ------------------------------ continue watching ------------------------------ */

test('continue watching: resume + next-up items merge to one entry per title, newest first', () => {
  const resume = golden('resume-progress.json').Items.map(mapResumeItem)
  assert.deepEqual(resume.map((r) => [r.type, r.title, r.position, r.next]), [
    ['episode', 'Second Wind', 100, false],
    ['movie', 'Test Movie', 120, false]
  ])
  const episode = resume[0]
  assert.deepEqual(
    { key: episode.key, seriesTitle: episode.seriesTitle, season: episode.season, episode: episode.episode, label: episode.label, hasImage: episode.hasImage, duration: episode.duration },
    { key: 's:96911d3a53fc2ef5c090d5c3342da3ba', seriesTitle: 'Test Show', season: 1, episode: 2, label: 'S01E02', hasImage: false, duration: 310.021 }
  )
  assert.equal(episode.seriesId, '96911d3a53fc2ef5c090d5c3342da3ba')
  assert.equal(resume[1].key, 'm:43f9fd2bbf55a40e1bf2de36cc27f485')
  assert.deepEqual([resume[1].seriesId, resume[1].label, resume[1].season], [null, null, null])

  const nextUp = golden('nextup-progress.json').Items.map((i) => mapNextUpItem(i, 5))
  assert.equal(nextUp[0].next, false, 'Jellyfin lists the episode in progress; it is not a "next" one')
  const merged = mergeContinue([...resume, ...nextUp])
  assert.equal(merged.length, 2, 'the episode appears once')
  assert.deepEqual(merged.map((m) => m.videoId).sort(), [...new Set(merged.map((m) => m.videoId))].sort())
  assert.ok(merged[0].updatedAt >= merged[1].updatedAt)
})

test('continue watching: a finished episode is followed by a "next" entry at position 0', () => {
  const raw = { ...golden('nextup-progress.json').Items[0], UserData: { PlaybackPositionTicks: 0, Played: false } }
  const item = mapNextUpItem(raw, 1700000000000)
  assert.deepEqual([item.next, item.position, item.updatedAt, item.type], [true, 0, 1700000000000, 'episode'])
  // an older in-progress entry of the same series loses against a newer "next" one; at most 20 are kept
  const older = { ...item, next: false, position: 50, updatedAt: 10, videoId: 'x'.repeat(32) }
  assert.equal(mergeContinue([older, item]).length, 1)
  assert.equal(mergeContinue([older, item])[0].next, true)
  const many = Array.from({ length: 30 }, (_, i) => ({ ...item, key: `s:${i}`, videoId: String(i), updatedAt: i }))
  const top = mergeContinue(many)
  assert.equal(top.length, 20)
  assert.equal(top[0].updatedAt, 29)
  assert.deepEqual(mergeContinue([]), [])
})
