// Test fixtures for the local library: tiny real videos made with the bundled ffmpeg.
//
//   import { makeVideo, makeSrt, ffmpegBin, ffprobeBin } from './fixtures.mjs'
//   await makeVideo({ file: 'D:/tmp/a.mkv', duration: 4, audio: [{ lang: 'jpn' }], subs: [{ lang: 'por', title: 'Brazilian', cues: [...] }] })
//
// Everything runs without Electron and without anything installed on the PC (vendor/ffmpeg).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
export const appDir = path.resolve(here, '..', '..')

const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name)
const bundled = (name) => {
  const candidate = path.join(appDir, 'vendor', 'ffmpeg', exe(name))
  return fs.existsSync(candidate) ? candidate : name // fall back to the PATH
}
export const ffmpegBin = bundled('ffmpeg')
export const ffprobeBin = bundled('ffprobe')

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true })
    let err = ''
    proc.stderr.on('data', (d) => (err += d))
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${bin} exited ${code}: ${err.slice(-400)}`))))
  })
}

const pad = (n, w = 2) => String(n).padStart(w, '0')
const srtTime = (sec) => {
  const ms = Math.round(sec * 1000)
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
}

// cues: [{ start, end, text }] in seconds
export function makeSrt(file, cues) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const body = cues
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join('\n')
  fs.writeFileSync(file, body, 'utf8')
  return file
}

export const defaultCues = (prefix = 'Line') => [
  { start: 0.5, end: 1.5, text: `${prefix} 1` },
  { start: 2.0, end: 3.0, text: `${prefix} 2` }
]

// Options:
//   file       output path; the extension picks the container (.mkv .mp4 .avi .webm .ts ...)
//   duration   seconds (default 4)
//   size       'WxH' (default 320x180)
//   vcodec     libx264 (default) | libx265 | mpeg4 | libvpx-vp9 | ...
//   pixFmt     yuv420p (default) | yuv420p10le | ...
//   acodec     aac (default) | eac3 | ac3 | libopus | libmp3lame | none
//   audio      [{ lang, title, freq }]  one entry per audio track (default: one track, no tags)
//   subs       [{ lang, title, cues }]  embedded text subtitle tracks (mkv: subrip, mp4: mov_text)
//   noVideo    true -> audio only file (for "no video stream" cases)
export async function makeVideo({
  file,
  duration = 4,
  size = '320x180',
  vcodec = 'libx264',
  pixFmt = 'yuv420p',
  acodec = 'aac',
  audio = [{}],
  subs = [],
  noVideo = false
}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const ext = path.extname(file).toLowerCase()
  const inputs = []
  const maps = []
  let idx = 0

  if (!noVideo) {
    inputs.push('-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=12:duration=${duration}`)
    maps.push('-map', `${idx++}:v`)
  }
  const audioTracks = acodec === 'none' ? [] : audio
  audioTracks.forEach((a, n) => {
    inputs.push('-f', 'lavfi', '-i', `sine=frequency=${a.freq || 440 + n * 110}:sample_rate=48000:duration=${duration}`)
    maps.push('-map', `${idx++}:a`)
  })
  const tmp = fs.mkdtempSync(path.join(path.dirname(file), '.fx-'))
  subs.forEach((s, n) => {
    const srt = makeSrt(path.join(tmp, `s${n}.srt`), s.cues || defaultCues(s.title || s.lang || 'Sub'))
    inputs.push('-i', srt)
    maps.push('-map', `${idx++}:s`)
  })

  const args = ['-v', 'error', '-y', ...inputs, ...maps]
  if (!noVideo) {
    args.push('-c:v', vcodec, '-pix_fmt', pixFmt)
    if (vcodec === 'libx264') args.push('-preset', 'ultrafast', '-g', '12')
    if (vcodec === 'libx265') args.push('-preset', 'ultrafast', '-x265-params', 'log-level=error:keyint=12')
    if (vcodec === 'libvpx-vp9') args.push('-deadline', 'realtime', '-cpu-used', '8')
  }
  if (audioTracks.length) args.push('-c:a', acodec, '-b:a', '96k')
  if (subs.length) args.push('-c:s', ext === '.mp4' || ext === '.m4v' || ext === '.mov' ? 'mov_text' : 'srt')
  audioTracks.forEach((a, n) => {
    if (a.lang) args.push(`-metadata:s:a:${n}`, `language=${a.lang}`)
    if (a.title) args.push(`-metadata:s:a:${n}`, `title=${a.title}`)
  })
  subs.forEach((s, n) => {
    if (s.lang) args.push(`-metadata:s:s:${n}`, `language=${s.lang}`)
    if (s.title) args.push(`-metadata:s:s:${n}`, `title=${s.title}`)
  })
  args.push(file)
  try {
    await run(ffmpegBin, args)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  return file
}

// A small tree with the naming styles the library has to understand. Returns the list of created
// files (absolute paths). Files are real (tiny) videos so that ffprobe / thumbnails work on them.
export async function makeSampleLibrary(root, { duration = 3 } = {}) {
  const files = [
    // movies
    'Movies/Blade Runner 2049 (2017)/Blade.Runner.2049.2017.1080p.BluRay.x264-GRP.mkv',
    'Movies/Inception (2010).mp4',
    'Movies/Wall-E.2008.720p.WEB-DL.mkv',
    // a series in release style, in season folders
    'Series/Breaking Bad/Season 1/Breaking.Bad.S01E01.Pilot.720p.mkv',
    'Series/Breaking Bad/Season 1/Breaking.Bad.S01E02.Cats.in.the.Bag.720p.mkv',
    'Series/Breaking Bad/Season 2/Breaking.Bad.S02E01.Seven.Thirty-Seven.720p.mkv',
    // a series with "1x02" naming and no show name in the file
    'Series/The Expanse (2015)/Season 01/01 - Dulcinea.mkv',
    'Series/The Expanse (2015)/Season 01/02 - The Big Empty.mkv',
    // anime, fansub style, absolute numbering
    'Anime/[SubsPlease] Frieren - Beyond Journey End - 01 (1080p) [A1B2C3D4].mkv',
    'Anime/[SubsPlease] Frieren - Beyond Journey End - 02 (1080p) [E5F6A7B8].mkv'
  ]
  const made = []
  for (const rel of files) {
    const file = path.join(root, ...rel.split('/'))
    await makeVideo({ file, duration })
    made.push(file)
  }
  return made
}
