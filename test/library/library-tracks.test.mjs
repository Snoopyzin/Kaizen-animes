// mediainfo / subtitles / audio: the player-menu routes, with real generated media and the real ffmpeg.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn as realSpawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { PROBE_ENTRIES, assessDirectPlay, buildMediaInfo } from '../../src/main/media.js'
import { runProcess } from '../../src/main/tools.js'
import { ffmpegBin, ffprobeBin, makeVideo } from './fixtures.mjs'
import { golden, startMockJellyfin } from './mock-jellyfin.mjs'
import { TOKEN, pidAlive, startBackend, tempDir, waitFor } from './helpers.mjs'

let mock
let b
let spawnCalls
const tmp = tempDir('kaizen-tracks-')
test.before(async () => {
  mock = await startMockJellyfin()
  spawnCalls = []
  b = await startBackend({
    mock,
    spawn: (cmd, args, options) => {
      const child = realSpawn(cmd, args, options)
      spawnCalls.push({ cmd, args, child })
      return child
    }
  })
})
test.after(async () => {
  await b.close()
  await mock.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

/* ------------------------------ a "Jellyfin" view of a real file ------------------------------ */

const probeRaw = async (file) => JSON.parse(await runProcess(ffprobeBin, ['-v', 'error', '-show_entries', PROBE_ENTRIES, '-of', 'json', file]))

// What Jellyfin reports for a file: one MediaStream per ffprobe stream; side-car subtitle files, when
// there are any, are numbered FIRST and push every embedded stream's Index up (verified on Jellyfin 12.2).
function jellyfinStreams(probe, { external = [] } = {}) {
  const tpl = golden('item-test-movie.json').MediaSources[0].MediaStreams
  const video = tpl.find((s) => s.Type === 'Video')
  const audio = tpl.find((s) => s.Type === 'Audio')
  const sub = tpl.find((s) => s.Type === 'Subtitle' && !s.IsExternal)
  const shift = external.length
  const streams = external.map((e, i) => ({ ...tpl.find((s) => s.IsExternal), Index: i, Language: e.lang, Codec: e.codec || 'subrip', IsTextSubtitleStream: e.text !== false, Title: e.title }))
  for (const st of probe.streams) {
    const common = { Index: st.index + shift, Codec: st.codec_name, Language: st.tags?.language, Title: st.tags?.title, IsDefault: !!st.disposition?.default, IsExternal: false }
    if (st.codec_type === 'video') {
      streams.push({ ...video, ...common, Profile: st.profile, Width: st.width, Height: st.height, PixelFormat: st.pix_fmt })
    } else if (st.codec_type === 'audio') {
      streams.push({ ...audio, ...common, Channels: st.channels })
    } else if (st.codec_type === 'subtitle') {
      streams.push({ ...sub, ...common, IsTextSubtitleStream: ['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text'].includes(st.codec_name) })
    }
  }
  return streams
}

const FORMAT_TO_CONTAINER = { 'matroska,webm': 'mkv', 'mov,mp4,m4a,3gp,3g2,mj2': 'mp4', avi: 'avi' }
async function registerFile(file, { name, external = [] } = {}) {
  const probe = await probeRaw(file)
  const template = golden('item-test-movie.json')
  const ticks = Math.round(Number(probe.format.duration) * 1e7)
  const container = FORMAT_TO_CONTAINER[probe.format.format_name] || probe.format.format_name
  const id = undefined
  const movie = mock.addMovie({
    Id: id,
    Name: name || path.basename(file),
    RunTimeTicks: ticks,
    Container: container,
    ProductionYear: 2021,
    MediaSources: [{ ...template.MediaSources[0], Container: container, RunTimeTicks: ticks, Size: fs.statSync(file).size, MediaStreams: jellyfinStreams(probe, { external }) }]
  })
  mock.useFile(movie.Id, file)
  return { id: movie.Id, probe }
}

const without = (obj, ...keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)))

/* ------------------------------ mediainfo ------------------------------ */

test('mediainfo equals buildMediaInfo(ffprobe) for a generated multi-audio / multi-subtitle file', async () => {
  const file = await makeVideo({
    file: path.join(tmp, 'multi.mkv'),
    duration: 4,
    audio: [{ lang: 'jpn', title: 'Japanese' }, { lang: 'eng' }],
    subs: [{ lang: 'por', title: 'Brazilian' }, { lang: 'eng', title: 'Dubtitle' }]
  })
  const { id, probe } = await registerFile(file, { name: 'multi' })
  const res = await b.json(`/mediainfo/${id}`)
  assert.equal(res.status, 200)
  const truth = buildMediaInfo(probe)
  const info = res.json
  // legitimate differences: `external` on subtitles and `playback` (library additions), and the duration
  // (Jellyfin keeps ticks: 100 ns; ffprobe prints microseconds)
  assert.deepEqual(
    { ...without(info, 'playback', 'duration'), subtitles: info.subtitles.map((s) => without(s, 'external')) },
    without(truth, 'duration')
  )
  assert.ok(Math.abs(info.duration - truth.duration) < 0.001)
  assert.ok(info.subtitles.every((s) => s.external === false))
  assert.deepEqual(info.playback, assessDirectPlay(truth))
  assert.equal(info.audio.length, 2)
  assert.equal(info.subtitles.length, 2)
  assert.equal(info.autoPtSource, null, 'a Brazilian track exists')
  assert.deepEqual(Object.keys(info).sort(), ['audio', 'autoPtSource', 'container', 'duration', 'playback', 'subtitles', 'video'])
})

test('mediainfo equality across codecs and containers (mp4/mov_text, e-ac3, english-only, hevc, audio-only)', async () => {
  const cases = [
    { file: 'mp4.mp4', opts: { duration: 3, audio: [{ lang: 'eng' }], subs: [{ lang: 'eng', title: 'English' }] } },
    { file: 'eac3.mkv', opts: { duration: 3, acodec: 'eac3', audio: [{ lang: 'eng' }, { lang: 'jpn' }] } },
    { file: 'english.mkv', opts: { duration: 3, subs: [{ lang: 'eng', title: 'Signs & Songs' }, { lang: 'eng', title: 'Full' }] } },
    { file: 'hevc.mkv', opts: { duration: 3, vcodec: 'libx265' } },
    { file: 'audio-only.mkv', opts: { duration: 3, noVideo: true } },
    { file: 'avi.avi', opts: { duration: 3, vcodec: 'mpeg4', acodec: 'libmp3lame' } }
  ]
  for (const { file, opts } of cases) {
    const made = await makeVideo({ file: path.join(tmp, file), ...opts })
    const { id, probe } = await registerFile(made, { name: file })
    const info = (await b.json(`/mediainfo/${id}`)).json
    const truth = buildMediaInfo(probe)
    // mp4 keeps a track's title as the QuickTime handler name, which Jellyfin shows and ffprobe does not list as `title`
    const norm = (list) => (file.endsWith('.mp4') ? list.map((t) => ({ ...t, title: '' })) : list)
    assert.deepEqual(
      { ...without(info, 'playback', 'duration'), audio: norm(info.audio), subtitles: norm(info.subtitles.map((s) => without(s, 'external'))) },
      { ...without(truth, 'duration'), audio: norm(truth.audio), subtitles: norm(truth.subtitles) },
      file
    )
    assert.deepEqual(info.playback, assessDirectPlay(truth), file)
  }
  // spot checks that the cases above are really different
  const english = (await b.json(`/mediainfo/${[...mock.items.values()].find((i) => i.Name === 'english.mkv').Id}`)).json
  assert.equal(english.autoPtSource, english.subtitles[1].id, 'the dialogue track, not signs & songs')
  const hevc = (await b.json(`/mediainfo/${[...mock.items.values()].find((i) => i.Name === 'hevc.mkv').Id}`)).json
  assert.equal(hevc.playback.reason, 'video-codec')
  const audioOnly = (await b.json(`/mediainfo/${[...mock.items.values()].find((i) => i.Name === 'audio-only.mkv').Id}`)).json
  assert.deepEqual([audioOnly.video, audioOnly.playback.reason], [null, 'no-video'])
})

test('mediainfo with a side-car subtitle file: ids are Jellyfin\'s (shifted), everything else equals ffprobe', async () => {
  const file = await makeVideo({ file: path.join(tmp, 'sidecar.mkv'), duration: 3, audio: [{ lang: 'jpn' }, { lang: 'eng' }], subs: [{ lang: 'eng', title: 'English' }] })
  const { id, probe } = await registerFile(file, { name: 'sidecar', external: [{ lang: 'por' }] })
  const info = (await b.json(`/mediainfo/${id}`)).json
  const truth = buildMediaInfo(probe)
  assert.deepEqual(info.audio.map((a) => a.id), truth.audio.map((a) => a.id + 1))
  assert.deepEqual(info.subtitles.map((s) => [s.id, s.external, s.lang]), [[0, true, 'por'], [truth.subtitles[0].id + 1, false, 'eng']])
  assert.deepEqual(info.video, { ...truth.video, id: truth.video.id + 1 })
  assert.equal(info.autoPtSource, null, 'the external Portuguese track counts')
})

test('mediainfo: cached, 404 for unknown / not a video, image subtitles are listed but not text', async () => {
  const id = mock.ids.testMovie
  await b.json(`/mediainfo/${id}`)
  const before = mock.requests.length
  await b.json(`/mediainfo/${id}`)
  await b.json(`/mediainfo/${id}`)
  assert.equal(mock.requests.length, before, 'the item is cached for the next calls')
  assert.equal((await b.json(`/mediainfo/${'0'.repeat(31)}1`)).json.error, 'NOT_FOUND')
  assert.equal((await b.json(`/mediainfo/${mock.ids.testShow}`)).json.error, 'NOT_FOUND')
  const pgs = mock.addMovie({
    Name: 'pgs',
    MediaSources: [{ ...golden('item-test-movie.json').MediaSources[0], MediaStreams: golden('item-test-movie.json').MediaSources[0].MediaStreams.filter((s) => !s.IsExternal).concat([{ Index: 8, Type: 'Subtitle', Codec: 'pgssub', Language: 'eng', IsTextSubtitleStream: false, IsExternal: false, IsDefault: false }]) }]
  })
  const info = (await b.json(`/mediainfo/${pgs.Id}`)).json
  assert.deepEqual(info.subtitles.at(-1), { id: 8, codec: 'pgssub', lang: 'eng', title: '', default: false, text: false, external: false })
})

/* ------------------------------ subtitles ------------------------------ */

const subtitleRequests = () => mock.requests.filter((r) => /Subtitles/.test(r.path))
// Test Movie: 4 subtitle streams (0 = external por, 5 = eng, 6 = eng "Signs & Songs", 7 = spa); embedded cues at 1, 11, 21 ... (2 s each)

test('subtitles: native windows slice the whole track, overlapping cues included', async () => {
  const id = mock.ids.testMovie
  const win = async (from, len, track = 5) => (await b.json(`/subtitles/${id}?track=${track}&from=${from}&len=${len}`)).json
  const first = await win(0, 25)
  assert.deepEqual([first.from, first.len, first.source], [0, 25, 'native'])
  assert.deepEqual(first.cues, [{ s: 1, e: 3, t: 'English 1' }, { s: 11, e: 13, t: 'English 2' }, { s: 21, e: 23, t: 'English 3' }])
  assert.deepEqual((await win(12, 10)).cues.map((c) => c.t), ['English 2', 'English 3'], 'a cue that is already running at `from` is included (len is at least 10)')
  assert.deepEqual((await win(14, 10)).cues.map((c) => c.t), ['English 3'], 'a cue that ended before `from` is not')
  assert.deepEqual((await win(3, 10)).cues.map((c) => c.t), ['English 1', 'English 2'], 'a cue ending exactly at `from`, and one starting exactly at the end')
  assert.equal((await win(1000, 60)).cues.length, 0, 'past the end')
  assert.deepEqual((await win(0, 25, 6)).cues.length, 3, 'another track')
  // defaults and clamps
  const defaults = (await b.json(`/subtitles/${id}?track=5`)).json
  assert.deepEqual([defaults.from, defaults.len], [0, 120])
  assert.equal(defaults.cues.length, 12)
  const clamped = (await b.json(`/subtitles/${id}?track=5&from=-9&len=1`)).json
  assert.deepEqual([clamped.from, clamped.len], [0, 10])
  assert.equal((await b.json(`/subtitles/${id}?track=5&from=0&len=99999`)).json.len, 600)
  assert.deepEqual((await b.json(`/subtitles/${id}?track=5&from=abc&len=abc`)).json.cues.length, 12)
  // external and mov_text tracks come through the same route
  assert.deepEqual((await win(0, 15, 0)).cues.map((c) => c.t), ['Legenda externa 1', 'Legenda externa 2'])
  assert.deepEqual((await b.json(`/subtitles/${mock.ids.secondMovie}?track=2&from=0&len=60`)).json.cues.map((c) => c.t), ['English 1', 'English 2', 'English 3'])
})

test('subtitles: the whole track is fetched from Jellyfin once and cached (single flight too)', async () => {
  const id = mock.ids.coverMovie
  const stream = mock.items.get(id).MediaSources[0].MediaStreams.find((s) => s.Type === 'Subtitle')
  const before = subtitleRequests().length
  mock.slow(/Subtitles/, 80, 1)
  const results = await Promise.all([0, 20, 40, 60].map((from) => b.json(`/subtitles/${id}?track=${stream.Index}&from=${from}&len=30`)))
  assert.ok(results.every((r) => r.status === 200))
  assert.equal(subtitleRequests().length - before, 1, 'four windows, one download')
  await b.json(`/subtitles/${id}?track=${stream.Index}&from=100&len=30`)
  assert.equal(subtitleRequests().length - before, 1, 'and nothing more later')
  const asked = subtitleRequests().at(-1)
  assert.equal(asked.path, `/Videos/${id}/${mock.items.get(id).MediaSources[0].Id}/Subtitles/${stream.Index}/0/Stream.vtt`)
  mock.clearRules()
})

test('subtitles: the track must exist, be a subtitle and be text', async () => {
  const id = mock.ids.testMovie
  const before = subtitleRequests().length
  assert.equal((await b.json(`/subtitles/${id}?track=1`)).json.error, 'NOT_FOUND', 'a video stream')
  assert.equal((await b.json(`/subtitles/${id}?track=2`)).json.error, 'NOT_FOUND', 'an audio stream')
  assert.equal((await b.json(`/subtitles/${id}?track=99`)).json.error, 'NOT_FOUND')
  assert.equal(subtitleRequests().length, before, 'checked against the item before asking Jellyfin')
  for (const track of ['abc', '-1', '1.5', '', '1;2', '99999999', 'auto', 'AUTO-PT', '0x5']) {
    assert.equal((await b.json(`/subtitles/${id}?track=${encodeURIComponent(track)}`)).status, 400, track)
  }
  assert.equal((await b.json(`/subtitles/${id}`)).status, 400)
  assert.equal((await b.json(`/subtitles/${id}?track=5&track=6`)).status, 400, 'repeated parameter')
  const pgs = mock.addMovie({
    Name: 'pgs2',
    MediaSources: [{ ...golden('item-test-movie.json').MediaSources[0], MediaStreams: [{ Index: 0, Type: 'Video', Codec: 'h264' }, { Index: 1, Type: 'Subtitle', Codec: 'pgssub', Language: 'eng', IsTextSubtitleStream: false, IsExternal: false }] }]
  })
  const image = await b.json(`/subtitles/${pgs.Id}?track=1`)
  assert.deepEqual([image.status, image.json.error], [404, 'NOT_FOUND'])
  assert.match(image.json.message, /image-based/)
  assert.equal(subtitleRequests().length, before)
  // Jellyfin failing to convert a text track is a 502, not a hang
  mock.fail(/Subtitles/, 500, 1)
  assert.deepEqual([(await b.json(`/subtitles/${id}?track=7&from=0`)).status], [502])
  mock.clearRules()
  assert.equal((await b.json(`/subtitles/${'0'.repeat(31)}1?track=5`)).json.error, 'NOT_FOUND')
})

test('subtitles auto-pt: the English dialogue track translated per window, cached, failures are not remembered', async () => {
  const id = mock.ids.secondMovie // english only
  let calls = 0
  const translated = await startBackend({
    mock,
    translateCues: async (cues) => {
      calls++
      return { cues: cues.map((c) => ({ ...c, t: `PT:${c.t}` })), failed: false }
    }
  })
  try {
    const info = (await translated.json(`/mediainfo/${id}`)).json
    assert.equal(info.autoPtSource, 2)
    const r = await translated.json(`/subtitles/${id}?track=auto-pt&from=0&len=60`)
    assert.deepEqual([r.status, r.json.source, r.json.from, r.json.len], [200, 'translated', 0, 60])
    assert.deepEqual(r.json.cues, [{ s: 1, e: 3, t: 'PT:English 1' }, { s: 4, e: 6, t: 'PT:English 2' }, { s: 7, e: 9, t: 'PT:English 3' }])
    assert.equal(calls, 1)
    await translated.json(`/subtitles/${id}?track=auto-pt&from=0&len=60`)
    assert.equal(calls, 1, 'the same window comes from the cache')
    await translated.json(`/subtitles/${id}?track=auto-pt&from=5&len=60`)
    assert.equal(calls, 2, 'another window is translated separately')
    const empty = await translated.json(`/subtitles/${id}?track=auto-pt&from=500&len=60`)
    assert.deepEqual([empty.json.source, empty.json.cues], ['translated', []])
    assert.equal(calls, 2, 'nothing to translate = no translator call')
    // the native track is untouched by the translator
    assert.equal((await translated.json(`/subtitles/${id}?track=2&from=0&len=60`)).json.cues[0].t, 'English 1')
  } finally {
    await translated.close()
  }
})

test('subtitles auto-pt: translation_failed returns the original text and is retried next time', async () => {
  const id = mock.ids.secondMovie
  let calls = 0
  let fail = true
  const flaky = await startBackend({
    mock,
    translateCues: async (cues) => {
      calls++
      return fail ? { cues, failed: true } : { cues: cues.map((c) => ({ ...c, t: 'PT' })), failed: false }
    }
  })
  try {
    const first = (await flaky.json(`/subtitles/${id}?track=auto-pt&from=0&len=60`)).json
    assert.equal(first.source, 'translation_failed')
    assert.equal(first.cues[0].t, 'English 1')
    fail = false
    const second = (await flaky.json(`/subtitles/${id}?track=auto-pt&from=0&len=60`)).json
    assert.deepEqual([second.source, second.cues[0].t, calls], ['translated', 'PT', 2])
  } finally {
    await flaky.close()
  }
  // no translator at all: also "failed", never a crash
  const bare = await startBackend({ mock, translateCues: null })
  try {
    const r = await bare.json(`/subtitles/${id}?track=auto-pt&from=0&len=60`)
    assert.equal(r.status, 200)
    assert.equal(r.json.source === 'translated' || r.json.source === 'translation_failed', true)
  } finally {
    await bare.close()
  }
})

test('subtitles auto-pt without an English text track or with Portuguese already there is NOT_FOUND', async () => {
  assert.equal((await b.json(`/subtitles/${mock.ids.testMovie}?track=auto-pt`)).json.error, 'NOT_FOUND')
  const noSubs = mock.addMovie({ Name: 'nosubs', MediaSources: [{ ...golden('item-test-movie.json').MediaSources[0], MediaStreams: [{ Index: 0, Type: 'Video', Codec: 'h264' }, { Index: 1, Type: 'Audio', Codec: 'aac', Channels: 2 }] }] })
  assert.equal((await b.json(`/subtitles/${noSubs.Id}?track=auto-pt`)).status, 404)
})

/* ------------------------------ audio ------------------------------ */

// tone frequency and real duration of an audio file (decoded to mono PCM, zero crossings counted)
async function measure(file) {
  const pcm = await new Promise((resolve, reject) => {
    const proc = realSpawn(ffmpegBin, ['-v', 'error', '-i', file, '-ac', '1', '-ar', '48000', '-f', 's16le', 'pipe:1'], { windowsHide: true })
    const chunks = []
    proc.stdout.on('data', (c) => chunks.push(c))
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`decode exited ${code}`))))
  })
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2))
  let crossings = 0
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] < 0 !== samples[i] < 0) crossings++
  const seconds = samples.length / 48000
  return { hz: Math.round(crossings / 2 / seconds), seconds }
}

async function saveAudio(response, file, { max = Infinity } = {}) {
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  while (total < max) {
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(Buffer.from(value))
    total += value.length
  }
  await reader.cancel().catch(() => {})
  fs.writeFileSync(file, Buffer.concat(chunks))
  return total
}

test('audio: the requested track comes out as stereo AAC (ADTS) through the whole chain, by position not by Jellyfin index', async () => {
  const file = await makeVideo({ file: path.join(tmp, 'three-audio.mkv'), duration: 6, audio: [{ lang: 'jpn', freq: 440 }, { lang: 'eng', freq: 880 }, { lang: 'por', freq: 660 }], subs: [{ lang: 'eng' }] })
  // Jellyfin numbers a side-car subtitle first: audio indexes are 2, 3, 4 while ffmpeg's are 1, 2, 3
  const { id } = await registerFile(file, { name: 'three-audio', external: [{ lang: 'por' }] })
  const info = (await b.json(`/mediainfo/${id}`)).json
  assert.deepEqual(info.audio.map((a) => a.id), [2, 3, 4])
  for (const [lang, hz] of [['jpn', 440], ['eng', 880], ['por', 660]]) {
    const track = info.audio.find((a) => a.lang === lang).id
    spawnCalls.length = 0
    const res = await b.api(`/audio/${id}?track=${track}&start=0`)
    assert.equal(res.status, 200, lang)
    assert.equal(res.headers.get('content-type'), 'audio/aac')
    assert.equal(res.headers.get('cache-control'), 'no-store')
    const out = path.join(tmp, `audio-${lang}.aac`)
    await saveAudio(res, out)
    const probe = JSON.parse(await runProcess(ffprobeBin, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,channels', '-of', 'json', out]))
    assert.deepEqual([probe.streams[0].codec_type, probe.streams[0].codec_name, probe.streams[0].channels], ['audio', 'aac', 2])
    const measured = await measure(out)
    assert.ok(Math.abs(measured.seconds - 6) < 0.3, `the whole 6 s file came out: ${measured.seconds}`)
    assert.ok(Math.abs(measured.hz - hz) < 20, `${lang}: expected ~${hz} Hz, got ${measured.hz}`)
    // the command line: no shell, the Nth audio stream, our own proxy as the input, never the Jellyfin token
    const call = spawnCalls.at(-1)
    const ordinal = info.audio.findIndex((a) => a.lang === lang)
    assert.deepEqual(call.args.slice(call.args.indexOf('-map'), call.args.indexOf('-map') + 2), ['-map', `0:a:${ordinal}`])
    assert.equal(call.args[call.args.indexOf('-i') + 1], `http://127.0.0.1:${b.port}/library/stream/${id}?t=${TOKEN}`)
    assert.ok(call.args.includes('-user_agent'))
    assert.equal(call.args.join(' ').includes([...mock.state.tokens][0]), false, 'the Jellyfin token never appears on a command line')
    for (const flag of ['-vn', '-sn', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-f', 'adts', 'pipe:1']) assert.ok(call.args.includes(flag), flag)
  }
})

test('audio: start seeks into the file', async () => {
  const id = [...mock.items.values()].find((i) => i.Name === 'three-audio').Id
  const info = (await b.json(`/mediainfo/${id}`)).json
  spawnCalls.length = 0
  const res = await b.api(`/audio/${id}?track=${info.audio[0].id}&start=3`)
  const out = path.join(tmp, 'audio-start.aac')
  await saveAudio(res, out)
  const { seconds } = await measure(out)
  assert.ok(seconds > 2.7 && seconds < 3.3, `from 3 s of a 6 s file: ${seconds}`)
  const args = spawnCalls.at(-1).args
  assert.equal(args[args.indexOf('-ss') + 1], '3')
  // negative / junk start = 0
  spawnCalls.length = 0
  await saveAudio(await b.api(`/audio/${id}?track=${info.audio[0].id}&start=-5`), path.join(tmp, 'x.aac'), { max: 1 })
  assert.equal(spawnCalls.at(-1).args[spawnCalls.at(-1).args.indexOf('-ss') + 1], '0')
})

test('audio: bad requests never start ffmpeg', async () => {
  const id = mock.ids.testMovie
  spawnCalls.length = 0
  assert.equal((await b.api(`/audio/${id}`)).status, 400)
  for (const track of ['abc', '-1', '1.5', '2;3', '', 'auto-pt']) assert.equal((await b.api(`/audio/${id}?track=${encodeURIComponent(track)}`)).status, 400, track)
  assert.equal((await b.json(`/audio/${id}?track=1`)).json.error, 'NOT_FOUND', 'a video stream')
  assert.equal((await b.json(`/audio/${id}?track=5`)).json.error, 'NOT_FOUND', 'a subtitle stream')
  assert.equal((await b.json(`/audio/${id}?track=99`)).json.error, 'NOT_FOUND')
  assert.equal((await b.json(`/audio/${'0'.repeat(31)}1?track=1`)).json.error, 'NOT_FOUND')
  assert.equal(spawnCalls.length, 0)
})

// an audio-only file long enough that ffmpeg is still running when the client leaves
async function longAudio(seconds = 900) {
  const file = path.join(tmp, `long-${seconds}.mkv`)
  if (!fs.existsSync(file)) {
    await runProcess(ffmpegBin, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=500:sample_rate=16000:duration=${seconds}`, '-c:a', 'aac', '-b:a', '24k', file])
  }
  return registerFile(file, { name: `long-${seconds}` })
}

test('audio ABORT: when the player leaves, ffmpeg is killed and the proxy connection to Jellyfin closes (no leaks)', async () => {
  const { id } = await longAudio()
  const info = (await b.json(`/mediainfo/${id}`)).json
  spawnCalls.length = 0
  const controller = new AbortController()
  const res = await b.api(`/audio/${id}?track=${info.audio[0].id}`, { signal: controller.signal })
  assert.equal(res.status, 200)
  const reader = res.body.getReader()
  await reader.read()
  assert.equal(b.library.tracks.activeAudio, 1)
  const child = spawnCalls.at(-1).child
  const pid = child.pid
  assert.ok(pidAlive(pid))
  assert.ok(mock.state.activeStreams >= 1, 'ffmpeg is reading the file through the proxy')
  controller.abort()
  assert.ok(await waitFor(() => !pidAlive(pid), { timeout: 5000 }), 'the ffmpeg process is gone')
  assert.ok(await waitFor(() => b.library.tracks.activeAudio === 0))
  assert.equal(b.library.tracks.processes.size, 0)
  assert.ok(await waitFor(() => mock.state.activeStreams === 0, { timeout: 5000 }), 'the stream from Jellyfin was closed too')
})

test('audio ABORT right after the request: still no leaked process', async () => {
  const { id } = await longAudio()
  const info = (await b.json(`/mediainfo/${id}`)).json
  spawnCalls.length = 0
  for (let i = 0; i < 3; i++) {
    const controller = new AbortController()
    const pending = b.api(`/audio/${id}?track=${info.audio[0].id}`, { signal: controller.signal }).catch(() => null)
    await new Promise((r) => setTimeout(r, 30 * i))
    controller.abort()
    await pending
  }
  assert.ok(await waitFor(() => spawnCalls.every((c) => !pidAlive(c.child.pid)), { timeout: 8000 }), 'every ffmpeg exited')
  assert.ok(await waitFor(() => b.library.tracks.activeAudio === 0 && mock.state.activeStreams === 0, { timeout: 5000 }))
})

test('audio: at most N conversions at once; the next waits briefly, then gets 503 + Retry-After', async () => {
  const one = await startBackend({ mock, maxAudio: 1 })
  try {
    const { id } = await longAudio()
    const info = (await one.json(`/mediainfo/${id}`)).json
    const track = info.audio[0].id
    const first = new AbortController()
    const a = await one.api(`/audio/${id}?track=${track}`, { signal: first.signal })
    await a.body.getReader().read()
    const t0 = Date.now()
    const refused = await one.api(`/audio/${id}?track=${track}`)
    assert.equal(refused.status, 503)
    assert.equal(refused.headers.get('retry-after'), '2')
    assert.equal((await refused.json()).error, 'BUSY')
    assert.ok(Date.now() - t0 >= 1500, 'it waited for a slot before giving up')
    first.abort()
    assert.ok(await waitFor(() => one.library.tracks.activeAudio === 0))
    const again = await one.api(`/audio/${id}?track=${track}`)
    assert.equal(again.status, 200)
    await again.body.cancel()
    assert.ok(await waitFor(() => one.library.tracks.activeAudio === 0))
  } finally {
    await one.close()
  }
})

test('audio: a seek (new request) frees the slot of the old one in time', async () => {
  const one = await startBackend({ mock, maxAudio: 1 })
  try {
    const { id } = await longAudio()
    const track = (await one.json(`/mediainfo/${id}`)).json.audio[0].id
    const old = new AbortController()
    const a = await one.api(`/audio/${id}?track=${track}&start=10`, { signal: old.signal })
    const readerA = a.body.getReader()
    await readerA.read()
    // the browser aborts the old request and immediately asks for the new position
    old.abort()
    const fresh = await one.api(`/audio/${id}?track=${track}&start=500`)
    assert.equal(fresh.status, 200)
    const readerB = fresh.body.getReader()
    await readerB.read()
    await readerB.cancel()
  } finally {
    await one.close()
  }
})

test('audio: ffmpeg that cannot start or cannot read answers a JSON error and logs nothing secret', async () => {
  const missing = await startBackend({ mock, ffmpegPath: path.join(tmp, 'no-such-ffmpeg.exe') })
  try {
    const r = await missing.json(`/audio/${mock.ids.testMovie}?track=2`)
    assert.deepEqual([r.status, r.json.error], [500, 'INTERNAL'])
    assert.equal(missing.library.tracks.activeAudio, 0)
  } finally {
    await missing.close()
  }
  const { id } = await registerFile(path.join(tmp, 'three-audio.mkv'), { name: 'broken-source' })
  const track = (await b.json(`/mediainfo/${id}`)).json.audio[0].id
  mock.fail(/GET \/Videos\/.*\/stream/, 404)
  const logsBefore = b.logs.length
  const r = await b.json(`/audio/${id}?track=${track}`)
  mock.clearRules()
  assert.deepEqual([r.status, r.json.error], [502, 'UPSTREAM_ERROR'])
  assert.ok(await waitFor(() => b.library.tracks.activeAudio === 0))
  assert.equal(b.logs.slice(logsBefore).some((l) => l.includes(TOKEN)), false, 'the per-run secret is redacted from logs')
  assert.equal(JSON.stringify(r.json).includes(TOKEN), false)
})
