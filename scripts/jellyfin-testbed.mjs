// Real Jellyfin testbed for the Kaizen "Biblioteca" backend (NOT part of `npm test`: it needs the
// network the first time and a few minutes).
//
//   node scripts/jellyfin-testbed.mjs [--root <parent dir>] [--cache <dir for the downloaded zip>]
//                                     [--port <n>] [--keep] [--exit-on-stdin-close]
//
// What it does (Windows only: it uses the Jellyfin portable zip):
//   1. downloads the latest stable Jellyfin Windows portable zip from repo.jellyfin.org (the MD5 the
//      repository publishes is verified) into a FRESH temp directory and extracts it into its own new,
//      empty folder (the download is untrusted data: nothing from it is ever used as a script dir);
//   2. writes network.xml BEFORE the first start so Jellyfin only binds 127.0.0.1 (no discovery, no UPnP):
//      Windows Firewall must never prompt. After the start the listening sockets of the spawned PID are
//      inspected and the run is aborted when one of them is not loopback-only;
//   3. runs it with its own data / config / cache / log folders and `--ffmpeg` = vendor/ffmpeg/ffmpeg.exe;
//   4. completes the startup wizard through the API, creates an admin user, creates a Movies and a Shows
//      library over generated media (Jellyfin naming, several audio tracks, embedded subtitles, side-car
//      .srt, local NFO / images so no internet metadata is needed) and waits for the scan;
//   5. prints ONE JSON line on stdout: { baseUrl, user, password, ... } and keeps running until Ctrl-C
//      (or SIGTERM / `exit`), then shuts down ONLY the PID it spawned and deletes the temp folder.
//
// The module also exports startTestbed() so scripts/jellyfin-e2e.mjs can drive it in-process.
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const APP = path.resolve(here, '..')
const FFMPEG = path.join(APP, 'vendor', 'ffmpeg', 'ffmpeg.exe')
const REPO_PAGE = 'https://repo.jellyfin.org/?path=/server/windows/latest-stable/amd64'
const REPO_BASE = 'https://repo.jellyfin.org'

export const TESTBED_USER = 'kaizen'
export const TESTBED_PASSWORD = 'Testbed-Pass-123'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------ download ------------------------------ */

async function latestRelease(log) {
  const res = await fetch(REPO_PAGE, { signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`repo.jellyfin.org answered HTTP ${res.status}`)
  const html = await res.text()
  const m = html.match(
    /<a href='([^']*jellyfin_([0-9][0-9.]*)-amd64\.zip)'>[\s\S]*?<td>([a-f0-9]{32})<\/td>/
  )
  if (!m) throw new Error('could not find the portable zip in the repository page')
  log(`latest stable: ${m[2]} (md5 ${m[3]})`)
  return { url: REPO_BASE + m[1], version: m[2], md5: m[3] }
}

async function md5OfFile(file) {
  const hash = crypto.createHash('md5')
  await pipeline(fs.createReadStream(file), hash)
  return hash.digest('hex')
}

async function downloadZip(release, destDir, log) {
  fs.mkdirSync(destDir, { recursive: true })
  const zip = path.join(destDir, `jellyfin_${release.version}-amd64.zip`)
  if (fs.existsSync(zip) && (await md5OfFile(zip)) === release.md5) {
    log(`using the cached zip ${zip}`)
    return zip
  }
  log(`downloading ${release.url}`)
  const res = await fetch(release.url, { signal: AbortSignal.timeout(20 * 60 * 1000) })
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`)
  const part = zip + '.part'
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part))
  const got = await md5OfFile(part)
  if (got !== release.md5) {
    fs.rmSync(part, { force: true })
    throw new Error(`MD5 mismatch: expected ${release.md5}, got ${got}`)
  }
  fs.renameSync(part, zip)
  log('download verified (md5 ok)')
  return zip
}

function extractZip(zip, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  if (fs.readdirSync(destDir).length) throw new Error('extraction folder must be empty')
  // bsdtar ships with Windows 10+ and understands zip; it refuses entries that climb out of destDir
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  const r = spawnSync(tar, ['-xf', zip, '-C', destDir], { windowsHide: true, encoding: 'utf8' })
  if (r.status !== 0)
    throw new Error(`tar failed: ${(r.stderr || r.error?.message || '').slice(-300)}`)
  // the archive has one top-level folder, 'jellyfin/'
  const exe = path.join(destDir, 'jellyfin', 'jellyfin.exe')
  if (!fs.existsSync(exe)) throw new Error('jellyfin.exe not found after extraction')
  return exe
}

/* ------------------------------ media generation ------------------------------ */

function runFfmpeg(args) {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-y', ...args], {
    windowsHide: true,
    encoding: 'utf8'
  })
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr || '').slice(-400)}`)
}

const pad = (n, w = 2) => String(n).padStart(w, '0')
const srtTime = (s) =>
  `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(Math.floor(s) % 60)},000`

// one cue every 10 s: "<prefix> 1", "<prefix> 2", ...
export function cuesFor(prefix, seconds) {
  const cues = []
  for (
    let t = 1, i = 1;
    t + 2 < seconds;
    t += Math.max(2, Math.min(10, Math.floor(seconds / 4))), i++
  ) {
    cues.push({ start: t, end: t + 2, text: `${prefix} ${i}` })
  }
  return cues
}

export function writeSrt(file, cues) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    cues
      .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
      .join('\n'),
    'utf8'
  )
}

// layout: ordered list of streams ({kind:'video'|'audio'|'sub'|'cover'|'attachment', ...}); the order is
// the stream order of the file, which is what the Index / `-map 0:<index>` checks are about.
export function makeMedia({
  file,
  seconds = 8,
  fps = 1,
  size = '320x180',
  vcodec = 'libx264',
  layout
}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const ext = path.extname(file).toLowerCase()
  const tmp = fs.mkdtempSync(path.join(path.dirname(file), '.gen-'))
  try {
    const inputs = []
    const maps = []
    const codecs = []
    const meta = []
    const count = { v: 0, a: 0, s: 0, t: 0 }
    let inIdx = 0
    for (const st of layout) {
      if (st.kind === 'video') {
        inputs.push('-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=${fps}:duration=${seconds}`)
        maps.push('-map', `${inIdx++}:v`)
        codecs.push(`-c:v:${count.v}`, vcodec, `-pix_fmt:v:${count.v}`, st.pixFmt || 'yuv420p')
        if (vcodec === 'libx264')
          codecs.push('-preset', 'ultrafast', '-g', String(Math.max(2, fps * 2)))
        if (vcodec === 'libx265')
          codecs.push('-preset', 'ultrafast', '-x265-params', 'log-level=error')
        count.v++
      } else if (st.kind === 'cover') {
        const png = path.join(tmp, 'cover.png')
        runFfmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=200x300:rate=1', '-frames:v', '1', png])
        inputs.push('-i', png)
        maps.push('-map', `${inIdx++}:v`)
        codecs.push(`-c:v:${count.v}`, 'png', `-disposition:v:${count.v}`, 'attached_pic')
        count.v++
      } else if (st.kind === 'audio') {
        const freq = st.freq || 440 + count.a * 110
        inputs.push(
          '-f',
          'lavfi',
          '-i',
          `sine=frequency=${freq}:sample_rate=48000:duration=${seconds}`
        )
        maps.push('-map', `${inIdx++}:a`)
        codecs.push(
          `-c:a:${count.a}`,
          st.codec || 'aac',
          `-b:a:${count.a}`,
          st.bitrate || '48k',
          `-ac:a:${count.a}`,
          String(st.channels || 2)
        )
        if (st.lang) meta.push(`-metadata:s:a:${count.a}`, `language=${st.lang}`)
        if (st.title) meta.push(`-metadata:s:a:${count.a}`, `title=${st.title}`)
        codecs.push(`-disposition:a:${count.a}`, st.default ? 'default' : '0')
        count.a++
      } else if (st.kind === 'sub') {
        const srt = path.join(tmp, `s${count.s}.srt`)
        writeSrt(srt, st.cues || cuesFor(st.title || st.lang || 'Sub', seconds))
        inputs.push('-i', srt)
        maps.push('-map', `${inIdx++}:s`)
        codecs.push(`-c:s:${count.s}`, ext === '.mp4' ? 'mov_text' : 'srt')
        if (st.lang) meta.push(`-metadata:s:s:${count.s}`, `language=${st.lang}`)
        if (st.title) meta.push(`-metadata:s:s:${count.s}`, `title=${st.title}`)
        codecs.push(
          `-disposition:s:${count.s}`,
          st.default ? 'default' : st.forced ? 'forced' : '0'
        )
        count.s++
      } else if (st.kind === 'attachment') {
        const font = path.join(tmp, 'fake.ttf')
        fs.writeFileSync(font, Buffer.alloc(256, 7))
        inputs.push('-attach', font)
        meta.push(`-metadata:s:t:${count.t}`, 'mimetype=application/x-truetype-font')
        meta.push(`-metadata:s:t:${count.t}`, 'filename=fake.ttf')
        count.t++
      }
    }
    runFfmpeg([...inputs, ...maps, ...codecs, ...meta, file])
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  return file
}

function makeImage(file, size) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  runFfmpeg(['-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=1`, '-frames:v', '1', file])
}

const xml = (s) =>
  String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])

function writeNfo(file, root, fields) {
  const body = Object.entries(fields)
    .flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `  <${k}>${xml(x)}</${k}>`))
    .join('\n')
  fs.writeFileSync(
    file,
    `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<${root}>\n${body}\n</${root}>\n`
  )
}

// Everything the testbed creates, described once so tests know what to expect.
export const LONG = 310 // seconds: above Jellyfin's 300 s MinResumeDurationSeconds, so resume positions are kept
export const MEDIA = {
  movies: [
    'Test Movie (2020)', // 310 s mkv, 3 audio (aac / eac3 5.1 / aac), 3 embedded subs + side-car por.srt, poster+backdrop, nfo
    'Second Movie (2018)', // 12 s mp4, english subtitle only (auto-pt), no images
    'Hevc Movie (2019)', // 8 s mkv, hevc (not direct-playable)
    'Odd Layout (2022)', // 20 s mkv: sub, audio, audio(eac3), sub, attachment around the video (index check)
    'Cover Movie (2023)' // 10 s mp4 with an attached cover picture and two audio tracks
  ],
  series: ['Test Show (2015)', 'Short Show (2020)']
}

function generateMedia(mediaRoot, log) {
  const movies = path.join(mediaRoot, 'Movies')
  const shows = path.join(mediaRoot, 'Shows')
  const aac = (lang, title, extra = {}) => ({ kind: 'audio', lang, title, ...extra })

  // ---- movies
  {
    const dir = path.join(movies, 'Test Movie (2020)')
    const base = path.join(dir, 'Test Movie (2020)')
    makeMedia({
      file: base + '.mkv',
      seconds: LONG,
      layout: [
        { kind: 'video' },
        aac('jpn', 'Japanese', { default: true }),
        aac('eng', 'English 5.1', { codec: 'eac3', channels: 6, bitrate: '128k', freq: 880 }),
        aac('por', 'Brazilian', { freq: 660 }),
        { kind: 'sub', lang: 'eng', title: 'English', default: true },
        { kind: 'sub', lang: 'eng', title: 'Signs & Songs', forced: true },
        { kind: 'sub', lang: 'spa', title: 'Spanish' }
      ]
    })
    writeSrt(base + '.por.srt', cuesFor('Legenda externa', LONG))
    makeImage(path.join(dir, 'poster.jpg'), '400x600')
    makeImage(path.join(dir, 'backdrop.jpg'), '1280x720')
    writeNfo(base + '.nfo', 'movie', {
      title: 'Test Movie',
      year: 2020,
      premiered: '2020-05-01',
      plot: 'A generated movie used to test the Kaizen library backend.',
      genre: ['Drama', 'Science Fiction'],
      rating: '7.8',
      mpaa: 'PG-13'
    })
  }
  {
    const dir = path.join(movies, 'Second Movie (2018)')
    const base = path.join(dir, 'Second Movie (2018)')
    makeMedia({
      file: base + '.mp4',
      seconds: 12,
      layout: [
        { kind: 'video' },
        aac('eng', 'English', { default: true }),
        { kind: 'sub', lang: 'eng', title: 'English' }
      ]
    })
  }
  makeMedia({
    file: path.join(movies, 'Hevc Movie (2019)', 'Hevc Movie (2019).mkv'),
    seconds: 8,
    vcodec: 'libx265',
    layout: [{ kind: 'video' }, aac('eng', '', { default: true })]
  })
  makeMedia({
    file: path.join(movies, 'Odd Layout (2022)', 'Odd Layout (2022).mkv'),
    seconds: 20,
    layout: [
      { kind: 'sub', lang: 'eng', title: 'English' },
      { kind: 'video' },
      aac('jpn', 'Japanese', { default: true }),
      aac('eng', 'English', { codec: 'eac3', bitrate: '96k', freq: 880 }),
      { kind: 'sub', lang: 'por', title: 'Brazilian' },
      { kind: 'attachment' }
    ]
  })
  makeMedia({
    file: path.join(movies, 'Cover Movie (2023)', 'Cover Movie (2023).mp4'),
    seconds: 10,
    layout: [
      { kind: 'video' },
      aac('jpn', 'Japanese', { default: true }),
      aac('eng', 'English', { freq: 880 }),
      { kind: 'cover' },
      { kind: 'sub', lang: 'eng', title: 'English' }
    ]
  })

  // ---- Test Show (nfo + local images)
  {
    const show = path.join(shows, 'Test Show (2015)')
    makeImage(path.join(show, 'poster.jpg'), '400x600')
    makeImage(path.join(show, 'backdrop.jpg'), '1280x720')
    writeNfo(path.join(show, 'tvshow.nfo'), 'tvshow', {
      title: 'Test Show',
      year: 2015,
      premiered: '2015-01-01',
      plot: 'A generated show used to test the Kaizen library backend.',
      genre: ['Drama', 'Mystery'],
      rating: '8.4',
      mpaa: 'TV-14',
      status: 'Continuing'
    })
    const ep = (seasonDir, name, seconds, extra = {}) =>
      makeMedia({
        file: path.join(show, seasonDir, name + '.mkv'),
        seconds,
        layout: [
          { kind: 'video' },
          aac('jpn', 'Japanese', { default: true }),
          aac('eng', 'English', { freq: 880 }),
          { kind: 'sub', lang: 'eng', title: 'English', default: true },
          ...(extra.subs || [])
        ]
      })
    const nfo = (seasonDir, name, parts) => {
      const body = parts
        .map(
          (p) =>
            `<episodedetails>\n  <title>${xml(p.title)}</title>\n  <season>${p.season}</season>\n  <episode>${p.episode}</episode>\n  <plot>${xml(p.plot)}</plot>\n  <aired>${p.aired}</aired>\n</episodedetails>`
        )
        .join('\n')
      fs.writeFileSync(
        path.join(show, seasonDir, name + '.nfo'),
        `<?xml version="1.0" encoding="utf-8"?>\n${body}\n`
      )
    }
    ep('Season 01', 'Test Show S01E01', LONG)
    ep('Season 01', 'Test Show S01E02', LONG)
    ep('Season 01', 'Test Show S01E03-E04', 20)
    ep('Season 02', 'Test Show S02E01', 12)
    ep('Season 00', 'Test Show S00E01', 8)
    nfo('Season 01', 'Test Show S01E01', [
      { title: 'Pilot', season: 1, episode: 1, plot: 'The first episode.', aired: '2015-01-01' }
    ])
    nfo('Season 01', 'Test Show S01E02', [
      {
        title: 'Second Wind',
        season: 1,
        episode: 2,
        plot: 'The second episode.',
        aired: '2015-01-08'
      }
    ])
    nfo('Season 01', 'Test Show S01E03-E04', [
      { title: 'Double Feature', season: 1, episode: 3, plot: 'Part one.', aired: '2015-01-15' },
      { title: 'Double Feature 2', season: 1, episode: 4, plot: 'Part two.', aired: '2015-01-15' }
    ])
    nfo('Season 02', 'Test Show S02E01', [
      { title: 'Return', season: 2, episode: 1, plot: 'Season two begins.', aired: '2016-01-01' }
    ])
    nfo('Season 00', 'Test Show S00E01', [
      { title: 'Behind the Scenes', season: 0, episode: 1, plot: 'A special.', aired: '2015-12-25' }
    ])
    makeImage(path.join(show, 'Season 01', 'Test Show S01E01-thumb.jpg'), '640x360')
  }
  // ---- Short Show: no nfo, no images (fallbacks)
  for (const n of [1, 2]) {
    makeMedia({
      file: path.join(shows, 'Short Show (2020)', 'Season 01', `Short Show S01E0${n}.mp4`),
      seconds: 10,
      layout: [
        { kind: 'video' },
        aac('eng', 'English', { default: true }),
        { kind: 'sub', lang: 'eng', title: 'English' }
      ]
    })
  }
  log('media generated')
  return { movies, shows }
}

/* ------------------------------ jellyfin client (testbed only) ------------------------------ */

const AUTH_BASE =
  'MediaBrowser Client="KaizenTestbed", Device="Testbed", DeviceId="kaizen-testbed-0001", Version="1.0.0"'

export async function jf(baseUrl, method, route, { token, body, query, raw } = {}) {
  const url = new URL(baseUrl + route)
  for (const [k, v] of Object.entries(query || {})) {
    for (const x of Array.isArray(v) ? v : [v]) url.searchParams.append(k, String(x))
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: AUTH_BASE + (token ? `, Token="${token}"` : ''),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000)
  })
  if (raw) return res
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${route} -> HTTP ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

/* ------------------------------ processes / sockets ------------------------------ */

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

// sockets (tcp listeners and every udp socket) owned by one PID: [{ proto, local }]
function socketsOf(pid) {
  const r = spawnSync('netstat', ['-ano'], { windowsHide: true, encoding: 'utf8' })
  const out = []
  for (const line of (r.stdout || '').split(/\r?\n/)) {
    const p = line.trim().split(/\s+/)
    if (String(p[p.length - 1]) !== String(pid)) continue
    if (p[0] === 'TCP' && p[3] === 'LISTENING') out.push({ proto: 'tcp', local: p[1] })
    else if (p[0] === 'UDP') out.push({ proto: 'udp', local: p[1] })
  }
  return out
}
const isLoopback = (addr) => /^(127\.0\.0\.1|\[::1\]):\d+$/.test(addr)

function killPid(pid) {
  // the exact PID this script spawned (and the ffmpeg children Jellyfin started from it)
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
}

/* ------------------------------ the testbed ------------------------------ */

function networkXml(port) {
  return `<?xml version="1.0" encoding="utf-8"?>
<NetworkConfiguration xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <BaseUrl />
  <EnableHttps>false</EnableHttps>
  <RequireHttps>false</RequireHttps>
  <InternalHttpPort>${port}</InternalHttpPort>
  <InternalHttpsPort>${port + 1}</InternalHttpsPort>
  <PublicHttpPort>${port}</PublicHttpPort>
  <PublicHttpsPort>${port + 1}</PublicHttpsPort>
  <AutoDiscovery>false</AutoDiscovery>
  <EnableUPnP>false</EnableUPnP>
  <EnableIPv4>true</EnableIPv4>
  <EnableIPv6>false</EnableIPv6>
  <EnableRemoteAccess>true</EnableRemoteAccess>
  <LocalNetworkSubnets />
  <LocalNetworkAddresses>
    <string>127.0.0.1</string>
  </LocalNetworkAddresses>
  <KnownProxies />
  <IgnoreVirtualInterfaces>true</IgnoreVirtualInterfaces>
  <VirtualInterfaceNames>
    <string>veth</string>
  </VirtualInterfaceNames>
  <EnablePublishedServerUriByRequest>false</EnablePublishedServerUriByRequest>
  <PublishedServerUriBySubnet />
  <RemoteIPFilter />
  <IsRemoteIPFilterBlacklist>false</IsRemoteIPFilterBlacklist>
</NetworkConfiguration>
`
}

const libraryOptions = (dir) => ({
  Enabled: true,
  EnableRealtimeMonitor: false,
  EnableChapterImageExtraction: false,
  ExtractChapterImagesDuringLibraryScan: false,
  EnableTrickplayImageExtraction: false,
  ExtractTrickplayImagesDuringLibraryScan: false,
  SaveLocalMetadata: false,
  EnableInternetProviders: false,
  AutomaticRefreshIntervalDays: 0,
  PathInfos: [{ Path: dir }],
  MetadataSavers: [],
  DisabledSubtitleFetchers: [],
  SubtitleDownloadLanguages: [],
  TypeOptions: ['Movie', 'Series', 'Season', 'Episode'].map((Type) => ({
    Type,
    MetadataFetchers: [],
    MetadataFetcherOrder: [],
    ImageFetchers: [],
    ImageFetcherOrder: []
  }))
})

export async function startTestbed({
  parentDir = os.tmpdir(),
  cacheDir = null,
  port = 0,
  keep = false,
  log = (m) => process.stderr.write(`[testbed] ${m}\n`)
} = {}) {
  if (process.platform !== 'win32')
    throw new Error('the testbed downloads the Windows portable zip')
  if (!fs.existsSync(FFMPEG)) throw new Error(`vendor ffmpeg not found at ${FFMPEG}`)
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(parentDir, 'kaizen-jf-')))
  const dirs = Object.fromEntries(
    ['app', 'data', 'config', 'cache', 'log', 'media', 'work'].map((n) => [n, path.join(root, n)])
  )
  let child = null
  let stopped = false
  let adminToken = null
  const baseUrlHolder = { url: null }

  const stop = async () => {
    if (stopped) return
    stopped = true
    process.off('exit', syncCleanup)
    if (child && child.exitCode === null) {
      try {
        if (adminToken && baseUrlHolder.url) {
          await jf(baseUrlHolder.url, 'POST', '/System/Shutdown', { token: adminToken, raw: true })
          for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(250)
        }
      } catch {
        /* fall through to the hard stop */
      }
      if (child.exitCode === null) killPid(child.pid)
      for (let i = 0; i < 40 && child.exitCode === null; i++) await sleep(100)
    }
    if (!keep) {
      try {
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 })
      } catch (e) {
        log(`could not delete ${root}: ${e.message}`)
      }
    }
  }
  function syncCleanup() {
    if (child && child.exitCode === null) killPid(child.pid)
    if (!keep) {
      try {
        fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      } catch {
        /* nothing more we can do while exiting */
      }
    }
  }
  process.on('exit', syncCleanup)

  try {
    for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true })

    // 1. the server binaries
    const release = await latestRelease(log)
    const zip = await downloadZip(release, cacheDir || path.join(root, 'dl'), log)
    const exe = extractZip(zip, dirs.app)
    log(`extracted to ${dirs.app}`)

    // 2. media + network config (before the first start)
    const mediaDirs = generateMedia(dirs.media, log)
    const chosen = port || (await freePort())
    fs.writeFileSync(path.join(dirs.config, 'network.xml'), networkXml(chosen))
    const baseUrl = `http://127.0.0.1:${chosen}`
    baseUrlHolder.url = baseUrl

    // 3. start it
    const out = fs.openSync(path.join(dirs.log, 'stdout.txt'), 'a')
    child = spawn(
      exe,
      [
        '--datadir',
        dirs.data,
        '--configdir',
        dirs.config,
        '--cachedir',
        dirs.cache,
        '--logdir',
        dirs.log,
        '--ffmpeg',
        FFMPEG,
        '--nowebclient'
      ],
      { cwd: dirs.work, windowsHide: true, stdio: ['ignore', out, out] }
    )
    child.on('error', (e) => log(`jellyfin failed to start: ${e.message}`))
    log(`started jellyfin pid ${child.pid} on ${baseUrl}`)

    // 4. wait for the API; the bind addresses are checked as soon as the first socket shows up
    let info = null
    const deadline = Date.now() + 180000
    let checkedSockets = false
    while (Date.now() < deadline) {
      if (child.exitCode !== null)
        throw new Error(`jellyfin exited early with code ${child.exitCode} (see ${dirs.log})`)
      const socks = socketsOf(child.pid)
      const bad = socks.filter((s) => !isLoopback(s.local))
      if (bad.length) {
        throw new Error(
          `ABORT: jellyfin opened non-loopback sockets (${JSON.stringify(bad)}); a firewall prompt is possible`
        )
      }
      if (socks.length) checkedSockets = true
      try {
        const res = await fetch(baseUrl + '/System/Info/Public', {
          signal: AbortSignal.timeout(3000)
        })
        if (res.ok) {
          const body = await res.json()
          // while it migrates its database Jellyfin answers from a bare start-up server
          if (body && body.Version && body.StartupWizardCompleted !== undefined) {
            info = body
            break
          }
        }
      } catch {
        /* not up yet */
      }
      await sleep(250)
    }
    if (!info) throw new Error('jellyfin did not answer within 3 minutes')
    const socks = socketsOf(child.pid)
    log(`sockets of pid ${child.pid}: ${JSON.stringify(socks)}`)
    if (!checkedSockets || socks.some((s) => !isLoopback(s.local))) {
      throw new Error(`ABORT: jellyfin sockets are not loopback-only: ${JSON.stringify(socks)}`)
    }
    log(
      `server ${info.ServerName} ${info.Version} (wizard completed: ${info.StartupWizardCompleted})`
    )

    // 5. wizard
    if (!info.StartupWizardCompleted) {
      await jf(baseUrl, 'POST', '/Startup/Configuration', {
        body: {
          ServerName: 'Kaizen Testbed',
          UICulture: 'en-US',
          MetadataCountryCode: 'US',
          PreferredMetadataLanguage: 'en'
        }
      })
      await jf(baseUrl, 'GET', '/Startup/User')
      await jf(baseUrl, 'POST', '/Startup/User', {
        body: { Name: TESTBED_USER, Password: TESTBED_PASSWORD }
      })
      await jf(baseUrl, 'POST', '/Startup/RemoteAccess', { body: { EnableRemoteAccess: true } })
      await jf(baseUrl, 'POST', '/Startup/Complete')
    }
    const auth = await jf(baseUrl, 'POST', '/Users/AuthenticateByName', {
      body: { Username: TESTBED_USER, Pw: TESTBED_PASSWORD }
    })
    adminToken = auth.AccessToken
    const userId = auth.User.Id
    log('wizard done, admin authenticated')

    // 6. libraries over the generated media
    for (const [name, collectionType, dir] of [
      ['Movies', 'movies', mediaDirs.movies],
      ['Shows', 'tvshows', mediaDirs.shows]
    ]) {
      await jf(baseUrl, 'POST', '/Library/VirtualFolders', {
        token: adminToken,
        query: { name, collectionType, refreshLibrary: false, paths: [dir] },
        body: { LibraryOptions: libraryOptions(dir) }
      })
    }
    await jf(baseUrl, 'POST', '/Library/Refresh', { token: adminToken })

    // 7. wait for the scan: every movie / episode is there and has its media streams probed
    const expectedMovies = MEDIA.movies.length
    const expectedEpisodes = 7 // Test Show: S01E01 S01E02 S01E03-E04 (one item) S02E01 S00E01; Short Show: 2
    const scanDeadline = Date.now() + 300000
    let items = []
    while (Date.now() < scanDeadline) {
      const res = await jf(baseUrl, 'GET', '/Items', {
        token: adminToken,
        query: {
          userId,
          Recursive: true,
          IncludeItemTypes: ['Movie', 'Episode'],
          Fields: ['MediaSources']
        }
      })
      items = res.Items || []
      const probed = items.filter((i) => i.MediaSources?.[0]?.MediaStreams?.length)
      const movies = probed.filter((i) => i.Type === 'Movie').length
      const episodes = probed.filter((i) => i.Type === 'Episode').length
      // the double episode file shows up as ONE episode item (with IndexNumberEnd)
      if (movies >= expectedMovies && episodes >= expectedEpisodes) break
      await sleep(1000)
    }
    log(`scan finished: ${items.length} playable items`)

    return {
      baseUrl,
      user: TESTBED_USER,
      password: TESTBED_PASSWORD,
      userId,
      adminToken, // for the tests only (never printed by the CLI)
      version: info.Version,
      serverId: info.Id,
      pid: child.pid,
      root,
      dirs,
      mediaDirs,
      stop
    }
  } catch (error) {
    await stop()
    throw error
  }
}

/* ------------------------------ CLI ------------------------------ */

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name) => {
    const i = process.argv.indexOf(name)
    return i >= 0 ? process.argv[i + 1] : null
  }
  let bed = null
  let shuttingDown = false
  const shutdown = async (code) => {
    if (shuttingDown) return
    shuttingDown = true
    if (bed) await bed.stop()
    process.exit(code)
  }
  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))
  try {
    bed = await startTestbed({
      parentDir: arg('--root') || os.tmpdir(),
      cacheDir: arg('--cache'),
      port: Number(arg('--port')) || 0,
      keep: process.argv.includes('--keep')
    })
    process.stdout.write(
      JSON.stringify({
        baseUrl: bed.baseUrl,
        user: bed.user,
        password: bed.password,
        pid: bed.pid,
        version: bed.version,
        root: bed.root,
        media: bed.dirs.media
      }) + '\n'
    )
    if (process.argv.includes('--exit-on-stdin-close')) {
      process.stdin.resume()
      process.stdin.on('end', () => shutdown(0))
    }
    // Windows cannot deliver Ctrl-C to a background process: creating <root>/STOP also ends the run cleanly
    const stopFile = path.join(bed.root, 'STOP')
    setInterval(() => {
      if (fs.existsSync(stopFile)) shutdown(0)
    }, 1000)
  } catch (error) {
    process.stderr.write(`[testbed] FAILED: ${error.message}\n`)
    process.exit(1)
  }
}
