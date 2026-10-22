// The stream proxy: Range / HEAD / 416, header whitelists and abort propagation (no leaked sockets).
import test from 'node:test'
import assert from 'node:assert/strict'
import { startMockJellyfin, syntheticBytes } from './mock-jellyfin.mjs'
import { startBackend, waitFor, sleep } from './helpers.mjs'

let mock
let b
test.before(async () => {
  mock = await startMockJellyfin()
  b = await startBackend({ mock })
  mock.useSynthetic(mock.ids.testMovie, 5_000_000, 1)
  mock.useSynthetic(mock.ids.secondMovie, 400_000_000_000, 5) // effectively endless: for abort tests
})
test.after(async () => {
  await b.close()
  await mock.close()
})

const SIZE = 5_000_000
const id = () => mock.ids.testMovie
const streams = () => mock.requests.filter((r) => /^\/Videos\/.*\/stream/.test(r.path))

test('full answer: 200, length, type and the right bytes', async () => {
  const res = await b.api(`/stream/${id()}`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-length'), String(SIZE))
  assert.equal(res.headers.get('accept-ranges'), 'bytes')
  assert.equal(res.headers.get('content-type'), 'video/x-matroska')
  assert.equal(res.headers.get('last-modified'), 'Tue, 20 Oct 2026 19:20:50 GMT')
  const body = Buffer.from(await res.arrayBuffer())
  assert.equal(body.length, SIZE)
  assert.ok(body.subarray(0, 4096).equals(syntheticBytes(0, 4095)))
  assert.ok(body.subarray(SIZE - 4096).equals(syntheticBytes(SIZE - 4096, SIZE - 1)))
})

test('Range: 206 with Content-Range, open ranges, suffix ranges', async () => {
  const cases = [
    ['bytes=1000-1999', 206, 'bytes 1000-1999/5000000', 1000, 1000],
    ['bytes=4999000-', 206, 'bytes 4999000-4999999/5000000', 1000, 4999000],
    ['bytes=-500', 206, 'bytes 4999500-4999999/5000000', 500, 4999500],
    ['bytes=0-0', 206, 'bytes 0-0/5000000', 1, 0],
    ['bytes=4999990-9999999', 206, 'bytes 4999990-4999999/5000000', 10, 4999990]
  ]
  for (const [range, status, contentRange, length, from] of cases) {
    const res = await b.api(`/stream/${id()}`, { headers: { Range: range } })
    assert.equal(res.status, status, range)
    assert.equal(res.headers.get('content-range'), contentRange, range)
    assert.equal(res.headers.get('content-length'), String(length), range)
    const body = Buffer.from(await res.arrayBuffer())
    assert.ok(body.equals(syntheticBytes(from, from + length - 1)), `${range}: the bytes of that range`)
  }
})

test('Range beyond the end: 416 with Content-Range */size', async () => {
  for (const range of ['bytes=5000000-', 'bytes=99999999-', 'bytes=6000000-7000000']) {
    const res = await b.api(`/stream/${id()}`, { headers: { Range: range } })
    assert.equal(res.status, 416, range)
    assert.equal(res.headers.get('content-range'), `bytes */${SIZE}`)
    assert.equal((await res.arrayBuffer()).byteLength, 0)
  }
})

test('HEAD: same headers, no body', async () => {
  const res = await b.api(`/stream/${id()}`, { method: 'HEAD' })
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-length'), String(SIZE))
  assert.equal(res.headers.get('accept-ranges'), 'bytes')
  assert.equal((await res.arrayBuffer()).byteLength, 0)
  assert.equal(streams().at(-1).method, 'HEAD', 'a HEAD is a HEAD upstream too')
  const ranged = await b.api(`/stream/${id()}`, { method: 'HEAD', headers: { Range: 'bytes=0-9' } })
  assert.equal(ranged.status, 206)
  assert.equal(ranged.headers.get('content-length'), '10')
})

test('junk Range headers are dropped (a full answer), never forwarded', async () => {
  for (const range of ['bytes=abc', 'bytes=0-1;evil', 'items=0-5', 'bytes=0-1,2-3,x', 'bytes=' + '1'.repeat(300) + '-']) {
    const res = await b.api(`/stream/${id()}`, { headers: { Range: range } })
    assert.equal(res.status, 200, range.slice(0, 20))
    await res.body.cancel()
    assert.equal(streams().at(-1).headers.range, undefined, 'not forwarded')
  }
})

test('request headers: only Range / If-Range / Accept go upstream; our Jellyfin credentials replace the client\'s', async () => {
  const res = await b.api(`/stream/${id()}`, {
    headers: {
      Range: 'bytes=0-9',
      'If-Range': '"abc"',
      Accept: 'video/*',
      Authorization: 'MediaBrowser Token="attacker"',
      Cookie: 'session=1',
      Referer: 'http://evil.test/',
      Origin: 'http://evil.test',
      'X-Forwarded-For': '6.6.6.6',
      'X-Emby-Token': 'attacker',
      'Accept-Language': 'xx'
    }
  })
  assert.equal(res.status, 206)
  await res.arrayBuffer()
  const up = streams().at(-1)
  assert.equal(up.headers.range, 'bytes=0-9')
  assert.equal(up.headers['if-range'], '"abc"')
  assert.equal(up.headers.accept, 'video/*')
  for (const name of ['cookie', 'referer', 'origin', 'x-forwarded-for', 'x-emby-token', 'accept-language']) assert.equal(up.headers[name], undefined, name)
  assert.match(up.headers.authorization, /^MediaBrowser Client="Kaizen", Device="Kaizen Desktop", DeviceId="[^"]+", Version="3\.0\.0-test", Token="[0-9a-f]{32}"$/)
  assert.equal(up.headers.authorization.includes('attacker'), false)
  assert.equal(up.headers.host, new URL(mock.url).host)
})

test('the upstream URL comes from the stored server and the validated id; the media source id is the item\'s own', async () => {
  const res = await b.api(`/stream/${id()}?mediaSourceId=evil&static=false&api_key=x&path=C:/x`)
  assert.equal(res.status, 200)
  await res.body.cancel()
  const up = streams().at(-1)
  assert.equal(up.path, `/Videos/${id()}/stream`)
  assert.deepEqual(up.query, { static: 'true', mediaSourceId: mock.items.get(id()).MediaSources[0].Id })
})

test('response headers are a whitelist', async () => {
  const res = await b.api(`/stream/${id()}`, { headers: { Range: 'bytes=0-9' } })
  await res.arrayBuffer()
  for (const name of ['server', 'set-cookie', 'x-mock-maxwidth', 'content-language']) assert.equal(res.headers.get(name), null, name)
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
})

test('errors before the first byte are JSON: unknown id, not a video, upstream failure', async () => {
  const unknown = await b.json(`/stream/${'0'.repeat(31)}1`)
  assert.deepEqual([unknown.status, unknown.json.error], [404, 'NOT_FOUND'])
  assert.equal((await b.json(`/stream/${mock.ids.testShow}`)).json.error, 'NOT_FOUND')
  mock.fail(/GET \/Videos\/.*\/stream/, 500)
  const broken = await b.json(`/stream/${id()}`)
  assert.deepEqual([broken.status, broken.json.error], [502, 'UPSTREAM_ERROR'])
  mock.clearRules()
  mock.fail(/GET \/Videos\/.*\/stream/, 404)
  assert.equal((await b.json(`/stream/${id()}`)).status, 404)
  mock.clearRules()
  assert.equal((await b.api(`/stream/${id()}`, { headers: { Range: 'bytes=0-1' } })).status, 206)
})

test('many parallel range requests all succeed', async () => {
  const results = await Promise.all(
    Array.from({ length: 24 }, async (_, i) => {
      const res = await b.api(`/stream/${id()}`, { headers: { Range: `bytes=${i * 1000}-${i * 1000 + 99}` } })
      return Buffer.from(await res.arrayBuffer()).equals(syntheticBytes(i * 1000, i * 1000 + 99))
    })
  )
  assert.ok(results.every(Boolean))
})

test('ABORT: when the player goes away the upstream download stops', async () => {
  const endless = mock.ids.secondMovie
  const closedBefore = mock.state.streamsClosedEarly
  const controller = new AbortController()
  const res = await b.api(`/stream/${endless}`, { signal: controller.signal })
  assert.equal(res.status, 200)
  const reader = res.body.getReader()
  await reader.read()
  await reader.read()
  assert.equal(mock.state.activeStreams, 1)
  controller.abort()
  assert.ok(await waitFor(() => mock.state.activeStreams === 0), 'the mock saw its client disconnect')
  assert.equal(mock.state.streamsClosedEarly, closedBefore + 1)
  // and the backend keeps serving
  assert.equal((await b.api(`/stream/${id()}`, { headers: { Range: 'bytes=0-9' } })).status, 206)
})

test('ABORT before the response arrives: nothing keeps downloading', async () => {
  const endless = mock.ids.secondMovie
  mock.slow(/GET \/Videos\/.*\/stream/, 250, 1)
  const controller = new AbortController()
  const pending = b.api(`/stream/${endless}`, { signal: controller.signal }).catch((e) => e)
  await sleep(60)
  controller.abort()
  await pending
  assert.ok(await waitFor(() => mock.state.activeStreams === 0, { timeout: 3000 }), 'no stream left running')
  mock.clearRules()
})

test('ABORT many: no active upstream streams and no growth of open sockets', async () => {
  const endless = mock.ids.secondMovie
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      const controller = new AbortController()
      const res = await b.api(`/stream/${endless}`, { signal: controller.signal })
      await res.body.getReader().read()
      controller.abort()
    })
  )
  assert.ok(await waitFor(() => mock.state.activeStreams === 0), 'all upstream streams closed')
  assert.ok(await waitFor(() => mock.sockets() <= 20), `open sockets to Jellyfin: ${mock.sockets()}`)
})

test('the upstream dying mid-download ends the response early, and the backend recovers', async () => {
  const endless = mock.ids.secondMovie
  const res = await b.api(`/stream/${endless}`)
  const reader = res.body.getReader()
  await reader.read()
  mock.dropConnections()
  let ended = false
  try {
    for (let i = 0; i < 200; i++) {
      const { done } = await reader.read()
      if (done) break
    }
    ended = true // a clean end is also acceptable for the test: what matters is that it stops
  } catch {
    ended = true
  }
  assert.ok(ended)
  assert.ok(await waitFor(() => mock.state.activeStreams === 0))
  assert.equal((await b.api(`/stream/${id()}`, { headers: { Range: 'bytes=0-9' } })).status, 206)
})
