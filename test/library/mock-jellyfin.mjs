// A mock Jellyfin server for the library tests: a node http(s) server that implements the endpoints the
// backend uses with the SAME shapes the real server returns (the JSON bodies come from the golden
// samples recorded from a real Jellyfin 12.2, see ./golden/record.mjs). It keeps state (user data, tokens)
// and reproduces the behaviours that matter and were verified against the real thing:
//
//   - only `Authorization: MediaBrowser ..., Token="..."` authenticates (401, empty body otherwise);
//     a wrong password is 401 text/plain "Error processing request.";
//   - `Fields` gates Overview / Genres / Width / Height / DateCreated / ChildCount / RecursiveItemCount / MediaSources;
//   - the play state rules: a stop below 5 % clears the position, above 90 % marks the item played,
//     items shorter than 300 s count as played on any stop (MinResumeDurationSeconds);
//   - GET /Items/{id} serves STALE user data after a series / season is marked played (list endpoints are right);
//   - side-car subtitle files are numbered first and shift the embedded streams' Index;
//   - Range requests on the stream (416 + `Content-Range: bytes */N`, junk Range = full answer), HEAD, text/plain errors.
//
// It can also simulate: a wrong password, a revoked token, slow / hanging endpoints, injected failures,
// self-signed TLS and a catalog of thousands of titles. No network beyond 127.0.0.1.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const goldenDir = path.join(here, 'golden')
export const golden = (name) => JSON.parse(fs.readFileSync(path.join(goldenDir, name), 'utf8'))
export const goldenText = (name) => fs.readFileSync(path.join(goldenDir, name), 'utf8')

export const USER = 'kaizen'
export const PASSWORD = 'Testbed-Pass-123'
const T = 1e7
const clone = (x) => JSON.parse(JSON.stringify(x))
const hex = (seed) => crypto.createHash('md5').update(String(seed)).digest('hex')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// field-gated properties: only present when `Fields` asks for them (verified on the real server)
const GATED = {
  MediaSources: 'MediaSources',
  Overview: 'Overview',
  Genres: 'Genres',
  GenreItems: 'Genres',
  Width: 'Width',
  Height: 'Height',
  DateCreated: 'DateCreated',
  ChildCount: 'ChildCount',
  RecursiveItemCount: 'RecursiveItemCount',
  Path: 'Path'
}

// a tiny stand-in for image bytes (the proxy only looks at the content type)
export const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 0x42), Buffer.from([0xff, 0xd9])])

// deterministic bytes of the synthetic "video" served when no real file is attached
const syntheticByte = (i) => (i * 31 + 7) & 0xff
export function syntheticBytes(start, end) {
  const out = Buffer.alloc(end - start + 1)
  for (let i = 0; i < out.length; i++) out[i] = syntheticByte(start + i)
  return out
}

/* ------------------------------ the catalog ------------------------------ */

function buildCatalog() {
  const items = new Map() // id -> full item (the `ids=` shape, a superset of the list shapes)
  const add = (item) => items.set(item.Id, item)

  const movieSlugs = ['test-movie', 'second-movie', 'hevc-movie', 'odd-layout', 'cover-movie']
  for (const slug of movieSlugs) add(golden(`item-${slug}.json`))
  const testShow = golden('item-series-test-show.json')
  const shortShow = golden('item-series-short-show.json')
  add(testShow)
  add(shortShow)
  for (const s of [...golden('seasons-test-show.json').Items, ...golden('seasons-short-show.json').Items]) add(s)

  const pilot = golden('item-episode-pilot.json')
  const multi = golden('item-episode-multi.json')
  const episodes = [...golden('episodes-test-show.json').Items, ...golden('episodes-short-show.json').Items]
  for (const ep of episodes) {
    let full = ep.Id === pilot.Id ? pilot : ep.Id === multi.Id ? multi : null
    if (!full) {
      // no recording of this one: derive its streams from the pilot's
      full = { ...clone(pilot), ...clone(ep) }
      full.MediaSources = clone(pilot.MediaSources).map((ms) => ({ ...ms, Id: ep.Id, Name: ep.Name, Path: `/media/${ep.Id}.mkv` }))
      full.Path = `/media/${ep.Id}.mkv`
      full.Width = pilot.Width
      full.Height = pilot.Height
    } else {
      full = { ...full, Overview: ep.Overview ?? full.Overview }
    }
    add(full)
  }
  return { items, testShow, shortShow }
}

/* ------------------------------ the server ------------------------------ */

// options: { user, password, tls: { key, cert }, bigCatalog: <number of extra movies AND series each>,
//            serverName, productName, version }
export async function startMockJellyfin(options = {}) {
  const { user = USER, password = PASSWORD, tls = null, bigCatalog = 0 } = options
  const { items } = buildCatalog()
  const publicInfo = { ...golden('public-info.json'), ...(options.serverName ? { ServerName: options.serverName } : {}), ...(options.version ? { Version: options.version } : {}) }
  const authGolden = golden('auth-result.json')
  const userId = authGolden.User.Id
  const tokens = new Set()
  const userData = new Map() // id -> { PlaybackPositionTicks, PlayCount, IsFavorite, Played, LastPlayedDate }
  const staleItemData = new Map() // id -> UserData snapshot served by GET /Items/{id}
  const requests = []
  const config = { MinResumePct: 5, MaxResumePct: 90, MinResumeDurationSeconds: 300 }
  const rules = [] // { match: RegExp, delayMs, hang, status, times, body }
  const media = new Map() // id -> { file } real file to stream (otherwise synthetic bytes)
  const subtitleTexts = new Map() // `${id}|${index}` -> vtt text
  const state = {
    config,
    requests,
    tokens,
    userData,
    activeStreams: 0,
    streamsClosedEarly: 0,
    streamsFinished: 0,
    playback: [], // every /Sessions/Playing* body, in order
    rejectLogins: false,
    sessionsLoggedOut: 0
  }

  const baseUd = () => ({ PlaybackPositionTicks: 0, PlayCount: 0, IsFavorite: false, Played: false, LastPlayedDate: undefined })
  const ud = (id) => {
    if (!userData.has(id)) userData.set(id, baseUd())
    return userData.get(id)
  }

  /* ---- big catalog: clones of the golden list items, only reachable through the list endpoints ---- */
  if (bigCatalog > 0) {
    const movieTemplate = clone(golden('movies-page.json').Items.find((m) => m.Name === 'Test Movie'))
    const seriesTemplate = clone(golden('series-page.json').Items.find((s) => s.Name === 'Test Show'))
    for (let i = 0; i < bigCatalog; i++) {
      const id = hex(`movie-${i}`)
      items.set(id, {
        ...clone(movieTemplate),
        Id: id,
        Name: `Movie ${String(i).padStart(5, '0')}`,
        SortName: `movie ${String(i).padStart(5, '0')}`,
        ProductionYear: 1950 + (i % 75),
        Genres: ['Drama', 'Comedy'],
        UserData: undefined
      })
      const sid = hex(`series-${i}`)
      items.set(sid, {
        ...clone(seriesTemplate),
        Id: sid,
        Name: `Series ${String(i).padStart(5, '0')}`,
        SortName: `series ${String(i).padStart(5, '0')}`,
        ProductionYear: 1950 + (i % 75),
        ChildCount: 3,
        RecursiveItemCount: 30,
        UserData: undefined
      })
    }
  }

  /* ---- helpers over the catalog ---- */
  const all = () => [...items.values()]
  const episodesOf = (seriesId) =>
    all()
      .filter((i) => i.Type === 'Episode' && i.SeriesId === seriesId)
      .sort((a, b) => (a.ParentIndexNumber ?? 0) - (b.ParentIndexNumber ?? 0) || (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0))
  const seasonsOf = (seriesId) => all().filter((i) => i.Type === 'Season' && i.SeriesId === seriesId).sort((a, b) => a.IndexNumber - b.IndexNumber)
  const descendants = (item) =>
    item.Type === 'Series' ? episodesOf(item.Id) : item.Type === 'Season' ? all().filter((i) => i.Type === 'Episode' && i.SeasonId === item.Id) : []

  function userDataOf(item) {
    const d = ud(item.Id)
    const key = item.UserData?.Key || `${item.Id}`
    if (item.Type === 'Series' || item.Type === 'Season') {
      const kids = descendants(item)
      const unplayed = kids.length ? kids.filter((k) => !ud(k.Id).Played).length : item.RecursiveItemCount ?? 0
      return {
        PlayedPercentage: kids.length ? Math.round(((kids.length - unplayed) / kids.length) * 100) : 0,
        UnplayedItemCount: unplayed,
        PlaybackPositionTicks: 0,
        PlayCount: 0,
        IsFavorite: d.IsFavorite,
        Played: kids.length > 0 && unplayed === 0,
        Key: key,
        ItemId: item.Id
      }
    }
    const out = {}
    if (d.PlaybackPositionTicks > 0 && item.RunTimeTicks) out.PlayedPercentage = (d.PlaybackPositionTicks / item.RunTimeTicks) * 100
    out.PlaybackPositionTicks = d.PlaybackPositionTicks
    out.PlayCount = d.PlayCount
    out.IsFavorite = d.IsFavorite
    if (d.LastPlayedDate) out.LastPlayedDate = d.LastPlayedDate
    out.Played = d.Played
    out.Key = key
    out.ItemId = item.Id
    return out
  }

  function project(item, fields, { stale = false } = {}) {
    const wanted = new Set(String(fields || '').split(',').filter(Boolean))
    const out = {}
    for (const [key, value] of Object.entries(item)) {
      if (value === undefined) continue
      if (GATED[key] && !wanted.has(GATED[key])) continue
      out[key] = value
    }
    // list rows do not carry the Overview of a series unless asked, ids= rows are the same: gated above
    if (stale) {
      if (!staleItemData.has(item.Id)) staleItemData.set(item.Id, userDataOf(item))
      out.UserData = staleItemData.get(item.Id)
    } else {
      out.UserData = userDataOf(item)
    }
    return out
  }

  /* ---- play state (Jellyfin's UserDataManager.UpdatePlayState) ---- */
  function updatePlayState(item, positionTicks) {
    const d = ud(item.Id)
    const runtime = item.RunTimeTicks || 0
    let position = positionTicks
    let completed = false
    if (position > 0 && runtime > 0) {
      const pct = (position / runtime) * 100
      if (pct < config.MinResumePct) position = 0
      else if (pct > config.MaxResumePct || position >= runtime) {
        position = 0
        d.Played = completed = true
      } else if (runtime / T < config.MinResumeDurationSeconds) {
        position = 0
        d.Played = completed = true
      }
    } else if (runtime <= 0) {
      d.Played = completed = true
      position = 0
    }
    d.PlaybackPositionTicks = position
    return completed
  }

  function markPlayed(item, played) {
    const targets = item.Type === 'Series' || item.Type === 'Season' ? descendants(item) : [item]
    for (const t of targets) {
      const d = ud(t.Id)
      d.Played = played
      d.PlaybackPositionTicks = 0
      if (played) {
        d.PlayCount = Math.max(1, d.PlayCount)
        d.LastPlayedDate = new Date().toISOString()
      } else {
        d.PlayCount = 0
        d.LastPlayedDate = undefined
      }
      // a direct write refreshes the cache behind GET /Items/{id}; a cascade does not (the 12.2 quirk)
      if (targets.length === 1) staleItemData.set(t.Id, userDataOf(t))
    }
    return userDataOf(item)
  }

  /* ---- streams: real files or synthetic bytes ---- */
  const sizeOf = (item) => {
    const entry = media.get(item.Id)
    if (entry?.file) return fs.statSync(entry.file).size
    return item.MediaSources?.[0]?.Size || 1_000_000
  }
  const contentType = (item) => {
    const c = String(item.MediaSources?.[0]?.Container || item.Container || 'mkv')
    return c.includes('mp4') ? 'video/mp4' : c.includes('mkv') || c.includes('matroska') ? 'video/x-matroska' : 'application/octet-stream'
  }

  function serveStream(req, res, item) {
    const size = sizeOf(item)
    const headers = {
      'content-type': contentType(item),
      'accept-ranges': 'bytes',
      'last-modified': 'Tue, 20 Oct 2026 19:20:50 GMT',
      server: 'Kestrel'
    }
    let start = 0
    let end = size - 1
    let status = 200
    const m = typeof req.headers.range === 'string' ? req.headers.range.match(/^bytes=(\d*)-(\d*)$/) : null
    if (m && (m[1] !== '' || m[2] !== '')) {
      if (m[1] === '') {
        start = Math.max(0, size - Number(m[2]))
      } else {
        start = Number(m[1])
        if (m[2] !== '') end = Math.min(end, Number(m[2]))
      }
      if (start >= size || start > end) {
        res.writeHead(416, { ...headers, 'content-range': `bytes */${size}`, 'content-length': '0' })
        return res.end()
      }
      status = 206
      headers['content-range'] = `bytes ${start}-${end}/${size}`
    }
    headers['content-length'] = String(end - start + 1)
    res.writeHead(status, headers)
    if (req.method === 'HEAD') return res.end()

    state.activeStreams++
    let ended = false
    const finish = (early) => {
      if (ended) return
      ended = true
      state.activeStreams--
      if (early) state.streamsClosedEarly++
      else state.streamsFinished++
    }
    res.on('close', () => finish(!res.writableFinished))
    const entry = media.get(item.Id)
    if (entry?.file) {
      const stream = fs.createReadStream(entry.file, { start, end })
      stream.pipe(res)
      res.on('close', () => stream.destroy())
    } else {
      // synthetic bytes, throttled (so an abort is observable), 64 KB per tick
      let pos = start
      const tick = () => {
        if (ended || res.destroyed) return
        const to = Math.min(end, pos + 65535)
        const ok = res.write(syntheticBytes(pos, to))
        pos = to + 1
        if (pos > end) return res.end()
        if (ok) setTimeout(tick, entry?.tickMs ?? 2)
        else res.once('drain', tick)
      }
      tick()
    }
  }

  /* ---- the HTTP handler ---- */
  const json = (res, status, body, headers = {}) => {
    const text = JSON.stringify(body)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), ...headers })
    res.end(text)
  }
  const plain = (res, status, text = 'Error processing request.') => {
    res.writeHead(status, { 'content-type': 'text/plain', 'content-length': Buffer.byteLength(text) })
    res.end(text)
  }
  const problem = (res, status) =>
    json(res, status, { type: 'https://tools.ietf.org/html/rfc9110#section-15.5.5', title: status === 404 ? 'Not Found' : 'Error', status, traceId: '00-test-00' })
  const readBody = (req) =>
    new Promise((resolve) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'))
        } catch {
          resolve(null)
        }
      })
    })

  function authToken(req) {
    const header = req.headers.authorization
    if (typeof header !== 'string' || !header.startsWith('MediaBrowser ')) return null
    const m = header.match(/Token="([^"]*)"/)
    return m ? m[1] : null
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://mock')
    const p = url.pathname
    const q = url.searchParams
    const qs = (name) => q.get(name) ?? q.get(name[0].toLowerCase() + name.slice(1))
    requests.push({ method: req.method, path: p, query: Object.fromEntries(url.searchParams), headers: { ...req.headers } })

    // injected behaviours
    for (const rule of rules) {
      if (!rule.match.test(`${req.method} ${req.url}`)) continue
      if (rule.times !== undefined && rule.times <= 0) continue
      if (rule.times !== undefined) rule.times--
      if (rule.hang) return // never answers
      if (rule.delayMs) await sleep(rule.delayMs)
      if (rule.status) return rule.body !== undefined ? json(res, rule.status, rule.body) : plain(res, rule.status)
    }

    if (req.method === 'GET' && /^\/System\/Info\/Public\/?$/i.test(p)) return json(res, 200, publicInfo)
    if (req.method === 'GET' && p === '/health') return plain(res, 200, 'Healthy')

    if (req.method === 'POST' && p === '/Users/AuthenticateByName') {
      const body = await readBody(req)
      if (state.rejectLogins || !body || body.Username !== user || body.Pw !== password) return plain(res, 401)
      const token = crypto.randomBytes(16).toString('hex')
      tokens.add(token)
      return json(res, 200, { ...authGolden, AccessToken: token })
    }

    // everything else needs a valid token in the Authorization header (and nothing else works)
    const token = authToken(req)
    if (!token || !tokens.has(token)) {
      res.writeHead(401, { 'content-length': '0' })
      return res.end()
    }

    if (req.method === 'POST' && p === '/Sessions/Logout') {
      tokens.delete(token)
      state.sessionsLoggedOut++
      res.writeHead(204)
      return res.end()
    }

    // ---- lists
    if (req.method === 'GET' && p === '/Items') {
      let list
      const ids = qs('ids')
      if (ids) {
        list = ids
          .split(',')
          .map((id) => items.get(id.replace(/-/g, '').toLowerCase()))
          .filter(Boolean)
      } else {
        const types = (qs('IncludeItemTypes') || '').split(',').filter(Boolean)
        list = all().filter((i) => (types.length ? types.includes(i.Type) : true))
        const idx = qs('indexNumber')
        if (idx !== null) list = list.filter((i) => i.IndexNumber === Number(idx))
        if (/IsPlayed/i.test(qs('Filters') || '')) list = list.filter((i) => ud(i.Id).Played)
        if (qs('isFavorite') === 'true') list = list.filter((i) => ud(i.Id).IsFavorite)
        const sort = qs('SortBy')
        if (sort === 'DatePlayed') {
          list.sort((a, b) => Date.parse(ud(b.Id).LastPlayedDate || 0) - Date.parse(ud(a.Id).LastPlayedDate || 0))
          if (qs('SortOrder') === 'Ascending') list.reverse()
        } else {
          list.sort((a, b) => String(a.SortName || a.Name).toLowerCase().localeCompare(String(b.SortName || b.Name).toLowerCase()))
        }
      }
      const start = Number(qs('StartIndex')) || 0
      const limit = Number(qs('Limit')) || list.length
      const page = list.slice(start, start + limit)
      return json(res, 200, { Items: page.map((i) => project(i, qs('Fields'))), TotalRecordCount: list.length, StartIndex: start })
    }

    let m
    if (req.method === 'GET' && (m = p.match(/^\/Items\/([0-9a-f-]+)$/i))) {
      const item = items.get(m[1].replace(/-/g, '').toLowerCase())
      // the real full item has every field the list shapes can have
      if (!item) return problem(res, 404)
      return json(res, 200, project(item, 'MediaSources,Overview,Genres,Width,Height,DateCreated,ChildCount,RecursiveItemCount,Path', { stale: true }))
    }

    if (req.method === 'GET' && (m = p.match(/^\/Shows\/([0-9a-f]{32})\/(Seasons|Episodes)$/i))) {
      const series = items.get(m[1].toLowerCase())
      if (!series || series.Type !== 'Series') return problem(res, 404)
      let list = m[2] === 'Seasons' ? seasonsOf(series.Id) : episodesOf(series.Id)
      const seasonId = qs('seasonId')
      if (seasonId) list = list.filter((e) => e.SeasonId === seasonId)
      return json(res, 200, { Items: list.map((i) => project(i, qs('Fields'))), TotalRecordCount: list.length, StartIndex: 0 })
    }

    if (req.method === 'GET' && (p === '/UserItems/Resume' || p === `/Users/${userId}/Items/Resume`)) {
      const limit = Number(qs('Limit')) || 50
      const list = all()
        .filter((i) => (i.Type === 'Movie' || i.Type === 'Episode') && ud(i.Id).PlaybackPositionTicks > 0 && !ud(i.Id).Played)
        .sort((a, b) => Date.parse(ud(b.Id).LastPlayedDate) - Date.parse(ud(a.Id).LastPlayedDate))
        .slice(0, limit)
      return json(res, 200, { Items: list.map((i) => project(i, qs('Fields'))), TotalRecordCount: list.length, StartIndex: 0 })
    }

    if (req.method === 'GET' && p === '/Shows/NextUp') {
      const limit = Number(qs('Limit')) || 50
      const picks = []
      for (const series of all().filter((i) => i.Type === 'Series')) {
        const eps = episodesOf(series.Id)
        const touched = eps.filter((e) => ud(e.Id).Played || ud(e.Id).PlaybackPositionTicks > 0)
        if (!touched.length) continue
        const last = touched.reduce((a, b) => (Date.parse(ud(b.Id).LastPlayedDate || 0) > Date.parse(ud(a.Id).LastPlayedDate || 0) ? b : a))
        const inProgress = eps.find((e) => ud(e.Id).PlaybackPositionTicks > 0 && !ud(e.Id).Played)
        const lastPlayedIdx = Math.max(...eps.map((e, i) => (ud(e.Id).Played ? i : -1)))
        const next = inProgress || eps.slice(lastPlayedIdx + 1).find((e) => !ud(e.Id).Played)
        if (next) picks.push({ next, at: Date.parse(ud(last.Id).LastPlayedDate || 0) })
      }
      picks.sort((a, b) => b.at - a.at)
      const list = picks.slice(0, limit).map((x) => x.next)
      return json(res, 200, { Items: list.map((i) => project(i, qs('Fields'))), TotalRecordCount: list.length, StartIndex: 0 })
    }

    // ---- user data
    if ((m = p.match(/^\/(?:UserPlayedItems|Users\/[0-9a-f]+\/PlayedItems)\/([0-9a-f-]+)$/i)) && (req.method === 'POST' || req.method === 'DELETE')) {
      const item = items.get(m[1].replace(/-/g, '').toLowerCase())
      if (!item) return problem(res, 404)
      return json(res, 200, markPlayed(item, req.method === 'POST'))
    }
    if ((m = p.match(/^\/(?:UserFavoriteItems|Users\/[0-9a-f]+\/FavoriteItems)\/([0-9a-f-]+)$/i)) && (req.method === 'POST' || req.method === 'DELETE')) {
      const item = items.get(m[1].replace(/-/g, '').toLowerCase())
      if (!item) return problem(res, 404)
      ud(item.Id).IsFavorite = req.method === 'POST'
      staleItemData.set(item.Id, userDataOf(item))
      return json(res, 200, userDataOf(item))
    }

    // ---- playback reporting
    if (req.method === 'POST' && (m = p.match(/^\/Sessions\/Playing(\/Progress|\/Stopped)?$/))) {
      const body = await readBody(req)
      if (!body || typeof body.ItemId !== 'string' || !/^[0-9a-f-]{32,36}$/i.test(body.ItemId)) return json(res, 400, { title: 'One or more validation errors occurred.', status: 400 })
      state.playback.push({ kind: m[1] ? m[1].slice(1) : 'Start', body })
      const item = items.get(body.ItemId.replace(/-/g, '').toLowerCase())
      if (item) {
        const d = ud(item.Id)
        const ticks = Number.isFinite(body.PositionTicks) ? body.PositionTicks : null
        if (!m[1]) {
          d.PlayCount++
          d.LastPlayedDate = new Date().toISOString()
        } else if (m[1] === '/Progress') {
          if (ticks !== null) d.PlaybackPositionTicks = ticks
          d.LastPlayedDate = new Date().toISOString()
        } else {
          if (ticks !== null) updatePlayState(item, ticks)
          else {
            d.PlayCount++
            d.Played = true
            d.PlaybackPositionTicks = 0
          }
          d.LastPlayedDate = new Date().toISOString()
        }
        staleItemData.set(item.Id, userDataOf(item))
      }
      res.writeHead(204)
      return res.end()
    }

    // ---- images
    if (req.method === 'GET' && (m = p.match(/^\/Items\/([0-9a-f-]+)\/Images\/(\w+)$/i))) {
      const item = items.get(m[1].replace(/-/g, '').toLowerCase())
      if (!item) return problem(res, 404)
      const type = m[2]
      if (!['Primary', 'Backdrop', 'Thumb', 'Logo'].includes(type)) return json(res, 400, { title: 'One or more validation errors occurred.', status: 400 })
      const has = type === 'Backdrop' ? item.BackdropImageTags?.length > 0 : !!item.ImageTags?.[type]
      if (!has) return json(res, 404, `${item.Name} does not have an image of type ${type}`)
      res.writeHead(200, {
        'content-type': 'image/jpeg',
        'content-length': FAKE_JPEG.length,
        'cache-control': 'public',
        'last-modified': 'Tue, 20 Oct 2026 19:39:44 GMT',
        'x-mock-maxwidth': q.get('maxWidth') || ''
      })
      return res.end(FAKE_JPEG)
    }

    // ---- video bytes and subtitles
    if ((req.method === 'GET' || req.method === 'HEAD') && (m = p.match(/^\/Videos\/([0-9a-f-]+)\/stream(?:\.\w+)?$/i))) {
      const item = items.get(m[1].replace(/-/g, '').toLowerCase())
      if (!item || !VIDEO(item)) return plain(res, 404, '')
      return serveStream(req, res, item)
    }
    if (req.method === 'GET' && (m = p.match(/^\/Videos\/([0-9a-f-]+)\/([0-9a-f-]+)\/Subtitles\/(\d+)\/(?:\d+\/)?Stream\.(vtt|srt)$/i))) {
      const item = items.get(m[1].replace(/-/g, '').toLowerCase())
      if (!item) return plain(res, 400)
      const index = Number(m[3])
      const stream = item.MediaSources?.[0]?.MediaStreams?.find((s) => s.Index === index)
      if (!stream || stream.Type !== 'Subtitle' || !stream.IsTextSubtitleStream) return plain(res, 500)
      const custom = subtitleTexts.get(`${item.Id}|${index}`)
      const text =
        custom ??
        (stream.IsExternal ? goldenText('subtitle-external-por.vtt') : stream.Codec === 'mov_text' ? goldenText('subtitle-movtext-eng.vtt') : goldenText('subtitle-embedded-eng.vtt'))
      res.writeHead(200, { 'content-type': 'text/vtt', 'content-length': Buffer.byteLength(text) })
      return res.end(text)
    }

    res.writeHead(404, { 'content-length': '0' })
    res.end()
  }

  const VIDEO = (item) => item.Type === 'Movie' || item.Type === 'Episode'

  const server = tls ? https.createServer({ key: tls.key, cert: tls.cert }, handler) : http.createServer(handler)
  const sockets = new Set()
  server.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const url = `${tls ? 'https' : 'http'}://127.0.0.1:${port}`

  // ids of the golden items by name, for the tests
  const byName = (name) => all().find((i) => i.Name === name || i.Name.startsWith(name))
  return {
    url,
    port,
    state,
    userId,
    user,
    password,
    requests,
    rules,
    items,
    byName,
    ids: {
      testMovie: byName('Test Movie').Id,
      secondMovie: byName('Second Movie').Id,
      hevcMovie: byName('Hevc Movie').Id,
      oddLayout: byName('Odd Layout').Id,
      coverMovie: byName('Cover Movie').Id,
      testShow: all().find((i) => i.Type === 'Series' && i.Name === 'Test Show').Id,
      shortShow: all().find((i) => i.Type === 'Series' && i.Name === 'Short Show').Id
    },
    episode: (series, season, number) =>
      episodesOf(all().find((i) => i.Type === 'Series' && i.Name === series).Id).find((e) => e.ParentIndexNumber === season && e.IndexNumber === number),
    userDataOf: (id) => userDataOf(items.get(id)),
    // simulation switches
    slow: (match, delayMs, times) => rules.push({ match, delayMs, times }),
    hang: (match, times) => rules.push({ match, hang: true, times }),
    fail: (match, status, times, body) => rules.push({ match, status, times, body }),
    clearRules: () => (rules.length = 0),
    revokeTokens: () => tokens.clear(),
    useFile(id, file, tickMs) {
      media.set(id, { file, tickMs })
    },
    // a throttled synthetic video of `size` bytes (for abort tests)
    useSynthetic(id, size, tickMs = 5) {
      items.get(id).MediaSources[0].Size = size
      media.set(id, { tickMs })
    },
    setSubtitle(id, index, vtt) {
      subtitleTexts.set(`${id}|${index}`, vtt)
    },
    // add an item built from the Test Movie template (streams given or derived by the caller)
    addMovie(patch) {
      const base = clone(golden('item-test-movie.json'))
      const id = patch.Id || hex(`added-${items.size}-${Math.random()}`)
      const movie = { ...base, ...patch, Id: id }
      movie.MediaSources = (patch.MediaSources || base.MediaSources).map((ms) => ({ ...ms, Id: id }))
      items.set(id, movie)
      return movie
    },
    sockets: () => sockets.size,
    // cut every open connection (a server that dies mid-download)
    dropConnections() {
      for (const s of sockets) s.destroy()
    },
    async close() {
      for (const s of sockets) s.destroy()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}
