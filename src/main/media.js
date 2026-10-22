// Electron-free helpers shared by the torrent player and the local library: they turn ffprobe's JSON
// into the track lists the player menu shows, parse the WebVTT that ffmpeg produces, and judge
// whether the built-in (Chromium) player can play a file directly.

export const SUPPORTED_AUDIO = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'pcm_s16le', 'pcm_s24le']
export const TEXT_SUB_CODECS = ['ass', 'ssa', 'subrip', 'srt', 'webvtt', 'mov_text', 'text']
export const NOISE_TITLE = /sign|song|forced|commentary|sdh|dubtitle|closed|cc\b/i

// what ffprobe is asked for: the container, the video geometry and every track's codec / language
export const PROBE_ENTRIES =
  'format=duration,format_name:stream=index,codec_type,codec_name,profile,width,height,pix_fmt,channels:stream_tags=language,title:stream_disposition=default'

// Containers / codecs the Chromium inside Electron plays by itself. Everything else is flagged so
// the UI can explain it and offer an external player.
const DIRECT_CONTAINERS = ['matroska', 'webm', 'mov', 'mp4', 'ogg']
const DIRECT_VIDEO_CODECS = ['h264', 'vp8', 'vp9', 'av1']

// ffprobe JSON -> { duration, container, video, audio[], subtitles[], autoPtSource }
export function buildMediaInfo(probe) {
  const audio = []
  const subtitles = []
  let video = null
  for (const st of probe?.streams || []) {
    const base = {
      id: st.index,
      codec: st.codec_name,
      lang: st.tags?.language || 'und',
      title: st.tags?.title || '',
      default: !!st.disposition?.default
    }
    if (st.codec_type === 'video' && !video && !st.disposition?.attached_pic) {
      video = {
        id: st.index,
        codec: st.codec_name,
        profile: st.profile || '',
        width: st.width || 0,
        height: st.height || 0,
        pixFmt: st.pix_fmt || ''
      }
    } else if (st.codec_type === 'audio') {
      audio.push({ ...base, channels: st.channels, supported: SUPPORTED_AUDIO.includes(st.codec_name) })
    } else if (st.codec_type === 'subtitle') {
      subtitles.push({ ...base, text: TEXT_SUB_CODECS.includes(st.codec_name) })
    }
  }
  return {
    duration: Number(probe?.format?.duration) || 0,
    container: probe?.format?.format_name || '',
    video,
    audio,
    subtitles,
    autoPtSource: pickAutoPtSource(subtitles)
  }
}

export const isPortugueseTrack = (t) => /^(por|pob|pt|pt-br|ptbr)$/i.test(t.lang) || /portugu|brazil/i.test(t.title)

// The English dialogue track that the automatic Portuguese translation is made from; null when the
// file already has a Brazilian Portuguese text track (then no translation is offered).
export function pickAutoPtSource(subtitles) {
  const text = subtitles.filter((t) => t.text)
  const en = text.filter((t) => /^(eng|en)$/i.test(t.lang) || /english/i.test(t.title))
  const source = (en.find((t) => !NOISE_TITLE.test(t.title)) || en[0] || null)?.id ?? null
  const hasBrazilian = text.some((t) => isPortugueseTrack(t) && !/europ|portugal/i.test(t.title))
  return hasBrazilian ? null : source
}

// { supported: boolean, reason: null | 'container' | 'video-codec' | 'bit-depth' | 'no-video' }
export function assessDirectPlay(info) {
  const v = info?.video
  if (!v) return { supported: false, reason: 'no-video' }
  const formats = String(info.container || '').split(',')
  if (!formats.some((f) => DIRECT_CONTAINERS.includes(f))) return { supported: false, reason: 'container' }
  if (!DIRECT_VIDEO_CODECS.includes(v.codec)) return { supported: false, reason: 'video-codec' }
  // Chromium's software H.264 decoder only handles 8-bit (High 10 and up do not play)
  if (v.codec === 'h264' && /10|12/.test(v.pixFmt) && !/^yuv4(20|22|44)p$/.test(v.pixFmt)) {
    return { supported: false, reason: 'bit-depth' }
  }
  return { supported: true, reason: null }
}

/* ------------------------------ WebVTT ------------------------------ */

export function parseVttTime(t) {
  const [h, m, rest] = t.trim().split(':').length === 3 ? t.trim().split(':') : ['0', ...t.trim().split(':')]
  return Number(h) * 3600 + Number(m) * 60 + Number(rest)
}

// "A\nB\nA\nB" -> "A\nB" (ASS files often stack the same line several times)
export function collapseRepeats(text) {
  const lines = text.split('\n')
  for (let p = 1; p <= lines.length / 2; p++) {
    if (lines.length % p === 0 && lines.every((l, i) => l === lines[i % p])) {
      return lines.slice(0, p).join('\n')
    }
  }
  return text
}

// WebVTT text -> [{ s, e, t }] in seconds, tags stripped, identical stacked cues merged
export function parseVtt(vtt) {
  const cues = []
  const seen = new Set()
  for (const block of vtt.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n')
    const i = lines.findIndex((l) => l.includes('-->'))
    if (i === -1) continue
    const [a, b] = lines[i].split('-->')
    const t = collapseRepeats(
      lines
        .slice(i + 1)
        .join('\n')
        .replace(/\{[^}]*\}/g, '')
        .replace(/<[^>]+>/g, '')
        .trim()
    )
    if (!t) continue
    const cue = { s: parseVttTime(a), e: parseVttTime(b.trim().split(' ')[0]), t }
    const key = `${cue.s}|${cue.e}|${cue.t}` // identical duplicate events (layers) -> keep one
    if (seen.has(key)) continue
    seen.add(key)
    cues.push(cue)
  }
  return cues
}

// float jitter would defeat de-duplication on the client
export const roundMs = (x) => Math.round(x * 1000) / 1000
