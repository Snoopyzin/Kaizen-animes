import axios from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { t, getLanguage } from '../i18n'

// Netflix-style "Áudio e legendas" for the Plyr player.
//  - every audio / subtitle track of the episode can be picked
//  - subtitles are fetched lazily, a time range at a time, following the playhead
//  - if the release has no Brazilian Portuguese subtitles, the English ones are translated
//  - audio the browser can't decode (E-AC3, DTS...) or alternative audio tracks are transcoded to
//    AAC by the backend and played by a hidden <audio> element kept in sync with the video

const PREF_AUDIO = 'kaizen-pref-audio'
const PREF_SUB = 'kaizen-pref-sub'

const read = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}
const write = (key, value) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

/* ------------------------------ labels ------------------------------ */

// ISO 639-2/B codes (used by mkv) -> the /T codes Intl understands
const BIBLIO = {
  baq: 'eus', fre: 'fra', ger: 'deu', gre: 'ell', rum: 'ron', dut: 'nld', may: 'msa', cze: 'ces',
  chi: 'zho', per: 'fas', slo: 'slk', wel: 'cym', ice: 'isl', arm: 'hye', geo: 'kat', mac: 'mkd',
  mao: 'mri', bur: 'mya', tib: 'bod', alb: 'sqi'
}
const TITLE_MAP = {
  brazilian: t('tracksMenu.titleBrazilian'),
  european: t('tracksMenu.titleEuropean'),
  'latin american': t('tracksMenu.titleLatinAmerican'),
  dubtitle: t('tracksMenu.titleDubtitle'),
  sdh: 'SDH'
}
const INTL_LOCALE = getLanguage() === 'en' ? 'en' : 'pt-BR'
let displayNames
function langName(code) {
  try {
    displayNames ??= new Intl.DisplayNames([INTL_LOCALE], { type: 'language' })
    const name = displayNames.of(BIBLIO[code] || code)
    if (name && name !== code) return name[0].toUpperCase() + name.slice(1)
  } catch {
    /* fall through */
  }
  return code === 'und' ? t('tracksMenu.unknown') : code
}
function trackLabel(track) {
  const base = langName(track.lang)
  const extra = TITLE_MAP[track.title.toLowerCase()] ?? track.title
  return extra ? `${base} (${extra})` : base
}

/* ------------------------------ defaults ------------------------------ */

const isPortuguese = (t) => /^(por|pob|pt|pt-br|ptbr)$/i.test(t.lang) || /portugu|brazil/i.test(t.title)
const isNoise = (t) => /sign|song|forced|commentary|sdh|dubtitle|closed/i.test(t.title)

function pickAudio(info) {
  const pref = read(PREF_AUDIO, null)
  const usable = info.audio.filter((a) => !/commentary/i.test(a.title))
  return (
    (pref && usable.find((a) => a.lang === pref)) ||
    info.audio.find((a) => a.default) ||
    info.audio[0] ||
    null
  )
}

function pickSubtitle(info) {
  const pref = read(PREF_SUB, 'por')
  if (pref === 'off') return 'off'
  const text = info.subtitles.filter((s) => s.text)
  if (pref === 'por') {
    const pt = text.filter(isPortuguese)
    const brazilian = pt.find((s) => !/europ|portugal/i.test(s.title) && !isNoise(s))
    if (brazilian) return brazilian.id
    if (info.autoPtSource !== null) return 'auto-pt'
    return (pt[0] || null)?.id ?? 'off'
  }
  const match = text.filter((s) => s.lang === pref)
  return (match.find((s) => !isNoise(s)) || match[0] || null)?.id ?? 'off'
}

/* ------------------------------ component ------------------------------ */

const FIRST_LEN = 90 // seconds fetched on the first request after (re)positioning
const NEXT_LEN = 240

// A <video> can be wrapped by ONE MediaElementAudioSourceNode for its whole life (a second
// createMediaElementSource throws InvalidStateError), so the node is created once per element and
// reused: wired to the speakers = the video's own sound, disconnected = silent. All elements share
// one AudioContext (browsers cap how many can be open).
let sharedAudioCtx = null
const silencers = new WeakMap()
function getSilencer(media) {
  let node = silencers.get(media)
  if (!node) {
    if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') sharedAudioCtx = new AudioContext()
    node = { ctx: sharedAudioCtx, source: sharedAudioCtx.createMediaElementSource(media) }
    silencers.set(media, node)
  }
  return node
}

// url + extra query parameters, whether or not the url already has a query string
const withQuery = (url, params) =>
  url + (url.includes('?') ? '&' : '?') + new URLSearchParams(params).toString()

// Props:
//  plyrRef    ref of the <Plyr> element the menu belongs to
//  streamUrl  address of the video; identifies the episode (a change resets the menu)
//  buildUrl   optional (kind) => url for 'mediainfo' | 'subtitles' | 'audio'. Used by the local
//             library, whose endpoints are not derived from the torrent stream address. It may be
//             a new function on every render: only streamUrl decides when the menu reloads.
//  storageKey optional stable id for per-episode settings (the subtitle delay); defaults to the
//             last path segment of streamUrl
export default function TracksMenu({ plyrRef, streamUrl, buildUrl, storageKey }) {
  const buildUrlRef = useRef(buildUrl)
  buildUrlRef.current = buildUrl
  const api = useCallback(
    (kind) =>
      buildUrlRef.current ? buildUrlRef.current(kind) : streamUrl.replace('/streamfile/', `/${kind}/`),
    [streamUrl]
  )

  const [info, setInfo] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [audioId, setAudioId] = useState(null)
  const [subId, setSubId] = useState('off') // 'off' | stream index | 'auto-pt'
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState(null)
  const [showButton, setShowButton] = useState(true)
  const [subNote, setSubNote] = useState('')

  const subRef = useRef('off')
  subRef.current = subId

  // manual subtitle sync (seconds; positive = subtitles appear later), remembered per episode file
  const delayKey =
    'kaizen-sub-delay:' + (storageKey || decodeURIComponent(streamUrl.split('/').pop() || ''))
  const [delay, setDelay] = useState(() => Number(read(delayKey, '0')) || 0)
  const delayRef = useRef(delay)
  delayRef.current = delay
  useEffect(() => {
    setDelay(Number(read(delayKey, '0')) || 0)
  }, [delayKey])
  const changeDelay = (step) => {
    const next = step === 0 ? 0 : Math.max(-30, Math.min(30, Math.round((delay + step) * 10) / 10))
    setDelay(next)
    write(delayKey, String(next))
  }
  const store = useRef({ cues: new Map(), ranges: new Map(), inflight: new Set(), failedAt: new Map() })

  /* ---- track list ---- */
  useEffect(() => {
    let cancelled = false
    setInfo(null)
    setStatus('loading')
    setOpen(false)
    store.current = { cues: new Map(), ranges: new Map(), inflight: new Set(), failedAt: new Map() }
    axios
      .get(api('mediainfo'), { timeout: 0 })
      .then(({ data }) => {
        if (cancelled) return
        setInfo(data)
        setAudioId(pickAudio(data)?.id ?? null)
        setSubId(pickSubtitle(data))
        setStatus('ready')
      })
      .catch((error) => {
        console.error('Erro ao carregar faixas', error)
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [api])

  /* ---- wait for the Plyr container ---- */
  useEffect(() => {
    let timer
    let tries = 0
    const find = () => {
      const el = plyrRef.current?.plyr?.elements?.container
      if (el) setContainer(el)
      else if (tries++ < 60) timer = setTimeout(find, 200)
    }
    find()
    return () => clearTimeout(timer)
  }, [plyrRef, streamUrl])

  /* ---- floating button visibility (follows the mouse like Plyr's controls) ---- */
  useEffect(() => {
    if (!container) return
    let hideTimer
    const wake = () => {
      setShowButton(true)
      clearTimeout(hideTimer)
      hideTimer = setTimeout(() => setShowButton(false), 3000)
    }
    container.addEventListener('mousemove', wake)
    container.addEventListener('click', wake)
    wake()
    return () => {
      clearTimeout(hideTimer)
      container.removeEventListener('mousemove', wake)
      container.removeEventListener('click', wake)
    }
  }, [container])

  /* ---- subtitles: fetch ahead + draw overlay ---- */
  const fetchRange = useCallback(
    (trackKey, from, len) => {
      const s = store.current
      const id = `${trackKey}|${from}`
      if (s.inflight.has(id)) return
      if (Date.now() - (s.failedAt.get(id) || 0) < 5000) return
      s.inflight.add(id)
      axios
        .get(api('subtitles'), { params: { track: trackKey, from, len }, timeout: 0 })
        .then(({ data }) => {
          const known = s.cues.get(trackKey) || []
          const key = (c) => `${Math.round(c.s * 10)}|${c.t}` // tolerate tiny timing differences
          const seen = new Set(known.map(key))
          const merged = [...known, ...data.cues.filter((c) => !seen.has(key(c)))]
          merged.sort((a, b) => a.s - b.s)
          s.cues.set(trackKey, merged)
          s.ranges.set(trackKey, [...(s.ranges.get(trackKey) || []), [from, from + len]])
          if (trackKey === String(subRef.current)) {
            setSubNote(
              data.source === 'translated'
                ? t('tracksMenu.noteTranslated')
                : data.source === 'translation_failed'
                  ? t('tracksMenu.noteTranslationFailed')
                  : ''
            )
          }
        })
        .catch((error) => {
          console.error('Erro ao carregar legenda', error)
          s.failedAt.set(id, Date.now())
        })
        .finally(() => s.inflight.delete(id))
    },
    [api]
  )

  useEffect(() => {
    const player = plyrRef.current?.plyr
    if (!container || !player || typeof player.on !== 'function') return
    const overlay = document.createElement('div')
    overlay.style.cssText =
      'position:absolute;left:5%;right:5%;bottom:64px;text-align:center;pointer-events:none;z-index:5;' +
      'color:#fff;font-size:1.4em;line-height:1.3;white-space:pre-line;' +
      'text-shadow:0 0 4px #000,0 0 4px #000,1px 1px 3px #000;font-weight:600;'
    container.appendChild(overlay)

    const onTime = () => {
      const t = player.currentTime || 0
      const trackKey = String(subRef.current)
      if (trackKey === 'off') {
        overlay.textContent = ''
        return
      }
      // make sure the next stretch of subtitles is on its way
      const ranges = store.current.ranges.get(trackKey) || []
      const covering = ranges.filter(([a, b]) => t >= a && t < b).sort((x, y) => y[1] - x[1])[0]
      if (!covering) fetchRange(trackKey, Math.max(0, Math.floor(t) - 10), FIRST_LEN)
      else if (covering[1] - t < 45) fetchRange(trackKey, Math.floor(covering[1]), NEXT_LEN)

      // several overlapping cues can carry the same text (stacked ASS layers): show each once
      const text = [
        ...new Set(
          (store.current.cues.get(trackKey) || [])
            .filter((c) => t - delayRef.current >= c.s && t - delayRef.current <= c.e)
            .map((c) => c.t)
        )
      ].join('\n')
      if (overlay.textContent !== text) overlay.textContent = text
    }
    player.on('timeupdate', onTime)
    onTime()
    return () => {
      player.off('timeupdate', onTime)
      overlay.remove()
    }
  }, [container, plyrRef, fetchRange, subId, info])

  /* ---- external audio (transcoded AAC kept in sync with the video) ---- */
  const audioTrack = info?.audio.find((a) => a.id === audioId) || null
  const useExternal = !!info && info.audio.length > 0 && (info.audio.length > 1 || !info.audio[0].supported)
  const videoHasOwnSound = !!info?.audio[0]?.supported // otherwise the browser plays the video silent

  useEffect(() => {
    const player = plyrRef.current?.plyr
    const media = player?.media
    if (!container || !media || !useExternal || audioId === null) return

    // silence the video's own sound without touching Plyr's volume/mute UI
    let graph
    if (videoHasOwnSound) {
      try {
        graph = getSilencer(media)
        graph.source.disconnect() // not wired to the speakers: only the external audio is heard
        graph.ctx.resume()
      } catch (error) {
        console.error('Não foi possível silenciar o áudio original', error)
      }
    }

    const audio = new Audio()
    audio.preload = 'auto'
    let offset = 0 // video time at which the current audio stream starts
    let loading = false
    let disposed = false

    const syncVolume = () => {
      audio.volume = media.muted ? 0 : Math.min(1, Math.max(0, media.volume))
    }

    const restart = (t) => {
      loading = true
      const resume = !media.paused
      if (resume) media.pause()
      audio.pause()
      offset = t
      audio.src = withQuery(api('audio'), { track: audioId, start: t })
      audio.playbackRate = media.playbackRate || 1
      syncVolume()
      const ready = () => {
        audio.removeEventListener('canplay', ready)
        if (disposed) return
        loading = false
        if (resume || !media.paused) {
          media.play().catch(() => {})
          audio.play().catch(() => {})
        }
      }
      audio.addEventListener('canplay', ready)
      audio.load()
    }

    const onPlay = () => !loading && audio.paused && audio.play().catch(() => {})
    const onPause = () => !loading && audio.pause()
    const onSeeking = () => audio.pause()
    const onSeeked = () => restart(media.currentTime)
    const onWaiting = () => !loading && audio.pause()
    const onPlaying = () => !loading && audio.paused && audio.play().catch(() => {})
    const onRate = () => (audio.playbackRate = media.playbackRate || 1)
    const onTime = () => {
      if (loading || media.paused || media.seeking) return
      const drift = offset + audio.currentTime - media.currentTime // > 0: audio ahead of the video
      if (Math.abs(drift) > 0.6) {
        restart(media.currentTime)
        return
      }
      // small drift: nudge the audio speed (max 6 %) until it lines up again
      const base = media.playbackRate || 1
      const nudge = Math.abs(drift) > 0.08 ? Math.max(-0.06, Math.min(0.06, -drift * 0.3)) : 0
      audio.playbackRate = base * (1 + nudge)
    }

    const events = {
      play: onPlay, pause: onPause, seeking: onSeeking, seeked: onSeeked, waiting: onWaiting,
      playing: onPlaying, ratechange: onRate, volumechange: syncVolume, timeupdate: onTime
    }
    for (const [name, fn] of Object.entries(events)) media.addEventListener(name, fn)
    restart(media.currentTime || 0)

    return () => {
      disposed = true
      for (const [name, fn] of Object.entries(events)) media.removeEventListener(name, fn)
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      // give the video its own sound back
      if (graph) {
        try {
          graph.source.connect(graph.ctx.destination)
        } catch {
          /* ignore */
        }
      }
    }
  }, [container, plyrRef, api, audioId, useExternal, videoHasOwnSound])

  /* ---- choices ---- */
  const chooseAudio = (track) => {
    setAudioId(track.id)
    write(PREF_AUDIO, track.lang)
  }
  const chooseSub = (value) => {
    setSubId(value)
    setSubNote('')
    if (value === 'off') write(PREF_SUB, 'off')
    else if (value === 'auto-pt') write(PREF_SUB, 'por')
    else write(PREF_SUB, info.subtitles.find((s) => s.id === value)?.lang || 'por')
  }

  /* ---- UI ---- */
  const subtitleOptions = []
  if (info) {
    if (info.autoPtSource !== null)
      subtitleOptions.push({ value: 'auto-pt', label: t('tracksMenu.autoPt') })
    const rank = (t) => (isPortuguese(t) ? 0 : /^(eng|en)$/i.test(t.lang) ? 1 : /^(jpn|ja)$/i.test(t.lang) ? 2 : 3)
    const seen = new Set()
    info.subtitles
      .filter((s) => s.text)
      .sort((a, b) => rank(a) - rank(b) || langName(a.lang).localeCompare(langName(b.lang), INTL_LOCALE))
      .forEach((s) => {
        const label = trackLabel(s)
        if (seen.has(label)) return
        seen.add(label)
        subtitleOptions.push({ value: s.id, label })
      })
  }

  const Item = ({ active, onClick, children }) => (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-x-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-white/10 ${
        active ? 'text-white' : 'text-gray-400'
      }`}
    >
      <span className="w-4 text-purple-400">{active ? '✓' : ''}</span>
      {children}
    </button>
  )

  const panel = open && info && (
    <div
      className="absolute right-3 top-14 z-20 flex max-h-[75%] w-[min(34rem,90%)] flex-col overflow-hidden rounded-md border border-gray-700 bg-black/90 font-space-mono text-white shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="w-1/2 overflow-y-auto border-r border-gray-700 py-2">
        <p className="px-3 pb-1 text-xs uppercase tracking-wide text-gray-500">{t('tracksMenu.audio')}</p>
        {info.audio.length === 0 && <p className="px-3 text-sm text-gray-500">{t('tracksMenu.noTracks')}</p>}
        {info.audio.map((a) => (
          <Item key={a.id} active={audioId === a.id} onClick={() => chooseAudio(a)}>
            {trackLabel(a)}
            {a.channels > 2 ? <span className="text-xs text-gray-500">{a.channels === 6 ? '5.1' : `${a.channels}ch`}</span> : null}
          </Item>
        ))}
      </div>
      <div className="w-1/2 overflow-y-auto py-2">
        <p className="px-3 pb-1 text-xs uppercase tracking-wide text-gray-500">{t('tracksMenu.subtitles')}</p>
        <Item active={subId === 'off'} onClick={() => chooseSub('off')}>
          {t('tracksMenu.off')}
        </Item>
        {subtitleOptions.map((o) => (
          <Item key={o.value} active={subId === o.value} onClick={() => chooseSub(o.value)}>
            {o.label}
          </Item>
        ))}
      </div>
      </div>
      {subId !== 'off' && (
        <div className="flex items-center justify-between gap-x-2 border-t border-gray-700 px-3 py-2 text-xs">
          <span className="text-gray-400">{t('tracksMenu.syncTitle')}</span>
          <span className="flex items-center gap-x-1">
            <button className="rounded border border-gray-700 px-2 py-1 hover:border-purple-400" onClick={() => changeDelay(-0.5)}>
              {t('tracksMenu.syncEarlier')}
            </button>
            <span className="w-14 text-center text-purple-300">
              {t('tracksMenu.syncValue', { value: `${delay > 0 ? '+' : ''}${delay.toFixed(1)}` })}
            </span>
            <button className="rounded border border-gray-700 px-2 py-1 hover:border-purple-400" onClick={() => changeDelay(0.5)}>
              {t('tracksMenu.syncLater')}
            </button>
            <button className="rounded border border-gray-700 px-2 py-1 text-gray-400 hover:border-purple-400" onClick={() => changeDelay(0)}>
              {t('tracksMenu.syncReset')}
            </button>
          </span>
        </div>
      )}
    </div>
  )

  const floating =
    container &&
    createPortal(
      <>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          className={`absolute right-3 top-3 z-20 rounded-md border border-gray-600 bg-black/70 px-3 py-1.5 font-space-mono text-xs text-white transition-opacity hover:border-purple-400 ${
            showButton || open ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {t('tracksMenu.button')}
        </button>
        {panel}
      </>,
      container
    )

  let note = ''
  if (status === 'loading') note = t('tracksMenu.loading')
  else if (status === 'error') note = t('tracksMenu.error')
  else if (info && info.subtitles.filter((s) => s.text).length === 0 && !info.autoPtSource)
    note = t('tracksMenu.noSubtitles')
  else if (subNote) note = subNote

  return (
    <div className="mt-2 flex flex-col items-center gap-y-1 font-space-mono text-xs">
      {floating}
      <div className="flex items-center gap-x-3 opacity-80">
        <button
          disabled={status !== 'ready'}
          onClick={() => setOpen((v) => !v)}
          className="rounded border border-gray-700 px-2 py-1 transition-all hover:border-purple-400 disabled:opacity-40"
        >
          {t('tracksMenu.button')}
        </button>
        {audioTrack && <span>{t('tracksMenu.audioCurrent', { value: trackLabel(audioTrack) })}</span>}
        <span>
          {t('tracksMenu.subtitleCurrent', {
            value:
              subId === 'off'
                ? t('tracksMenu.offLower')
                : subtitleOptions.find((o) => o.value === subId)?.label || '…'
          })}
        </span>
      </div>
      {note && <p className="opacity-60">{note}</p>}
    </div>
  )
}
