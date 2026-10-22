// Audio / subtitle tracks for the player menu (TracksMenu): the same JSON as the torrent routes, built
// from what Jellyfin already knows (no ffprobe on a remote file).
//
//   mediainfo  the mapped MediaStreams of the item
//   subtitles  one whole track fetched from Jellyfin as WebVTT (cached), sliced in time windows;
//              'auto-pt' = the English dialogue track machine-translated to Portuguese
//   audio      ffmpeg transcodes one audio stream to AAC (ADTS), reading the file through OUR stream
//              proxy so the Jellyfin token never appears on a command line
import { spawn as nodeSpawn } from 'child_process'
import { parseVtt, roundMs } from '../media.js'
import { httpInputArgs } from '../tools.js'
import { ApiError, redact, sendError } from './errors.js'
import { createCache, createLimiter, createSingleFlight } from './cache.js'

const TRACK_TTL_MS = 30 * 60 * 1000
const MAX_CONCURRENT_AUDIO = 4
const FIRST_BYTE_TIMEOUT_MS = 60 * 1000

export function createTracks({
  service,
  ffmpegPath,
  getBackendPort,
  getToken,
  translateCues = null,
  spawn = nodeSpawn,
  maxAudio = MAX_CONCURRENT_AUDIO,
  firstByteTimeoutMs = FIRST_BYTE_TIMEOUT_MS,
  log = () => {}
}) {
  const trackCache = createCache({ max: 40, ttlMs: TRACK_TTL_MS }) // `${id}|${index}` -> cues[]
  const trackFlight = createSingleFlight()
  const windowCache = createCache({ max: 300, ttlMs: TRACK_TTL_MS }) // translated windows
  const windowFlight = createSingleFlight()
  const audioLimiter = createLimiter(maxAudio)
  const procs = new Set()

  /* ---------------- mediainfo ---------------- */

  async function mediainfo(id) {
    const meta = await service.getItemMeta(id)
    return meta.info
  }

  /* ---------------- subtitles ---------------- */

  function loadTrack(id, mediaSourceId, index) {
    const key = `${id}|${index}`
    const hit = trackCache.get(key)
    if (hit) return Promise.resolve(hit)
    return trackFlight.run(key, async () => {
      const vtt = await service.withClient((c) => c.subtitleVtt(id, mediaSourceId, index))
      const cues = parseVtt(vtt).sort((a, b) => a.s - b.s)
      trackCache.set(key, cues)
      return cues
    })
  }

  // track: 'auto-pt' | a stream index (number); -> { from, len, source, cues }
  async function subtitles(id, { track, from, len }) {
    const meta = await service.getItemMeta(id)
    const { info } = meta
    const auto = track === 'auto-pt'
    const index = auto ? info.autoPtSource : track
    if (index === null || index === undefined)
      throw new ApiError('NOT_FOUND', 'no source track for the automatic translation')
    const stream = info.subtitles.find((s) => s.id === index)
    if (!stream) throw new ApiError('NOT_FOUND', 'no such subtitle track')
    if (!stream.text)
      throw new ApiError('NOT_FOUND', 'image-based subtitles cannot be converted to text')

    const all = await loadTrack(id, meta.mediaSourceId || id, index)
    const end = from + len
    const window = all
      .filter((c) => c.e >= from && c.s <= end)
      .map((c) => ({ s: roundMs(c.s), e: roundMs(c.e), t: c.t }))
    if (!auto) return { from, len, source: 'native', cues: window }

    if (window.length === 0) return { from, len, source: 'translated', cues: [] }
    const key = `${id}|${index}|${from}|${len}`
    let translated = windowCache.get(key)
    if (!translated) {
      translated = await windowFlight.run(key, async () => {
        if (typeof translateCues !== 'function') return { cues: window, failed: true }
        const result = await translateCues(window)
        // a failed translation is answered (original text) but not remembered: the next window retries
        if (!result.failed) windowCache.set(key, result)
        return result
      })
    }
    return {
      from,
      len,
      source: translated.failed ? 'translation_failed' : 'translated',
      cues: translated.cues
    }
  }

  /* ---------------- audio ---------------- */

  // a slot frees up within moments when the player seeks (the old conversion is being killed)
  async function acquireSlot(res) {
    for (let waited = 0; ; waited += 100) {
      const release = audioLimiter.tryAcquire()
      if (release || waited >= 2000 || res.destroyed) return release
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  // GET /library/audio/:id -> audio/aac. Errors before the first byte are JSON; after it the connection is cut.
  async function audio(req, res, id, { track, start }) {
    const meta = await service.getItemMeta(id)
    const ordinal = meta.audioOrdinals.get(track)
    if (ordinal === undefined) throw new ApiError('NOT_FOUND', 'no such audio track')
    const release = await acquireSlot(res)
    if (res.destroyed) {
      release?.() // the player gave up while it waited
      return
    }
    if (!release)
      throw new ApiError('BUSY', 'too many audio conversions at once', {
        headers: { 'Retry-After': '2' }
      })

    const url = `http://127.0.0.1:${getBackendPort()}/library/stream/${id}?t=${getToken()}`
    const args = [
      '-v',
      'error',
      ...httpInputArgs(url),
      '-ss',
      String(start),
      '-i',
      url,
      // "the Nth audio stream": Jellyfin's stream `Index` and ffmpeg's index differ when the item has side-car subtitles
      '-map',
      `0:a:${ordinal}`,
      '-vn',
      '-sn',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ac',
      '2',
      '-f',
      'adts',
      'pipe:1'
    ]
    let ff
    try {
      ff = spawn(ffmpegPath, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      release()
      log(`library audio: cannot start ffmpeg (${error.message})`)
      throw new ApiError('INTERNAL', 'cannot start ffmpeg')
    }
    procs.add(ff)

    let sent = false
    let finished = false
    let stderr = ''
    const kill = () => {
      if (ff.exitCode === null && !ff.killed) ff.kill()
    }
    const firstByteTimer = setTimeout(() => {
      kill()
      if (!sent) sendError(res, new ApiError('UPSTREAM_ERROR', 'timed out preparing the audio'))
    }, firstByteTimeoutMs)

    ff.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-1500)
    })
    ff.on('error', (error) => {
      log(`library audio: ffmpeg error (${error.message})`)
      clearTimeout(firstByteTimer)
      if (!sent) sendError(res, new ApiError('INTERNAL', 'cannot run ffmpeg'))
    })
    ff.on('close', (code) => {
      finished = true
      clearTimeout(firstByteTimer)
      procs.delete(ff)
      release()
      if (code && !res.destroyed)
        log(`library audio: ffmpeg exited ${code}: ${redact(stderr.trim())}`)
      if (!sent) {
        if (!res.destroyed)
          sendError(res, new ApiError('UPSTREAM_ERROR', 'the audio track could not be converted'))
      } else if (!res.writableEnded) {
        res.end()
      }
    })
    // seek / pause / player closed: stop converting at once
    res.on('close', () => {
      if (!finished) kill()
    })

    ff.stdout.once('data', (first) => {
      clearTimeout(firstByteTimer)
      if (res.destroyed) return
      sent = true
      res.writeHead(200, {
        'Content-Type': 'audio/aac',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      })
      res.write(first)
      ff.stdout.pipe(res, { end: false })
    })
  }

  return {
    mediainfo,
    subtitles,
    audio,
    get activeAudio() {
      return audioLimiter.active
    },
    get processes() {
      return procs
    },
    clear() {
      trackCache.clear()
      trackFlight.clear()
      windowCache.clear()
      windowFlight.clear()
    },
    // kills every running conversion (app shutdown)
    shutdown() {
      for (const ff of procs) if (ff.exitCode === null) ff.kill()
    }
  }
}
