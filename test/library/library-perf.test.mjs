// A 5,000-title library: paged fetching, a compact index, and a fast answer from the cache.
import test from 'node:test'
import assert from 'node:assert/strict'
import { startMockJellyfin } from './mock-jellyfin.mjs'
import { startBackend } from './helpers.mjs'

let mock
let b
test.before(async () => {
  mock = await startMockJellyfin({ bigCatalog: 2500 }) // 2,500 movies + 2,500 series (+ the golden ones)
  b = await startBackend({ mock })
})
test.after(async () => {
  await b.close()
  await mock.close()
})

test('5,000 titles: the first index is built from 500-item pages, the next ones come from the cache in < 1.5 s', async () => {
  const t0 = Date.now()
  const first = await b.json('/')
  const cold = Date.now() - t0
  assert.equal(first.status, 200)
  assert.equal(first.json.movies.length, 2505)
  assert.equal(first.json.series.length, 2502)
  assert.equal(first.json.counts.movies + first.json.counts.series, 5007)
  assert.ok(cold < 15000, `cold build took ${cold} ms`)

  const pages = mock.requests.filter((r) => r.path === '/Items' && r.query.IncludeItemTypes === 'Movie')
  assert.equal(pages.length, 6, '2,505 movies = 6 pages of 500')
  assert.deepEqual(pages.map((p) => p.query.StartIndex).sort((x, y) => Number(x) - Number(y)), ['0', '500', '1000', '1500', '2000', '2500'])
  assert.ok(pages.every((p) => p.query.Limit === '500'))
  const seriesPages = mock.requests.filter((r) => r.path === '/Items' && r.query.IncludeItemTypes === 'Series')
  assert.equal(seriesPages.length, 6)

  const upstreamBefore = mock.requests.length
  const times = []
  for (let i = 0; i < 5; i++) {
    const t = Date.now()
    const r = await b.api('/')
    const text = await r.text()
    times.push(Date.now() - t)
    assert.equal(r.status, 200)
    assert.ok(text.length > 100000)
  }
  assert.equal(mock.requests.length, upstreamBefore, 'no upstream traffic while cached')
  assert.ok(Math.max(...times) < 1500, `cached answers took ${times.join(', ')} ms`)
  console.log(`# 5,000 titles: cold ${cold} ms, cached ${times.join('/')} ms`)
})

test('the index stays compact: ~300 bytes per title, no overviews, sorted by title', async () => {
  const r = await b.api('/')
  const text = await r.text()
  assert.ok(text.length / 5007 < 420, `${Math.round(text.length / 5007)} bytes per title`)
  assert.equal(/overview/i.test(text), false)
  const index = JSON.parse(text)
  const titles = index.movies.map((m) => m.title)
  const sorted = [...titles].sort((x, y) => x.localeCompare(y, 'und', { sensitivity: 'base', numeric: true }))
  assert.deepEqual(titles, sorted)
  assert.equal(titles[0], 'Cover Movie')
  assert.equal(index.movies.at(-1).title, 'Test Movie')
})

test('simultaneous requests on a big catalog still make one upstream round', async () => {
  b.library.service.invalidate()
  const start = mock.requests.filter((r) => r.path === '/Items' && r.query.IncludeItemTypes === 'Movie').length
  const results = await Promise.all(Array.from({ length: 12 }, () => b.json('/')))
  assert.ok(results.every((r) => r.status === 200))
  assert.equal(new Set(results.map((r) => r.json.fetchedAt)).size, 1)
  assert.equal(mock.requests.filter((r) => r.path === '/Items' && r.query.IncludeItemTypes === 'Movie').length - start, 6)
})
