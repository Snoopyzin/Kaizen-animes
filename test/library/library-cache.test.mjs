import test from 'node:test'
import assert from 'node:assert/strict'
import { createCache, createLimiter, createLoader, createSingleFlight, mapLimit } from '../../src/main/library/cache.js'

test('cache: TTL expiry and least-recently-used eviction', () => {
  let t = 0
  const cache = createCache({ max: 3, ttlMs: 100, now: () => t })
  cache.set('a', 1)
  cache.set('b', 2)
  cache.set('c', 3)
  assert.equal(cache.get('a'), 1) // a is now the most recent
  cache.set('d', 4) // evicts b (the least recently used)
  assert.equal(cache.get('b'), undefined)
  assert.deepEqual([cache.get('a'), cache.get('c'), cache.get('d')], [1, 3, 4])
  assert.equal(cache.size, 3)
  t = 99
  assert.equal(cache.get('a'), 1)
  t = 101
  assert.equal(cache.get('a'), undefined, 'expired')
  assert.equal(cache.size, 2)
  cache.set('x', 1, 10) // per-entry ttl
  t = 112
  assert.equal(cache.get('x'), undefined)
  cache.clear()
  assert.equal(cache.size, 0)
  assert.equal(cache.has('c'), false)
})

test('single flight: concurrent callers share one run; a failure is not remembered', async () => {
  const flights = createSingleFlight()
  let runs = 0
  const make = async () => {
    runs++
    await new Promise((r) => setTimeout(r, 20))
    return runs
  }
  const results = await Promise.all(Array.from({ length: 10 }, () => flights.run('k', make)))
  assert.equal(runs, 1)
  assert.deepEqual(new Set(results), new Set([1]))
  assert.equal(flights.size, 0)
  assert.equal(await flights.run('k', make), 2, 'a finished flight is forgotten')

  let attempts = 0
  const flaky = async () => {
    attempts++
    if (attempts === 1) throw new Error('boom')
    return 'ok'
  }
  await assert.rejects(flights.run('f', flaky), /boom/)
  assert.equal(await flights.run('f', flaky), 'ok')
  // a synchronous throw inside make() is a rejection too
  await assert.rejects(flights.run('s', () => { throw new Error('sync') }), /sync/)
})

test('loader: caches, shares in-flight work, and drops results that were cleared meanwhile', async () => {
  let t = 0
  const loader = createLoader({ max: 5, ttlMs: 1000, now: () => t })
  let runs = 0
  const make = async () => {
    runs++
    await new Promise((r) => setTimeout(r, 15))
    return { n: runs }
  }
  const [a, b] = await Promise.all([loader.load('k', make), loader.load('k', make)])
  assert.equal(a, b)
  assert.equal(runs, 1)
  assert.equal(await loader.load('k', make), a, 'served from the cache')
  assert.equal(runs, 1)
  t = 1001
  assert.notEqual(await loader.load('k', make), a, 'expired')
  assert.equal(runs, 2)

  // clear() while a load is running: its (stale) result is returned to its caller but never cached
  const slow = loader.load('s', async () => {
    await new Promise((r) => setTimeout(r, 30))
    return 'old'
  })
  loader.clear()
  assert.equal(await slow, 'old')
  assert.equal(await loader.load('s', async () => 'new'), 'new')
})

test('limiter: at most N at once, release frees a slot (and only once)', () => {
  const limiter = createLimiter(2)
  const a = limiter.tryAcquire()
  const b = limiter.tryAcquire()
  assert.equal(limiter.tryAcquire(), null)
  assert.equal(limiter.active, 2)
  a()
  a() // double release must not free a second slot
  assert.equal(limiter.active, 1)
  assert.ok(limiter.tryAcquire())
  assert.equal(limiter.tryAcquire(), null)
  b()
})

test('mapLimit: bounded concurrency, results in order', async () => {
  let running = 0
  let peak = 0
  const out = await mapLimit([5, 1, 4, 2, 3, 6, 7, 8], 3, async (n) => {
    running++
    peak = Math.max(peak, running)
    await new Promise((r) => setTimeout(r, n * 3))
    running--
    return n * 2
  })
  assert.deepEqual(out, [10, 2, 8, 4, 6, 12, 14, 16])
  assert.ok(peak <= 3 && peak >= 2)
  assert.deepEqual(await mapLimit([], 4, async () => 1), [])
})
