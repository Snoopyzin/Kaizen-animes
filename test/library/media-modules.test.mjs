// Checks for the code that was moved out of src/main/index.js (tools.js, media.js): it must work
// on real files made by the bundled ffmpeg, without Electron and without anything on the PATH.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeVideo, ffprobeBin, ffmpegBin, appDir } from './fixtures.mjs'
import { resolveTool, runProcess, httpInputArgs } from '../../src/main/tools.js'
import { PROBE_ENTRIES, buildMediaInfo, assessDirectPlay, parseVtt } from '../../src/main/media.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaizen-media-'))
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))

const probe = async (file) =>
  buildMediaInfo(JSON.parse(await runProcess(ffprobeBin, ['-v', 'error', '-show_entries', PROBE_ENTRIES, '-of', 'json', file])))

test('resolveTool prefers the bundled binaries and falls back to the bare name', () => {
  const found = resolveTool('ffmpeg', { resourcesPath: '', appPath: appDir })
  assert.ok(fs.existsSync(found) || found === 'ffmpeg')
  assert.equal(resolveTool('nope-tool', { resourcesPath: '', appPath: tmp }), 'nope-tool')
})

test('httpInputArgs only adds the user agent for http(s) inputs', () => {
  assert.deepEqual(httpInputArgs('http://127.0.0.1:1/x'), ['-user_agent', 'KaizenSubs'])
  assert.deepEqual(httpInputArgs('https://example.com/x'), ['-user_agent', 'KaizenSubs'])
  assert.deepEqual(httpInputArgs('C:\\Videos\\a.mkv'), [])
  assert.deepEqual(httpInputArgs('/home/me/a.mkv'), [])
})

test('runProcess rejects on a failing process and on timeout', async () => {
  await assert.rejects(runProcess(ffmpegBin, ['-v', 'error', '-i', path.join(tmp, 'missing.mkv')]), /exited/)
  await assert.rejects(runProcess(process.execPath, ['-e', 'setTimeout(()=>{}, 5000)'], 300), /timed out/)
})

test('buildMediaInfo describes a multi-audio, multi-subtitle mkv', async () => {
  const file = await makeVideo({
    file: path.join(tmp, 'multi.mkv'),
    audio: [{ lang: 'jpn', title: 'Japanese' }, { lang: 'eng' }],
    subs: [{ lang: 'por', title: 'Brazilian' }, { lang: 'eng', title: 'Dubtitle' }]
  })
  const info = await probe(file)
  assert.equal(info.video.codec, 'h264')
  assert.equal(info.video.width, 320)
  assert.equal(info.audio.length, 2)
  assert.equal(info.audio[0].lang, 'jpn')
  assert.equal(info.audio[0].supported, true)
  assert.equal(info.subtitles.length, 2)
  assert.ok(info.subtitles.every((s) => s.text))
  assert.ok(info.duration > 3 && info.duration < 5)
  assert.equal(info.autoPtSource, null, 'a Brazilian track exists, so no automatic translation is offered')
})

test('autoPtSource points at the English dialogue track when there is no Portuguese one', async () => {
  const file = await makeVideo({
    file: path.join(tmp, 'en-only.mkv'),
    subs: [{ lang: 'eng', title: 'Signs & Songs' }, { lang: 'eng', title: 'Full' }]
  })
  const info = await probe(file)
  assert.equal(info.autoPtSource, info.subtitles[1].id, 'prefers the dialogue track over signs & songs')
})

test('assessDirectPlay: h264/mkv plays, hevc / avi / 10-bit do not', async () => {
  const ok = await probe(await makeVideo({ file: path.join(tmp, 'ok.mkv') }))
  assert.deepEqual(assessDirectPlay(ok), { supported: true, reason: null })

  const hevc = await probe(await makeVideo({ file: path.join(tmp, 'hevc.mkv'), vcodec: 'libx265' }))
  assert.equal(assessDirectPlay(hevc).reason, 'video-codec')

  const avi = await probe(await makeVideo({ file: path.join(tmp, 'old.avi'), vcodec: 'mpeg4', acodec: 'libmp3lame' }))
  assert.equal(assessDirectPlay(avi).supported, false)

  const tenBit = await probe(await makeVideo({ file: path.join(tmp, '10bit.mkv'), vcodec: 'libx264', pixFmt: 'yuv420p10le' }))
  assert.equal(assessDirectPlay(tenBit).reason, 'bit-depth')

  const audioOnly = await probe(await makeVideo({ file: path.join(tmp, 'a.mkv'), noVideo: true }))
  assert.equal(assessDirectPlay(audioOnly).reason, 'no-video')
})

test('E-AC3 audio is reported as not natively supported (needs the AAC conversion)', async () => {
  const info = await probe(await makeVideo({ file: path.join(tmp, 'eac3.mkv'), acodec: 'eac3' }))
  assert.equal(info.audio[0].codec, 'eac3')
  assert.equal(info.audio[0].supported, false)
})

test('parseVtt strips tags and merges identical stacked cues', () => {
  const cues = parseVtt('WEBVTT\n\n00:01.000 --> 00:02.000\n<i>Hello</i>\nHello\n\n00:01.000 --> 00:02.000\n<i>Hello</i>\nHello\n\n01:00:00.500 --> 01:00:01.000\n{\\an8}Late\n')
  assert.equal(cues.length, 2)
  assert.equal(cues[0].t, 'Hello')
  assert.equal(cues[1].s, 3600.5)
})
