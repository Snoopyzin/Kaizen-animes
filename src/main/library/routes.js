// The Express router mounted at /library (spec section 5). Every route needs the per-run secret.
import crypto from 'crypto'
import express from 'express'
import { ApiError, sendError, toApiError } from './errors.js'
import { normalizeId } from './mapper.js'

const MAX_BODY = 8 * 1024
const MAX_IDS_BODY = 64 * 1024
const MAX_IDS = 500
const IMAGE_TYPES = { primary: 'Primary', backdrop: 'Backdrop', thumb: 'Thumb' }

const single = (value) => (typeof value === 'string' ? value : undefined)
const finite = (value) => typeof value === 'number' && Number.isFinite(value)

export function createLibraryRouter({ service, tracks, proxies, token, log = () => {} }) {
  const router = express.Router()
  const expected = crypto.createHash('sha256').update(String(token)).digest()

  // constant-time comparison (hashing first makes the length irrelevant)
  const tokenOk = (candidate) =>
    typeof candidate === 'string' &&
    candidate.length > 0 &&
    candidate.length <= 512 &&
    crypto.timingSafeEqual(crypto.createHash('sha256').update(candidate).digest(), expected)

  // async handler -> errors become JSON; unexpected ones are logged without details that could leak secrets
  const handle = (fn) => (req, res) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .catch((error) => {
        const api = toApiError(error)
        if (api.code === 'INTERNAL')
          log(`library route ${req.method} ${req.path} failed: ${error?.message}`)
        sendError(res, api)
      })
  }

  const sendJson = (res, value) => {
    res.set('Cache-Control', 'no-store')
    res.type('application/json')
    res.send(typeof value === 'string' ? value : JSON.stringify(value))
  }

  /* ---- security: token, headers, ids ---- */
  router.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff')
    const candidate = single(req.query.t) ?? single(req.headers['x-kaizen-token'])
    if (!tokenOk(candidate)) {
      res.set('Cache-Control', 'no-store')
      return res
        .status(401)
        .type('application/json')
        .send(JSON.stringify({ error: 'UNAUTHORIZED', message: 'missing or wrong token' }))
    }
    next()
  })

  router.param('id', (req, res, next, value) => {
    const id = normalizeId(value)
    if (!id) return sendError(res, new ApiError('BAD_REQUEST', 'invalid id'))
    req.itemId = id
    next()
  })

  // JSON bodies: the backend usually parsed them already (200 kb limit); ours are much smaller
  const jsonBody = (limit) => [
    express.json({ limit }),
    (req, res, next) => {
      const length = Number(req.headers['content-length'])
      const body = req.body
      if (
        (Number.isFinite(length) && length > limit) ||
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body)
      ) {
        return sendError(res, new ApiError('BAD_REQUEST', 'a JSON object body is required'))
      }
      next()
    }
  ]
  /* ---- status / index ---- */
  router.get(
    '/status',
    handle(async (req, res) => sendJson(res, service.status()))
  )

  router.get(
    '/',
    handle(async (req, res) => {
      const refresh = single(req.query.refresh)
      const { json } = await service.getIndex({ refresh: refresh === '1' || refresh === 'true' })
      sendJson(res, json)
    })
  )

  router.get(
    '/series/:id',
    handle(async (req, res) => sendJson(res, await service.getSeries(req.itemId)))
  )
  router.get(
    '/video/:id',
    handle(async (req, res) => sendJson(res, await service.getVideo(req.itemId)))
  )

  /* ---- media ---- */
  router.get(
    '/image/:id',
    handle(async (req, res) => {
      const type = IMAGE_TYPES[(single(req.query.type) ?? 'primary').toLowerCase()]
      if (!type) throw new ApiError('BAD_REQUEST', 'type must be primary, backdrop or thumb')
      const w = Number(single(req.query.w))
      const width = Number.isFinite(w) && w > 0 ? Math.min(1920, Math.max(16, Math.round(w))) : 400
      await proxies.image(req, res, req.itemId, { type, width })
    })
  )

  router.get(
    '/stream/:id',
    handle(async (req, res) => {
      await proxies.stream(req, res, req.itemId)
    })
  )

  router.get(
    '/mediainfo/:id',
    handle(async (req, res) => sendJson(res, await tracks.mediainfo(req.itemId)))
  )

  router.get(
    '/subtitles/:id',
    handle(async (req, res) => {
      const raw = single(req.query.track)
      let track
      if (raw === 'auto-pt') track = 'auto-pt'
      else if (raw !== undefined && /^\d{1,5}$/.test(raw)) track = Number(raw)
      else throw new ApiError('BAD_REQUEST', 'track must be a stream index or auto-pt')
      const from = Math.min(1e6, Math.max(0, Number(single(req.query.from)) || 0))
      const len = Math.min(600, Math.max(10, Number(single(req.query.len)) || 120))
      sendJson(res, await tracks.subtitles(req.itemId, { track, from, len }))
    })
  )

  router.get(
    '/audio/:id',
    handle(async (req, res) => {
      const raw = single(req.query.track)
      if (raw === undefined || !/^\d{1,5}$/.test(raw))
        throw new ApiError('BAD_REQUEST', 'track must be a stream index')
      const start = Math.min(1e6, Math.max(0, Number(single(req.query.start)) || 0))
      await tracks.audio(req, res, req.itemId, { track: Number(raw), start })
    })
  )

  /* ---- user data ---- */
  const STATES = new Set(['start', 'progress', 'pause', 'stop'])
  router.post(
    '/progress/:id',
    jsonBody(MAX_BODY),
    handle(async (req, res) => {
      const { position, duration, state = 'progress' } = req.body
      if (!finite(position) || position < 0 || position > 1e7)
        throw new ApiError('BAD_REQUEST', 'position must be a number of seconds')
      if (duration !== undefined && (!finite(duration) || duration < 0 || duration > 1e7)) {
        throw new ApiError('BAD_REQUEST', 'duration must be a number of seconds')
      }
      if (typeof state !== 'string' || !STATES.has(state))
        throw new ApiError('BAD_REQUEST', 'unknown state')
      sendJson(res, await service.reportProgress(req.itemId, { position, duration, state }))
    })
  )

  router.post(
    '/watched',
    jsonBody(MAX_IDS_BODY),
    handle(async (req, res) => {
      const { ids, watched } = req.body
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_IDS) {
        throw new ApiError('BAD_REQUEST', `ids must be a list of 1 to ${MAX_IDS} item ids`)
      }
      if (typeof watched !== 'boolean')
        throw new ApiError('BAD_REQUEST', 'watched must be true or false')
      const clean = ids.map(normalizeId)
      if (clean.some((id) => !id)) throw new ApiError('BAD_REQUEST', 'invalid id in ids')
      sendJson(res, await service.setWatched([...new Set(clean)], watched))
    })
  )

  router.post(
    '/favorite',
    jsonBody(MAX_BODY),
    handle(async (req, res) => {
      const { id: rawId, favorite } = req.body
      const id = normalizeId(rawId)
      if (!id) throw new ApiError('BAD_REQUEST', 'invalid id')
      if (typeof favorite !== 'boolean')
        throw new ApiError('BAD_REQUEST', 'favorite must be true or false')
      sendJson(res, await service.setFavorite(id, favorite))
    })
  )

  router.use((req, res) => sendError(res, new ApiError('NOT_FOUND', 'no such route')))
  // express.json reports malformed / oversized JSON as errors; anything else that slipped through is
  // answered without its text
  router.use((error, req, res, next) => {
    void next
    if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
      return sendError(res, new ApiError('BAD_REQUEST', 'invalid JSON body'))
    }
    log(`library router error: ${error?.message}`)
    sendError(res, new ApiError('INTERNAL', 'internal error'))
  })

  return router
}
