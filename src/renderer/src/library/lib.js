// Pure helpers of the library ("Biblioteca") UI.
// NO imports on purpose (no React, no i18n, no app modules): everything here runs in plain Node, is
// covered by test/library/ui-lib.test.mjs, and never produces a user-facing sentence by itself -
// the components compose the words with t() and only ask these helpers for numbers and shapes.

export const DEFAULT_PORT = 64621

/* ------------------------------ identifiers ------------------------------ */

export const ID_RE = /^[a-f0-9]{32}$/

// Jellyfin ids are GUIDs: lower-case 32 hex chars without dashes everywhere. '' when invalid.
export function normalizeId(id) {
  const value = String(id ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '')
  return ID_RE.test(value) ? value : ''
}

export const isValidId = (id) => normalizeId(id) !== ''

export function kindOf(item) {
  const key = typeof item?.key === 'string' ? item.key : ''
  if (key.startsWith('s:')) return 'series'
  if (key.startsWith('m:')) return 'movie'
  return item && item.seasons !== undefined ? 'series' : 'movie'
}

/* ------------------------------ text, search ------------------------------ */

// "Ação  Ríspida" -> "acao rispida"
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const haystacks = new WeakMap()
function haystack(item) {
  let cached = haystacks.get(item)
  if (cached === undefined) {
    cached = normalizeText(`${item?.title ?? ''} ${item?.year ?? ''}`)
    haystacks.set(item, cached)
  }
  return cached
}

export function matchesQuery(item, query) {
  const tokens = normalizeText(query).split(' ').filter(Boolean)
  if (tokens.length === 0) return true
  const text = haystack(item)
  return tokens.every((token) => text.includes(token))
}

/* ------------------------------ catalog: filter, sort ------------------------------ */

export const FILTERS = ['all', 'movies', 'series', 'favorites']
export const SORTS = ['added', 'title', 'year', 'rating']

export const isFilter = (value) => FILTERS.includes(value)
export const isSort = (value) => SORTS.includes(value)

// movies + series of the index as one list (order is decided by sortItems)
export function catalogOf(index) {
  const movies = Array.isArray(index?.movies) ? index.movies : []
  const series = Array.isArray(index?.series) ? index.series : []
  return [...movies, ...series]
}

export function filterItems(items, { filter = 'all', query = '' } = {}) {
  const list = Array.isArray(items) ? items : []
  return list.filter((item) => {
    if (!item) return false
    if (filter === 'movies' && kindOf(item) !== 'movie') return false
    if (filter === 'series' && kindOf(item) !== 'series') return false
    if (filter === 'favorites' && item.favorite !== true) return false
    return matchesQuery(item, query)
  })
}

export function countByFilter(items) {
  const counts = { all: 0, movies: 0, series: 0, favorites: 0 }
  for (const item of Array.isArray(items) ? items : []) {
    if (!item) continue
    counts.all++
    if (kindOf(item) === 'series') counts.series++
    else counts.movies++
    if (item.favorite === true) counts.favorites++
  }
  return counts
}

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })
const byTitle = (a, b) =>
  collator.compare(normalizeText(a?.title), normalizeText(b?.title)) ||
  String(a?.key ?? '').localeCompare(String(b?.key ?? ''))

// numbers: bigger first, missing values last
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
function byNumberDesc(field) {
  return (a, b) => {
    const x = num(a?.[field])
    const y = num(b?.[field])
    if (x === y) return byTitle(a, b)
    if (x === null) return 1
    if (y === null) return -1
    return y - x || byTitle(a, b)
  }
}

export function sortItems(items, sort = 'added') {
  const list = Array.isArray(items) ? [...items] : []
  if (sort === 'title') return list.sort(byTitle)
  if (sort === 'year') return list.sort(byNumberDesc('year'))
  if (sort === 'rating') return list.sort(byNumberDesc('rating'))
  // added: most recent first; items without a date go to the end, alphabetically
  return list.sort(byNumberDesc('addedAt'))
}

// the "Continuar assistindo" row follows the movies / series chips; it has no notion of favorites
export function filterContinue(list, filter = 'all') {
  const items = Array.isArray(list) ? list.filter(Boolean) : []
  if (filter === 'movies') return items.filter((item) => item.type === 'movie')
  if (filter === 'series') return items.filter((item) => item.type === 'episode')
  return items
}

/* ------------------------------ patches (optimistic updates) ------------------------------ */

export function patchIndexFavorite(index, id, favorite) {
  if (!index || typeof index !== 'object') return index
  const map = (list) =>
    Array.isArray(list)
      ? list.map((item) => (item?.id === id ? { ...item, favorite } : item))
      : list
  return { ...index, movies: map(index.movies), series: map(index.series) }
}

export function patchSeriesFavorite(series, favorite) {
  return series && typeof series === 'object' ? { ...series, favorite } : series
}

export function patchVideoFavorite(video, favorite) {
  return video && typeof video === 'object' ? { ...video, favorite } : video
}

// `ids` can hold episode ids, season ids and the series id (the backend accepts all of them)
export function patchSeriesWatched(series, ids, watched) {
  if (!series || typeof series !== 'object' || !Array.isArray(series.seasons)) return series
  const wanted = new Set(Array.isArray(ids) ? ids : [])
  const everything = wanted.has(series.id)
  let total = 0
  let done = 0
  const seasons = series.seasons.map((season) => {
    const whole = everything || wanted.has(season?.id)
    const episodes = (Array.isArray(season?.episodes) ? season.episodes : []).map((episode) => {
      if (!episode) return episode
      let next = episode
      if (whole || wanted.has(episode.id)) {
        next = {
          ...episode,
          progress: watched
            ? { position: 0, duration: num(episode.duration) ?? 0, watched: true }
            : null
        }
      }
      total++
      if (next.progress?.watched) done++
      return next
    })
    return { ...season, episodes }
  })
  const counts = { ...(series.counts || {}), watched: done }
  if (!num(counts.episodes)) counts.episodes = total
  return { ...series, seasons, counts }
}

export function patchVideoWatched(video, watched) {
  if (!video || typeof video !== 'object') return video
  return {
    ...video,
    progress: watched ? { position: 0, duration: num(video.duration) ?? 0, watched: true } : null
  }
}

/* ------------------------------ progress ------------------------------ */

export const RESUME_MIN_SECONDS = 5

export const isWatched = (progress) => progress?.watched === true

export function progressPercent(progress) {
  if (!progress) return 0
  if (progress.watched) return 100
  const position = num(progress.position)
  const duration = num(progress.duration)
  if (position === null || duration === null || duration <= 0 || position <= 0) return 0
  return Math.round(Math.min(100, (position / duration) * 100) * 10) / 10
}

// seconds to resume from, 0 when playback should start at the beginning (spec section 7)
export function resumePosition(progress) {
  if (!progress || progress.watched) return 0
  const position = num(progress.position)
  return position !== null && position > RESUME_MIN_SECONDS ? position : 0
}

export function remainingSeconds(item) {
  const duration = num(item?.duration)
  const position = num(item?.position) ?? 0
  return duration !== null && duration > position ? duration - position : 0
}

// "5/18" style state of a series
export function seriesProgress(series) {
  const episodes = Math.max(0, num(series?.episodes) ?? 0)
  const watched = Math.min(episodes, Math.max(0, num(series?.watched) ?? 0))
  return {
    episodes,
    watched,
    percent: episodes > 0 ? Math.round((watched / episodes) * 1000) / 10 : 0,
    complete: episodes > 0 && watched >= episodes
  }
}

/* ------------------------------ formatting ------------------------------ */

const pad2 = (n) => String(n).padStart(2, '0')

// 6720 -> "1h 52min", 2700 -> "45min", 7200 -> "2h". '' when unknown.
export function formatDuration(seconds) {
  const value = num(seconds)
  if (value === null || value <= 0) return ''
  const minutes = Math.round(value / 60)
  if (minutes < 1) return '<1min'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}min`
  return m === 0 ? `${h}h` : `${h}h ${m}min`
}

// 754 -> "12:34", 3725 -> "1:02:05"
export function formatClock(seconds) {
  const value = num(seconds)
  if (value === null || value < 0) return '0:00'
  const total = Math.floor(value)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`
}

// bytes -> "1,4 GB" (decimal separator follows `locale`)
export function formatSize(bytes, locale = 'pt-BR') {
  const value = num(bytes)
  if (value === null || value <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = value
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  const digits = i >= 3 ? 2 : i >= 1 ? 1 : 0
  return `${n.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: digits })} ${units[i]}`
}

// 7.84 -> "7,8"; '' when there is no rating
export function formatRating(rating, locale = 'pt-BR') {
  const value = num(rating)
  if (value === null || value <= 0) return ''
  return value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

// 1700000000000 -> "14:32"
export function formatClockTime(ms, locale = 'pt-BR') {
  const value = num(ms)
  if (value === null || value <= 0) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

// ISO string or epoch ms -> "14 de abr. de 2019"; '' when it is not a date
export function formatDate(value, locale = 'pt-BR') {
  if (value === null || value === undefined || value === '') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  // air dates arrive as midnight UTC ("2019-04-14T00:00:00Z"): read them in UTC or Brazil shows the day before
  const options = { day: '2-digit', month: 'short', year: 'numeric' }
  if (typeof value === 'string') options.timeZone = 'UTC'
  return date.toLocaleDateString(locale, options)
}

// (1, 2) -> "S01E02", (1, 2, 3) -> "S01E02-E03", (0, 1) -> "S00E01". '' when there is no numbering.
export function formatEpisodeLabel(season, episode, episodeEnd = null) {
  if (!Number.isInteger(season) || !Number.isInteger(episode)) return ''
  const end = Number.isInteger(episodeEnd) && episodeEnd > episode ? `-E${pad2(episodeEnd)}` : ''
  return `S${pad2(season)}E${pad2(episode)}${end}`
}

// the backend's `label` wins; otherwise it is composed from the numbers
export function episodeLabel(item) {
  if (typeof item?.label === 'string' && item.label) return item.label
  return formatEpisodeLabel(item?.season, item?.episode, item?.episodeEnd)
}

// width x height -> "1080p" / "4K"; uses the width first so wide (scope) movies are not downgraded
export function formatResolution(width, height) {
  const w = num(width) ?? 0
  const h = num(height) ?? 0
  if (w <= 0 && h <= 0) return ''
  if (w >= 3800 || h >= 2100) return '4K'
  if (w >= 2500 || h >= 1400) return '1440p'
  if (w >= 1900 || h >= 1000) return '1080p'
  if (w >= 1260 || h >= 700) return '720p'
  return h > 0 ? `${Math.round(h)}p` : `${Math.round(w)}w`
}

const VIDEO_CODECS = {
  h264: 'H.264',
  avc: 'H.264',
  hevc: 'HEVC (H.265)',
  h265: 'HEVC (H.265)',
  av1: 'AV1',
  vp9: 'VP9',
  vp8: 'VP8',
  mpeg4: 'MPEG-4',
  mpeg2video: 'MPEG-2',
  vc1: 'VC-1'
}

export function formatVideoCodec(codec, profile = '') {
  const key = String(codec ?? '')
    .trim()
    .toLowerCase()
  if (!key) return ''
  const name = VIDEO_CODECS[key] || key.toUpperCase()
  const extra = String(profile ?? '').trim()
  return extra ? `${name} ${extra}` : name
}

/* ------------------------------ languages ------------------------------ */

// ISO 639-2/B codes (mkv) -> the /T codes Intl understands
const BIBLIO = {
  baq: 'eus',
  fre: 'fra',
  ger: 'deu',
  gre: 'ell',
  rum: 'ron',
  dut: 'nld',
  may: 'msa',
  cze: 'ces',
  chi: 'zho',
  per: 'fas',
  slo: 'slk',
  wel: 'cym',
  ice: 'isl',
  arm: 'hye',
  geo: 'kat',
  mac: 'mkd',
  mao: 'mri',
  bur: 'mya',
  tib: 'bod',
  alb: 'sqi',
  pob: 'por'
}

const displayNames = new Map()
// "jpn" -> "Japonês" / "Japanese"; '' for undefined / unknown codes
export function languageName(code, locale = 'pt-BR') {
  const raw = String(code ?? '')
    .trim()
    .toLowerCase()
  if (!raw || raw === 'und' || raw === 'unk' || raw === 'zxx') return ''
  try {
    if (!displayNames.has(locale)) {
      displayNames.set(locale, new Intl.DisplayNames([locale], { type: 'language' }))
    }
    const name = displayNames.get(locale).of(BIBLIO[raw] || raw)
    if (name && name.toLowerCase() !== raw) return name[0].toUpperCase() + name.slice(1)
  } catch {
    /* unknown code: fall through */
  }
  return raw.toUpperCase()
}

export function trackLanguages(audio, locale = 'pt-BR') {
  const names = []
  for (const track of Array.isArray(audio) ? audio : []) {
    const name = languageName(track?.lang, locale)
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

/* ------------------------------ seasons ------------------------------ */

// "Season 1", "Temporada 01" and "Specials" are what servers generate: show our own label instead
export function isGenericSeasonName(name, season) {
  const text = normalizeText(name)
  if (!text) return true
  if (season === 0) return /^(specials?|especiais|especial)$/.test(text)
  return new RegExp(`^(season|temporada|saison|staffel)\\s*0*${season}$`).test(text)
}

export function seasonsOf(series) {
  return Array.isArray(series?.seasons) ? series.seasons.filter(Boolean) : []
}

export function episodesOf(season) {
  return Array.isArray(season?.episodes) ? season.episodes.filter(Boolean) : []
}

// the season to show first: the one of the next episode, else the first real season, else the first
export function pickInitialSeasonId(series) {
  const seasons = seasonsOf(series)
  if (seasons.length === 0) return ''
  const nextId = series?.nextUp?.id
  if (nextId) {
    const owner = seasons.find((season) => episodesOf(season).some((ep) => ep.id === nextId))
    if (owner) return owner.id
  }
  return (seasons.find((season) => season.season !== 0) || seasons[0]).id
}

// first episode in series order (specials last), for "watch again"
export function firstEpisodeOf(series) {
  for (const season of seasonsOf(series)) {
    const first = episodesOf(season)[0]
    if (first) return first
  }
  return null
}

// what the main button of the series page does: 'continue' | 'start' | 'again' | 'none'
export function seriesAction(series) {
  const nextUp = series?.nextUp
  if (nextUp) {
    const started = (num(series?.counts?.watched) ?? 0) > 0 || resumePosition(nextUp.progress) > 0
    return { kind: started ? 'continue' : 'start', episode: nextUp }
  }
  const first = firstEpisodeOf(series)
  return first ? { kind: 'again', episode: first } : { kind: 'none', episode: null }
}

/* ------------------------------ urls ------------------------------ */

export function normalizePort(port) {
  const value = Number(port)
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : DEFAULT_PORT
}

export function appendQuery(url, params) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const query = search.toString()
  if (!query) return url
  return url + (url.includes('?') ? '&' : '?') + query
}

// http://localhost:<port>/library<path>?...&t=<token>   (`host` lets the external player use 127.0.0.1)
export function buildUrl(port, path, { token = '', params, host = 'localhost' } = {}) {
  const clean = path === '' || path === '/' ? '' : path.startsWith('/') ? path : `/${path}`
  const url = `http://${host}:${normalizePort(port)}/library${clean}`
  return appendQuery(url, { ...(params || {}), t: token || undefined })
}

export function imageUrl(port, token, id, { type = 'primary', width = 400 } = {}) {
  const safe = normalizeId(id)
  if (!safe) return ''
  const w = Math.max(16, Math.min(1920, Math.round(num(width) ?? 400)))
  return buildUrl(port, `/image/${safe}`, { token, params: { type, w } })
}

export function streamUrl(port, token, id, host = 'localhost') {
  const safe = normalizeId(id)
  return safe ? buildUrl(port, `/stream/${safe}`, { token, host }) : ''
}

// mediainfo | subtitles | audio  (TracksMenu appends its own query)
export function trackUrl(port, token, id, kind) {
  const safe = normalizeId(id)
  if (!safe || !['mediainfo', 'subtitles', 'audio'].includes(kind)) return ''
  return buildUrl(port, `/${kind}/${safe}`, { token })
}

// the container a file reports (ffprobe "matroska,webm", Jellyfin "mkv", "mp4"...) -> a MIME type
// Chromium accepts for <source type>; the real container is sniffed from the bytes anyway
export function mimeForContainer(container) {
  const text = String(container ?? '').toLowerCase()
  if (/mp4|mov|m4v/.test(text)) return 'video/mp4'
  if (/ogg|ogv/.test(text)) return 'video/ogg'
  return 'video/webm'
}

/* ------------------------------ overview text ------------------------------ */

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' '
}

// Jellyfin overviews are plain text but sometimes carry <br>, <i>... Render them as text, never as HTML.
export function plainText(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function paragraphs(value) {
  return plainText(value)
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

// already accent-free: the text is normalised before it is compared
const PT_WORDS = new Set(
  'de da do das dos que nao uma um para com por os em na nos nas se mas ao e o sao foi era seu sua pelo pela como mais tambem quando muito'.split(
    ' '
  )
)
const EN_WORDS = new Set(
  'the and of to in is that his her with for on as at by from this who they he she it an are was be after when their into about while'.split(
    ' '
  )
)

// Machine translation is only worth it for text that is not Portuguese already; when in doubt the
// text is translated (the translator leaves Portuguese as it is).
export function looksPortuguese(value) {
  const text = String(value ?? '')
  const list = normalizeText(text)
    .replace(/[^a-z\s]/g, ' ')
    .split(' ')
    .filter(Boolean)
  let pt = (text.match(/[ãõç]/gi) || []).length
  let en = 0
  for (const word of list) {
    if (PT_WORDS.has(word)) pt++
    if (EN_WORDS.has(word)) en++
  }
  return pt > en
}

/* ------------------------------ misc ------------------------------ */

// keyboard shortcuts must be ignored while the user is typing
export function isTypingTarget(target) {
  if (!target) return false
  const tag = String(target.tagName || '').toUpperCase()
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true
  )
}

export const NEXT_EPISODE_SECONDS = 10

// "http://" (typed or implied) means the traffic is not encrypted
export function usesPlainHttp(url) {
  const text = String(url ?? '').trim()
  if (!text) return false
  if (/^https:\/\//i.test(text)) return false
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return /^http:\/\//i.test(text) // other schemes are rejected later
  return true // no scheme: the app assumes http
}

// codes of the backend / IPC -> what the screen does about them
export function errorKind(code) {
  switch (code) {
    case 'NOT_CONNECTED':
      return 'not-connected'
    case 'AUTH_EXPIRED':
      return 'auth'
    case 'SERVER_UNREACHABLE':
      return 'unreachable'
    case 'NOT_FOUND':
      return 'not-found'
    case 'UNAUTHORIZED':
    case 'BACKEND_DOWN':
      return 'local'
    default:
      return 'generic'
  }
}

// errors that retrying cannot fix
export function isFatalCode(code) {
  return ['NOT_CONNECTED', 'AUTH_EXPIRED', 'UNAUTHORIZED', 'NOT_FOUND', 'BAD_REQUEST'].includes(
    code
  )
}

// reasons the backend gives in playback.reason, plus our own for a runtime <video> error
export function normalizeReason(reason) {
  return [
    'container',
    'video-codec',
    'bit-depth',
    'no-video',
    'playback-error',
    'network-error'
  ].includes(reason)
    ? reason
    : 'unknown'
}

// MediaError.code (1 aborted, 2 network, 3 decode, 4 source not supported) -> our reason; null = ignore
export function reasonForMediaError(code) {
  if (code === 2) return 'network-error'
  if (code === 3 || code === 4) return 'playback-error'
  return null
}
