// The library service: owns the connection to the user's Jellyfin server, the caches and every
// operation the HTTP routes and the IPC handlers need. Electron-free (everything is injected).
import crypto from 'crypto'
import { ApiError, toApiError } from './errors.js'
import { createCache, createLoader, createSingleFlight, mapLimit } from './cache.js'
import { ConnectionError, normalizeUrl, publicServer } from './connection.js'
import {
  INDEX_QUERIES,
  NEIGHBOUR_EPISODES_FIELDS,
  PAGE_SIZE,
  PLAYED_HISTORY_MAX,
  SERIES_EPISODES_FIELDS
} from './queries.js'
import { JellyfinError, createJellyfinClient } from './jellyfin.js'
import {
  compareEpisodes,
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
  secondsToTicks,
  toProgress
} from './mapper.js'

const INDEX_TTL_MS = 60 * 1000
const ITEM_TTL_MS = 10 * 60 * 1000
const EPISODES_TTL_MS = 60 * 1000
const MIN_SAVED_SECONDS = 5 // a stop / progress below this never overwrites a saved position
const VIDEO_TYPES = new Set(['Movie', 'Episode', 'Video'])

const collator = new Intl.Collator('und', { sensitivity: 'base', numeric: true })
const byTitle = (a, b) => collator.compare(a.title, b.title) || (a.id < b.id ? -1 : 1)

// network trouble / expired session must surface; any other upstream hiccup of an optional query is skipped
const isFatal = (error) =>
  error instanceof JellyfinError &&
  ['UNREACHABLE', 'TIMEOUT', 'TLS_ERROR', 'AUTH_EXPIRED', 'BAD_CREDENTIALS'].includes(error.code)

async function optional(promise, fallback) {
  try {
    return await promise
  } catch (error) {
    if (!(error instanceof JellyfinError) || isFatal(error)) throw error
    return fallback
  }
}

// ConnectionError / JellyfinError raised while connecting -> the IPC result
function connectFailure(error) {
  if (error instanceof ConnectionError)
    return { ok: false, error: 'BAD_URL', message: error.message }
  if (error instanceof JellyfinError) {
    const code = {
      UNREACHABLE: 'UNREACHABLE',
      TIMEOUT: 'TIMEOUT',
      TLS_ERROR: 'TLS_ERROR',
      BAD_CREDENTIALS: 'BAD_CREDENTIALS',
      NOT_FOUND: 'NOT_JELLYFIN',
      BAD_RESPONSE: 'NOT_JELLYFIN',
      AUTH_EXPIRED: 'NOT_JELLYFIN'
    }[error.code]
    return { ok: false, error: code || 'SERVER_ERROR', message: error.message }
  }
  return { ok: false, error: 'SERVER_ERROR', message: 'unexpected error' }
}

export function createLibraryService({
  store,
  appVersion = '0.0.0',
  createClient = createJellyfinClient,
  now = Date.now,
  log = () => {}
}) {
  let client = null // for the stored connection
  let clientKey = ''
  let connecting = false
  let epoch = 0 // bumps whenever the connection changes: stale results are dropped

  const indexLoader = createLoader({ max: 1, ttlMs: INDEX_TTL_MS, now })
  const itemLoader = createLoader({ max: 300, ttlMs: ITEM_TTL_MS, now })
  const episodesLoader = createLoader({ max: 40, ttlMs: EPISODES_TTL_MS, now })
  const seriesFlight = createSingleFlight()
  const playSessions = createCache({ max: 100, ttlMs: 6 * 60 * 60 * 1000, now }) // id -> { playSessionId, watched }

  function invalidate() {
    indexLoader.clear()
    episodesLoader.clear()
    itemLoader.clear()
    seriesFlight.clear()
  }

  const resetListeners = []

  function resetClient() {
    client?.close()
    client = null
    clientKey = ''
    epoch++
    invalidate()
    playSessions.clear()
    for (const listener of resetListeners) listener()
  }

  // the client for the stored connection (created lazily; rebuilt when the connection changes)
  function getClient() {
    const current = store.current()
    if (!current) throw new ApiError('NOT_CONNECTED', 'no Jellyfin server configured')
    if (!current.token)
      throw new ApiError('AUTH_EXPIRED', 'the Jellyfin session expired, sign in again')
    const key = `${current.url}|${current.userId}|${current.connectedAt}|${current.allowInvalidCert}`
    if (!client || key !== clientKey) {
      client?.close()
      client = createClient({
        baseUrl: current.url,
        token: current.token,
        userId: current.userId,
        deviceId: current.deviceId,
        appVersion,
        allowInvalidCert: current.allowInvalidCert
      })
      clientKey = key
    }
    return client
  }

  // run a client call, converting every failure to an ApiError
  async function call(fn) {
    try {
      return await fn(getClient())
    } catch (error) {
      throw toApiError(error)
    }
  }

  /* ------------------------------ connection ------------------------------ */

  async function connect(args) {
    if (connecting) return { ok: false, error: 'SERVER_ERROR', message: 'busy' }
    connecting = true
    let probe = null
    try {
      const { url, username, password, allowInvalidCert } = args || {}
      if (typeof url !== 'string' || url.length > 2048)
        return { ok: false, error: 'BAD_URL', message: 'invalid server address' }
      if (typeof username !== 'string' || !username.trim() || username.length > 256) {
        return { ok: false, error: 'BAD_CREDENTIALS', message: 'invalid user name' }
      }
      if (typeof password !== 'string' || password.length > 1024) {
        return { ok: false, error: 'BAD_CREDENTIALS', message: 'invalid password' }
      }
      const trustInvalid = allowInvalidCert === true
      const makeClient = (baseUrl) =>
        createClient({
          baseUrl,
          deviceId: store.deviceId,
          appVersion,
          allowInvalidCert: trustInvalid
        })

      let baseUrl = normalizeUrl(url)
      probe = makeClient(baseUrl)
      let raw = await probe.publicInfoRaw()
      // http -> https (or a moved server): follow ONE redirect when it keeps the host and points at the same API route
      if ([301, 302, 307, 308].includes(raw.status) && raw.location) {
        const target = new URL(raw.location, baseUrl)
        const from = new URL(baseUrl)
        const suffix = '/System/Info/Public'
        if (
          target.hostname === from.hostname &&
          target.pathname.replace(/\/+$/, '').endsWith(suffix)
        ) {
          baseUrl = normalizeUrl(
            `${target.origin}${target.pathname.slice(0, target.pathname.length - suffix.length)}`
          )
          probe.close()
          probe = makeClient(baseUrl)
          raw = await probe.publicInfoRaw()
        }
      }
      if (
        raw.status === 401 ||
        raw.status === 403 ||
        raw.status === 404 ||
        (raw.status >= 300 && raw.status < 400)
      ) {
        return { ok: false, error: 'NOT_JELLYFIN', message: `unexpected HTTP ${raw.status}` }
      }
      if (raw.status >= 400)
        return { ok: false, error: 'SERVER_ERROR', message: `HTTP ${raw.status}` }
      let info
      try {
        info = JSON.parse(raw.body)
      } catch {
        return { ok: false, error: 'NOT_JELLYFIN', message: 'not a Jellyfin server' }
      }
      if (
        !info ||
        typeof info !== 'object' ||
        typeof info.Id !== 'string' ||
        typeof info.Version !== 'string' ||
        (typeof info.ProductName === 'string' && !/jellyfin/i.test(info.ProductName))
      ) {
        return { ok: false, error: 'NOT_JELLYFIN', message: 'not a Jellyfin server' }
      }

      const auth = await probe.authenticate(username.trim(), password)
      const userId = normalizeId(auth?.User?.Id)
      if (!auth || typeof auth.AccessToken !== 'string' || !auth.AccessToken || !userId) {
        return { ok: false, error: 'SERVER_ERROR', message: 'unexpected authentication answer' }
      }

      await store.save({
        url: baseUrl,
        name: typeof info.ServerName === 'string' ? info.ServerName : '',
        serverId: typeof info.Id === 'string' ? info.Id : '',
        version: info.Version,
        userId,
        userName:
          typeof auth.User.Name === 'string' && auth.User.Name ? auth.User.Name : username.trim(),
        allowInvalidCert: trustInvalid,
        token: auth.AccessToken
      })
      resetClient()
      return { ok: true, server: store.status().server }
    } catch (error) {
      return connectFailure(error)
    } finally {
      probe?.close()
      connecting = false
    }
  }

  async function disconnect() {
    const current = store.current()
    if (current?.token) {
      try {
        // best effort: the user may be offline or the token already gone
        await getClient().logout()
      } catch (error) {
        log(`logout skipped: ${error?.code || error?.message}`)
      }
    }
    try {
      await store.clear()
    } catch (error) {
      log(`could not clear the stored connection: ${error.message}`)
    }
    resetClient()
    return { ok: true }
  }

  const status = () => store.status()

  /* ------------------------------ index ------------------------------ */

  async function pagedItems(c, query, max = Infinity) {
    const first = await c.items({ ...query, StartIndex: 0, Limit: PAGE_SIZE })
    const items = Array.isArray(first?.Items) ? [...first.Items] : []
    const total = Math.min(
      Number.isInteger(first?.TotalRecordCount) ? first.TotalRecordCount : items.length,
      max
    )
    const starts = []
    for (let start = PAGE_SIZE; start < total; start += PAGE_SIZE) starts.push(start)
    const pages = await mapLimit(starts, 4, (start) =>
      c.items({ ...query, StartIndex: start, Limit: PAGE_SIZE })
    )
    for (const page of pages) items.push(...(page?.Items || []))
    return items.slice(0, max)
  }

  async function buildIndex(c, current) {
    const [movies, series, specials, resume, nextUp, played] = await Promise.all([
      pagedItems(c, INDEX_QUERIES.movies),
      pagedItems(c, INDEX_QUERIES.series),
      optional(pagedItems(c, INDEX_QUERIES.specials), []),
      optional(c.resume(INDEX_QUERIES.resume), { Items: [] }),
      optional(c.nextUp(INDEX_QUERIES.nextUp), { Items: [] }),
      optional(pagedItems(c, INDEX_QUERIES.played, PLAYED_HISTORY_MAX), [])
    ])

    // when each series was last watched: the newest played / in-progress episode
    const lastWatched = new Map()
    const touch = (seriesId, ms) => {
      if (seriesId && ms > (lastWatched.get(seriesId) || 0)) lastWatched.set(seriesId, ms)
    }
    for (const e of played)
      touch(normalizeId(e.SeriesId), Date.parse(e.UserData?.LastPlayedDate) || 0)
    const resumeItems = (resume.Items || []).filter((i) => i.UserData?.Played !== true)
    for (const e of resumeItems)
      if (e.Type === 'Episode')
        touch(normalizeId(e.SeriesId), Date.parse(e.UserData?.LastPlayedDate) || 0)

    const hasSpecials = new Set(specials.map((s) => normalizeId(s.SeriesId)).filter(Boolean))
    const movieItems = movies.map(mapMovie).sort(byTitle)
    const seriesItems = series
      .map((raw) => {
        const id = normalizeId(raw.Id)
        return mapSeries(raw, {
          hasSpecials: hasSpecials.has(id),
          lastWatchedAt: lastWatched.get(id) || null
        })
      })
      .sort(byTitle)

    const continueWatching = mergeContinue([
      ...resumeItems
        .filter((i) => i.Type === 'Movie' || i.Type === 'Episode' || i.Type === 'Video')
        .map(mapResumeItem),
      ...(nextUp.Items || [])
        .filter((i) => i.Type === 'Episode')
        .map((i) => mapNextUpItem(i, lastWatched.get(normalizeId(i.SeriesId)) || 0))
    ])

    const index = {
      server: publicServer(current),
      counts: {
        movies: movieItems.length,
        series: seriesItems.length,
        episodes: seriesItems.reduce((sum, s) => sum + s.episodes, 0)
      },
      movies: movieItems,
      series: seriesItems,
      continueWatching,
      fetchedAt: now()
    }
    return { index, json: JSON.stringify(index) }
  }

  // -> { index, json } (json = the serialised index, ready to send)
  async function getIndex({ refresh = false } = {}) {
    const current = store.current()
    const c = getClient()
    if (refresh) invalidate()
    const mine = epoch
    try {
      const result = await indexLoader.load('index', () => buildIndex(c, current))
      if (mine !== epoch) throw new ApiError('NOT_CONNECTED', 'the connection changed')
      return result
    } catch (error) {
      throw toApiError(error)
    }
  }

  /* ------------------------------ items ------------------------------ */

  // cached item (with MediaSources) + its mapped streams; UserData in it may be stale (use getVideo for that)
  function getItemMeta(id) {
    return itemLoader
      .load(`item:${id}`, async () => {
        const item = await call((c) => c.item(id))
        if (!item || !VIDEO_TYPES.has(item.Type))
          throw new ApiError('NOT_FOUND', 'not a playable video')
        return { item, ...mapMediaInfo(item) }
      })
      .catch((error) => {
        throw toApiError(error)
      })
  }

  async function episodesOf(seriesId) {
    return episodesLoader
      .load(`eps:${seriesId}`, async () => {
        const data = await call((c) => c.episodes(seriesId, { Fields: NEIGHBOUR_EPISODES_FIELDS }))
        return (data?.Items || []).map(mapEpisode).sort(compareEpisodes)
      })
      .catch((error) => {
        throw toApiError(error)
      })
  }

  async function neighbours(item) {
    const seriesId = normalizeId(item.SeriesId)
    if (item.Type !== 'Episode' || !seriesId) return { prev: null, next: null }
    try {
      const all = await episodesOf(seriesId)
      const me = normalizeId(item.Id)
      const special = (Number.isInteger(item.ParentIndexNumber) ? item.ParentIndexNumber : 1) === 0
      const pool = all.filter((e) => (e.season === 0) === special)
      const i = pool.findIndex((e) => e.id === me)
      if (i < 0) return { prev: null, next: null }
      return { prev: pool[i - 1] || null, next: pool[i + 1] || null }
    } catch (error) {
      if (error.code === 'AUTH_EXPIRED') throw error
      return { prev: null, next: null }
    }
  }

  async function getVideo(id) {
    const item = await call((c) => c.item(id))
    if (!item || !VIDEO_TYPES.has(item.Type))
      throw new ApiError('NOT_FOUND', 'not a playable video')
    // refresh the cached copy with this fresh one
    itemLoader.cache.set(`item:${id}`, { item, ...mapMediaInfo(item) })
    const { prev, next } = await neighbours(item)
    return mapVideoDetail(item, { prev, next })
  }

  function getSeries(id) {
    return seriesFlight
      .run(id, async () => {
        const [raw, seasons, episodes] = await call((c) =>
          Promise.all([
            c.item(id),
            c.seasons(id),
            c.episodes(id, { Fields: SERIES_EPISODES_FIELDS })
          ])
        )
        if (!raw || raw.Type !== 'Series') throw new ApiError('NOT_FOUND', 'series not found')
        return mapSeriesDetail(raw, seasons?.Items || [], episodes?.Items || [])
      })
      .catch((error) => {
        throw toApiError(error)
      })
  }

  /* ------------------------------ user data ------------------------------ */

  // state: 'start' | 'progress' | 'pause' | 'stop'
  async function reportProgress(id, { position, duration, state = 'progress' }) {
    const meta = await getItemMeta(id)
    const mediaSourceId = meta.mediaSourceId || id
    const runtimeTicks = Number.isFinite(meta.item.RunTimeTicks) ? meta.item.RunTimeTicks : 0
    const session = playSessions.get(id) || { playSessionId: crypto.randomUUID(), watched: false }

    // Jellyfin forgets the resume point when a play ends in its first 5 %: below a few seconds it is
    // just someone opening the item, so a saved position is sent back instead of the real one.
    let ticks = secondsToTicks(position)
    if (runtimeTicks > 0) ticks = Math.min(ticks, runtimeTicks)
    if (state === 'start') {
      const fresh = await call((c) => c.item(id))
      session.watched = fresh?.UserData?.Played === true
      session.playSessionId = crypto.randomUUID()
    } else if (position < MIN_SAVED_SECONDS) {
      const fresh = await call((c) => c.item(id))
      const saved = fresh?.UserData?.PlaybackPositionTicks
      if (Number.isFinite(saved) && saved > 0 && fresh.UserData.Played !== true) ticks = saved
    }
    playSessions.set(id, session)

    const body = {
      ItemId: id,
      MediaSourceId: mediaSourceId,
      PositionTicks: ticks,
      PlaySessionId: session.playSessionId
    }
    if (state === 'stop') {
      await call((c) => c.playback('stop', body))
      playSessions.delete(id)
      invalidate()
      const fresh = await call((c) => c.item(id))
      return {
        progress: toProgress(fresh?.UserData, fresh?.RunTimeTicks),
        watched: fresh?.UserData?.Played === true
      }
    }
    await call((c) =>
      c.playback(state === 'start' ? 'start' : 'progress', {
        ...body,
        IsPaused: state === 'pause',
        IsMuted: false,
        PlayMethod: 'DirectPlay',
        CanSeek: true
      })
    )
    const total = runtimeTicks / 1e7 || Number(duration) || 0
    return {
      progress: { position, duration: total, watched: session.watched },
      watched: session.watched
    }
  }

  async function setWatched(ids, watched) {
    let updated = 0
    let missing = 0
    let failure = null
    await mapLimit(ids, 4, async (id) => {
      try {
        await call((c) => c.setPlayed(id, watched))
        updated++
      } catch (error) {
        if (error.code === 'NOT_FOUND') missing++
        else failure ??= error
      }
    })
    invalidate()
    if (failure && updated === 0) throw failure
    if (updated === 0 && missing > 0) throw new ApiError('NOT_FOUND', 'item not found')
    return { updated }
  }

  async function setFavorite(id, favorite) {
    const data = await call((c) => c.setFavorite(id, favorite))
    invalidate()
    return { id, favorite: typeof data?.IsFavorite === 'boolean' ? data.IsFavorite : favorite }
  }

  /* ------------------------------ raw upstream streams (proxies) ------------------------------ */

  // { req, res } of the upstream response; non-2xx statuses are converted to ApiErrors here
  async function openUpstream(open) {
    let pair
    try {
      pair = await open(getClient())
    } catch (error) {
      throw toApiError(error)
    }
    const status = pair.res.statusCode
    if (status === 200 || status === 206 || status === 416) return pair
    pair.res.resume()
    pair.req.destroy()
    if (status === 401)
      throw new ApiError('AUTH_EXPIRED', 'the Jellyfin session expired, sign in again')
    if (status === 404) throw new ApiError('NOT_FOUND', 'not found')
    throw new ApiError('UPSTREAM_ERROR', 'the Jellyfin server answered with an error')
  }

  return {
    status,
    connect,
    disconnect,
    getIndex,
    getSeries,
    getVideo,
    getItemMeta,
    reportProgress,
    setWatched,
    setFavorite,
    invalidate,
    openUpstream,
    // for the track modules
    withClient: call,
    isConnected: () => !!store.current(),
    // called whenever the connection changes (connect / disconnect): drop anything cached for the old one
    onReset: (listener) => resetListeners.push(listener),
    close() {
      resetClient()
    }
  }
}
