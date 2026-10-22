// Stream and image proxies. The upstream URL is built from the stored server plus a validated item id
// (never from the request); request and response headers pass through whitelists; the upstream request
// is destroyed the moment the local client goes away.
import { pipeline } from 'stream'
import { ApiError } from './errors.js'

const RANGE = /^bytes=\d*-\d*(?:\s*,\s*\d*-\d*)*$/

// the only request headers that reach Jellyfin (the client's Authorization / cookies never do)
export function upstreamHeaders(requestHeaders) {
  const headers = {}
  const range = requestHeaders.range
  if (typeof range === 'string' && range.length <= 200 && RANGE.test(range)) {
    headers.Range = range
    const ifRange = requestHeaders['if-range']
    if (typeof ifRange === 'string' && ifRange.length <= 100 && !/[\r\n]/.test(ifRange))
      headers['If-Range'] = ifRange
  }
  const accept = requestHeaders.accept
  if (typeof accept === 'string' && accept.length <= 200 && !/[\r\n]/.test(accept))
    headers.Accept = accept
  return headers
}

const QUIET_CLOSE = new Set(['ERR_STREAM_PREMATURE_CLOSE', 'ECONNRESET', 'ECONNABORTED', 'EPIPE'])

const STREAM_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'etag',
  'last-modified'
]

function pick(headers, names) {
  const out = {}
  for (const name of names) if (headers[name] !== undefined) out[name] = headers[name]
  return out
}

export function createProxies({ service, log = () => {} }) {
  // GET|HEAD /library/stream/:id
  async function stream(req, res, id) {
    const meta = await service.getItemMeta(id)
    const method = req.method === 'HEAD' ? 'HEAD' : 'GET'
    let gone = false
    res.on('close', () => {
      gone = true
    })
    const { req: up, res: ur } = await service.openUpstream((client) =>
      client.openStream(id, meta.mediaSourceId || id, {
        method,
        headers: upstreamHeaders(req.headers)
      })
    )
    if (gone) {
      ur.resume()
      up.destroy()
      return
    }
    const headers = pick(ur.headers, STREAM_HEADERS)
    if (!headers['content-type']) headers['content-type'] = 'application/octet-stream'
    headers['x-content-type-options'] = 'nosniff'
    res.writeHead(ur.statusCode, headers)
    if (method === 'HEAD') {
      ur.resume()
      res.end()
      return
    }
    pipeline(ur, res, (error) => {
      // client left (premature close) or upstream broke: make sure the upstream socket is gone
      // (players close range requests all the time: only unexpected failures are worth a log line)
      if (error && !QUIET_CLOSE.has(error.code))
        log(`library stream failed (${error.code || error.message})`)
      up.destroy()
    })
  }

  // GET /library/image/:id?type=primary|backdrop|thumb&w=
  async function image(req, res, id, { type, width }) {
    let gone = false
    res.on('close', () => {
      gone = true
    })
    const { req: up, res: ur } = await service.openUpstream((client) =>
      client.openImage(id, type, { width })
    )
    const contentType = String(ur.headers['content-type'] || '')
    if (ur.statusCode !== 200 || !/^image\//i.test(contentType)) {
      ur.resume()
      up.destroy()
      throw new ApiError(ur.statusCode === 200 ? 'UPSTREAM_ERROR' : 'NOT_FOUND', 'no such image')
    }
    if (gone) {
      ur.resume()
      up.destroy()
      return
    }
    const headers = pick(ur.headers, ['content-type', 'content-length', 'last-modified', 'etag'])
    headers['cache-control'] = 'private, max-age=86400'
    headers['x-content-type-options'] = 'nosniff'
    res.writeHead(200, headers)
    pipeline(ur, res, () => up.destroy())
  }

  return { stream, image }
}
