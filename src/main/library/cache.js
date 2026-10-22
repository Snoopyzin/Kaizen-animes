// Small bounded caches and concurrency helpers used by the library backend. Electron-free.

// Map with a size bound (least recently used goes first) and a time-to-live per entry.
// `now` is injectable so tests do not have to wait.
export function createCache({ max = 100, ttlMs = 60000, now = Date.now } = {}) {
  const map = new Map() // key -> { value, expires }

  function get(key) {
    const hit = map.get(key)
    if (!hit) return undefined
    if (hit.expires <= now()) {
      map.delete(key)
      return undefined
    }
    // refresh the recency
    map.delete(key)
    map.set(key, hit)
    return hit.value
  }

  function set(key, value, ttl = ttlMs) {
    map.delete(key)
    map.set(key, { value, expires: now() + ttl })
    while (map.size > max) map.delete(map.keys().next().value)
    return value
  }

  return {
    get,
    set,
    has: (key) => get(key) !== undefined,
    delete: (key) => map.delete(key),
    clear: () => map.clear(),
    get size() {
      return map.size
    }
  }
}

// Runs `make()` once per key at a time: concurrent callers share the same promise. The promise is
// forgotten when it settles (a failed call can be retried by the next caller).
export function createSingleFlight() {
  const inflight = new Map()
  return {
    run(key, make) {
      const running = inflight.get(key)
      if (running) return running
      const promise = (async () => make())().finally(() => {
        if (inflight.get(key) === promise) inflight.delete(key)
      })
      inflight.set(key, promise)
      return promise
    },
    clear: () => inflight.clear(),
    get size() {
      return inflight.size
    }
  }
}

// Cache + single flight: `load(key, make)` returns the cached value or makes it once.
export function createLoader({ max = 100, ttlMs = 60000, now } = {}) {
  const cache = createCache({ max, ttlMs, now })
  const flights = createSingleFlight()
  let generation = 0
  return {
    cache,
    load(key, make, ttl) {
      const hit = cache.get(key)
      if (hit !== undefined) return Promise.resolve(hit)
      return flights.run(key, async () => {
        const started = generation
        const value = await make()
        // a clear() while this was running (new connection, mutation) makes the value stale
        if (started === generation) cache.set(key, value, ttl)
        return value
      })
    },
    // drop everything; calls already in flight finish but their results are not stored
    clear() {
      generation++
      cache.clear()
      flights.clear()
    }
  }
}

// Counts concurrent jobs: tryAcquire() -> release function, or null when `max` are already running.
export function createLimiter(max) {
  let active = 0
  return {
    tryAcquire() {
      if (active >= max) return null
      active++
      let released = false
      return () => {
        if (released) return
        released = true
        active--
      }
    },
    get active() {
      return active
    }
  }
}

// Runs `worker(item)` for every item with at most `limit` in flight; keeps the order of the results.
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  async function lane() {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
  return results
}
