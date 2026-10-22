// Pure functions: Jellyfin's DTOs -> the JSON of the library API (docs: spec section 5). No I/O.
import { TEXT_SUB_CODECS, SUPPORTED_AUDIO, assessDirectPlay, pickAutoPtSource } from '../media.js'

const TICKS_PER_SECOND = 1e7

/* ------------------------------ small helpers ------------------------------ */

// 32 lower-case hex chars, or null. Jellyfin accepts/returns GUIDs with or without dashes.
export function normalizeId(value) {
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  const compact = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(text)
    ? text.replace(/-/g, '')
    : text
  return /^[a-f0-9]{32}$/.test(compact) ? compact : null
}

export const ticksToSeconds = (ticks) =>
  typeof ticks === 'number' && Number.isFinite(ticks) && ticks > 0
    ? Math.round(ticks / 1e4) / 1e3
    : 0

export const secondsToTicks = (seconds) =>
  Math.max(0, Math.round(Number(seconds) * TICKS_PER_SECOND))

const toMs = (iso) => {
  const ms = typeof iso === 'string' ? Date.parse(iso) : NaN
  return Number.isFinite(ms) ? ms : 0
}

const round1 = (n) => Math.round(n * 10) / 10
const asInt = (n) => (Number.isInteger(n) ? n : null)
const stringList = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [])

export function yearOf(raw) {
  if (Number.isInteger(raw?.ProductionYear) && raw.ProductionYear > 0) return raw.ProductionYear
  const ms = toMs(raw?.PremiereDate)
  return ms ? new Date(ms).getUTCFullYear() : null
}

// Jellyfin keeps the "(2020)" of the folder name in the title when no metadata provider matched it
export function cleanTitle(name, year) {
  const title = typeof name === 'string' ? name.trim() : ''
  const match = title.match(/^(.*\S)\s*\((\d{4})\)$/)
  return match && Number(match[2]) === year ? match[1] : title
}

export const ratingOf = (raw) =>
  typeof raw?.CommunityRating === 'number' && Number.isFinite(raw.CommunityRating)
    ? round1(raw.CommunityRating)
    : null

// 'S01E02' | 'S01E02-E03' | 'S00E01'; null without numbering
export function episodeLabel(season, episode, episodeEnd = null) {
  if (!Number.isInteger(season) || !Number.isInteger(episode)) return null
  const p = (n) => String(n).padStart(2, '0')
  const end = Number.isInteger(episodeEnd) && episodeEnd > episode ? `-E${p(episodeEnd)}` : ''
  return `S${p(season)}E${p(episode)}${end}`
}

// ISO date from Jellyfin ("2015-01-01T00:00:00.0000000Z") -> "2015-01-01T00:00:00.000Z" | null
const isoDate = (value) => {
  const ms = toMs(value)
  return ms ? new Date(ms).toISOString() : null
}

export const hasPrimary = (raw) => !!raw?.ImageTags?.Primary

/* ------------------------------ progress ------------------------------ */

// { position: seconds, duration: seconds, watched } or null when the item was never played
export function toProgress(userData, runtimeTicks) {
  if (!userData || typeof userData !== 'object') return null
  const position = ticksToSeconds(userData.PlaybackPositionTicks)
  const watched = userData.Played === true
  if (!watched && position <= 0) return null
  return { position, duration: ticksToSeconds(runtimeTicks), watched }
}

/* ------------------------------ catalog items ------------------------------ */

export function mapMovie(raw) {
  const id = normalizeId(raw.Id)
  const year = yearOf(raw)
  return {
    key: `m:${id}`,
    id,
    title: cleanTitle(raw.Name, year),
    year,
    duration: ticksToSeconds(raw.RunTimeTicks),
    width: Number.isInteger(raw.Width) ? raw.Width : 0,
    height: Number.isInteger(raw.Height) ? raw.Height : 0,
    addedAt: toMs(raw.DateCreated),
    rating: ratingOf(raw),
    genres: stringList(raw.Genres),
    progress: toProgress(raw.UserData, raw.RunTimeTicks),
    favorite: raw.UserData?.IsFavorite === true,
    hasImage: hasPrimary(raw)
  }
}

// extra: { hasSpecials: boolean, lastWatchedAt: number|null }
export function mapSeries(raw, { hasSpecials = false, lastWatchedAt = null } = {}) {
  const id = normalizeId(raw.Id)
  const year = yearOf(raw)
  const episodes = Number.isInteger(raw.RecursiveItemCount) ? raw.RecursiveItemCount : 0
  const unplayed = Number.isInteger(raw.UserData?.UnplayedItemCount)
    ? raw.UserData.UnplayedItemCount
    : episodes
  const seasons = Math.max(
    0,
    (Number.isInteger(raw.ChildCount) ? raw.ChildCount : 0) - (hasSpecials ? 1 : 0)
  )
  return {
    key: `s:${id}`,
    id,
    title: cleanTitle(raw.Name, year),
    year,
    seasons,
    episodes,
    watched: Math.min(episodes, Math.max(0, episodes - unplayed)),
    addedAt: toMs(raw.DateCreated),
    lastWatchedAt: lastWatchedAt || null,
    rating: ratingOf(raw),
    genres: stringList(raw.Genres),
    favorite: raw.UserData?.IsFavorite === true,
    hasImage: hasPrimary(raw)
  }
}

// Episode of a series page. `lastPlayed` (ms) is internal: used to pick the "next up" episode, then removed.
export function mapEpisode(raw) {
  const season = Number.isInteger(raw.ParentIndexNumber) ? raw.ParentIndexNumber : 1
  const episode = asInt(raw.IndexNumber)
  const episodeEnd =
    Number.isInteger(raw.IndexNumberEnd) && raw.IndexNumberEnd > (episode ?? 0)
      ? raw.IndexNumberEnd
      : null
  return {
    id: normalizeId(raw.Id),
    season,
    episode,
    episodeEnd,
    label: episodeLabel(season, episode, episodeEnd),
    title: typeof raw.Name === 'string' ? raw.Name : '',
    overview: typeof raw.Overview === 'string' ? raw.Overview : '',
    duration: ticksToSeconds(raw.RunTimeTicks),
    progress: toProgress(raw.UserData, raw.RunTimeTicks),
    hasImage: hasPrimary(raw),
    airDate: isoDate(raw.PremiereDate)
  }
}

const lastPlayedOf = (raw) => toMs(raw?.UserData?.LastPlayedDate)

// season ascending, specials (0) last; inside a season by episode number
export function compareEpisodes(a, b) {
  const sa = a.season === 0 ? Infinity : a.season
  const sb = b.season === 0 ? Infinity : b.season
  if (sa !== sb) return sa < sb ? -1 : 1
  const ea = a.episode ?? Infinity
  const eb = b.episode ?? Infinity
  if (ea !== eb) return ea < eb ? -1 : 1
  return String(a.title).localeCompare(String(b.title))
}

// The "Continue / Start" target of a series page:
//  1. the unfinished episode with the latest play date, else
//  2. the first unwatched episode after the last watched one (series order), else
//  3. the first unwatched episode, else null (everything watched).
// Specials (season 0) only count when the series has nothing else.
export function pickNextUp(episodes, lastPlayedById = new Map()) {
  const ordered = [...episodes].sort(compareEpisodes)
  const regular = ordered.filter((e) => e.season !== 0)
  const pool = regular.length ? regular : ordered
  const unfinished = pool.filter(
    (e) => e.progress && !e.progress.watched && e.progress.position > 0
  )
  if (unfinished.length) {
    return unfinished.reduce((best, e) =>
      (lastPlayedById.get(e.id) || 0) >= (lastPlayedById.get(best.id) || 0) ? e : best
    )
  }
  let lastWatched = -1
  pool.forEach((e, i) => {
    if (e.progress?.watched) lastWatched = i
  })
  const after = pool.slice(lastWatched + 1).find((e) => !e.progress?.watched)
  return after || pool.find((e) => !e.progress?.watched) || null
}

// Series page. `raw` = the series item, `seasonList` = /Shows/{id}/Seasons items, `episodeList` = /Shows/{id}/Episodes items
export function mapSeriesDetail(raw, seasonList, episodeList) {
  const mapped = episodeList.map((e) => ({
    item: mapEpisode(e),
    lastPlayed: lastPlayedOf(e),
    seasonId: normalizeId(e.SeasonId)
  }))
  const lastPlayedById = new Map(mapped.map((m) => [m.item.id, m.lastPlayed]))

  const groups = new Map() // season number -> { id, season, name, episodes }
  for (const s of seasonList) {
    if (!Number.isInteger(s.IndexNumber)) continue
    groups.set(s.IndexNumber, {
      id: normalizeId(s.Id),
      season: s.IndexNumber,
      name: String(s.Name || ''),
      episodes: []
    })
  }
  for (const m of mapped) {
    let group = groups.get(m.item.season)
    if (!group) {
      group = {
        id: m.seasonId,
        season: m.item.season,
        name: m.item.season === 0 ? 'Specials' : `Season ${m.item.season}`,
        episodes: []
      }
      groups.set(m.item.season, group)
    }
    group.episodes.push(m.item)
  }
  const seasons = [...groups.values()]
    .filter((g) => g.episodes.length > 0 || g.season !== 0)
    .sort((a, b) => (a.season === 0 ? Infinity : a.season) - (b.season === 0 ? Infinity : b.season))
  for (const g of seasons) g.episodes.sort(compareEpisodes)

  const all = mapped.map((m) => m.item)
  const year = yearOf(raw)
  const status = raw.Status === 'Continuing' || raw.Status === 'Ended' ? raw.Status : null
  return {
    id: normalizeId(raw.Id),
    title: cleanTitle(raw.Name, year),
    year,
    overview: typeof raw.Overview === 'string' ? raw.Overview : '',
    genres: stringList(raw.Genres),
    rating: ratingOf(raw),
    officialRating: raw.OfficialRating || null,
    status,
    favorite: raw.UserData?.IsFavorite === true,
    hasImage: hasPrimary(raw),
    hasBackdrop: Array.isArray(raw.BackdropImageTags) && raw.BackdropImageTags.length > 0,
    counts: {
      seasons: seasons.filter((g) => g.season !== 0).length,
      episodes: all.length,
      watched: all.filter((e) => e.progress?.watched).length
    },
    seasons,
    nextUp: pickNextUp(all, lastPlayedById)
  }
}

/* ------------------------------ continue watching ------------------------------ */

function continueBase(raw) {
  const id = normalizeId(raw.Id)
  const episode = raw.Type === 'Episode'
  const year = yearOf(raw)
  const number = asInt(raw.IndexNumber)
  const season = Number.isInteger(raw.ParentIndexNumber)
    ? raw.ParentIndexNumber
    : episode
      ? 1
      : null
  const end =
    Number.isInteger(raw.IndexNumberEnd) && raw.IndexNumberEnd > (number ?? 0)
      ? raw.IndexNumberEnd
      : null
  const seriesId = episode ? normalizeId(raw.SeriesId) : null
  return {
    type: episode ? 'episode' : 'movie',
    videoId: id,
    key: episode ? `s:${seriesId}` : `m:${id}`,
    title: episode ? String(raw.Name || '') : cleanTitle(raw.Name, year),
    year,
    seriesId,
    seriesTitle: episode ? String(raw.SeriesName || '') : null,
    season: episode ? season : null,
    episode: episode ? number : null,
    episodeEnd: episode ? end : null,
    label: episode ? episodeLabel(season, number, end) : null,
    duration: ticksToSeconds(raw.RunTimeTicks),
    hasImage: hasPrimary(raw)
  }
}

// An item of /UserItems/Resume (in progress)
export function mapResumeItem(raw) {
  return {
    ...continueBase(raw),
    position: ticksToSeconds(raw.UserData?.PlaybackPositionTicks),
    next: false,
    updatedAt: lastPlayedOf(raw)
  }
}

// An item of /Shows/NextUp. Jellyfin also returns the episode that is in progress: that one is not "next".
export function mapNextUpItem(raw, updatedAt = 0) {
  const position = ticksToSeconds(raw.UserData?.PlaybackPositionTicks)
  return {
    ...continueBase(raw),
    position,
    next: position <= 0,
    updatedAt: position > 0 ? lastPlayedOf(raw) || updatedAt : updatedAt
  }
}

// at most one entry per series (or per movie), newest first, max 20
export function mergeContinue(items, limit = 20) {
  const best = new Map()
  for (const item of items) {
    if (!item.videoId) continue
    const key = item.key
    const current = best.get(key)
    // for the same title: the newer entry wins, and an in-progress one wins over "next"
    if (
      !current ||
      item.updatedAt > current.updatedAt ||
      (item.updatedAt === current.updatedAt && current.next && !item.next)
    ) {
      best.set(key, item)
    }
  }
  return [...best.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
}

/* ------------------------------ media streams ------------------------------ */

// Jellyfin's `Container` ("mkv", "mp4", "avi"...) -> the ffprobe `format_name` that assessDirectPlay knows
const FORMAT_NAMES = {
  mkv: 'matroska,webm',
  matroska: 'matroska,webm',
  webm: 'matroska,webm',
  mp4: 'mov,mp4,m4a,3gp,3g2,mj2',
  m4v: 'mov,mp4,m4a,3gp,3g2,mj2',
  mov: 'mov,mp4,m4a,3gp,3g2,mj2',
  '3gp': 'mov,mp4,m4a,3gp,3g2,mj2',
  avi: 'avi',
  ts: 'mpegts',
  m2ts: 'mpegts',
  mts: 'mpegts',
  mpegts: 'mpegts',
  flv: 'flv',
  wmv: 'asf',
  asf: 'asf',
  ogg: 'ogg',
  ogv: 'ogg',
  mpg: 'mpeg',
  mpeg: 'mpeg'
}
export function containerToFormat(container) {
  const text = String(container || '')
    .toLowerCase()
    .trim()
  if (text.includes(',')) return text // already an ffprobe format list
  return FORMAT_NAMES[text] || text
}

const lower = (value) => (typeof value === 'string' ? value.toLowerCase() : '')

// Item (with MediaSources) -> the mediainfo JSON of the torrent route (+ `external` on subtitles).
// Also returns, for every audio stream `Index`, its position among the audio streams: Jellyfin's `Index`
// is NOT ffmpeg's stream index when the item has side-car subtitle files (they are numbered first and
// shift every embedded stream), but "the Nth audio stream" is the same for both.
export function mapMediaInfo(item) {
  const source = Array.isArray(item?.MediaSources) ? item.MediaSources[0] : null
  const streams = Array.isArray(source?.MediaStreams) ? source.MediaStreams : []
  const audio = []
  const subtitles = []
  const audioOrdinals = new Map()
  let video = null
  for (const st of streams) {
    if (!Number.isInteger(st.Index)) continue
    const codec = lower(st.Codec)
    const base = {
      id: st.Index,
      codec,
      lang: st.Language || 'und',
      title: st.Title || '',
      default: st.IsDefault === true
    }
    if (st.Type === 'Video' && !video) {
      video = {
        id: st.Index,
        codec,
        profile: st.Profile || '',
        width: st.Width || 0,
        height: st.Height || 0,
        pixFmt: st.PixelFormat || ''
      }
    } else if (st.Type === 'Audio') {
      audioOrdinals.set(st.Index, audio.length)
      audio.push({ ...base, channels: st.Channels, supported: SUPPORTED_AUDIO.includes(codec) })
    } else if (st.Type === 'Subtitle') {
      subtitles.push({
        ...base,
        text: TEXT_SUB_CODECS.includes(codec),
        external: st.IsExternal === true
      })
    }
  }
  const info = {
    duration: ticksToSeconds(source?.RunTimeTicks ?? item?.RunTimeTicks),
    container: containerToFormat(source?.Container ?? item?.Container),
    video,
    audio,
    subtitles,
    autoPtSource: pickAutoPtSource(subtitles)
  }
  return {
    info: { ...info, playback: assessDirectPlay(info) },
    audioOrdinals,
    mediaSourceId: normalizeId(source?.Id)
  }
}

/* ------------------------------ video page ------------------------------ */

const baseName = (path) => {
  const name = String(path || '')
    .split(/[\\/]/)
    .pop()
  return name || ''
}

// prev / next: { id, label, title } | null
export const neighbour = (e) => (e ? { id: e.id, label: e.label, title: e.title } : null)

export function mapVideoDetail(item, { prev = null, next = null } = {}) {
  const { info } = mapMediaInfo(item)
  const source = Array.isArray(item.MediaSources) ? item.MediaSources[0] : null
  const episode = item.Type === 'Episode'
  const year = yearOf(item)
  const number = asInt(item.IndexNumber)
  const season = episode
    ? Number.isInteger(item.ParentIndexNumber)
      ? item.ParentIndexNumber
      : 1
    : null
  const end =
    episode && Number.isInteger(item.IndexNumberEnd) && item.IndexNumberEnd > (number ?? 0)
      ? item.IndexNumberEnd
      : null
  const streams = Array.isArray(source?.MediaStreams) ? source.MediaStreams : []
  return {
    id: normalizeId(item.Id),
    kind: episode ? 'episode' : 'movie',
    title: episode ? String(item.Name || '') : cleanTitle(item.Name, year),
    year,
    overview: typeof item.Overview === 'string' ? item.Overview : '',
    genres: stringList(item.Genres),
    rating: ratingOf(item),
    officialRating: item.OfficialRating || null,
    season,
    episode: episode ? number : null,
    episodeEnd: end,
    label: episode ? episodeLabel(season, number, end) : null,
    seriesId: episode ? normalizeId(item.SeriesId) : null,
    seriesTitle: episode ? String(item.SeriesName || '') : null,
    fileName: baseName(source?.Path || item.Path) || String(item.Name || ''),
    size: Number.isFinite(source?.Size) ? source.Size : 0,
    duration: info.duration || ticksToSeconds(item.RunTimeTicks),
    width: info.video?.width || (Number.isInteger(item.Width) ? item.Width : 0),
    height: info.video?.height || (Number.isInteger(item.Height) ? item.Height : 0),
    container: lower(source?.Container ?? item.Container),
    vcodec: info.video?.codec || '',
    vprofile: info.video?.profile || '',
    audio: info.audio.map((a) => ({
      id: a.id,
      codec: a.codec,
      lang: a.lang,
      title: a.title,
      channels: a.channels ?? 0,
      default: a.default
    })),
    subs: info.subtitles.map((s) => ({
      id: s.id,
      codec: s.codec,
      lang: s.lang,
      title: s.title,
      external: s.external,
      default: s.default,
      forced: streams.find((st) => st.Index === s.id)?.IsForced === true
    })),
    playback: info.playback,
    progress: toProgress(item.UserData, item.RunTimeTicks),
    favorite: item.UserData?.IsFavorite === true,
    hasImage: hasPrimary(item),
    hasBackdrop: Array.isArray(item.BackdropImageTags) && item.BackdropImageTags.length > 0,
    prev: neighbour(prev),
    next: neighbour(next)
  }
}
