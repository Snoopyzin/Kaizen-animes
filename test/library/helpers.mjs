// Shared plumbing of the library tests: the real backend modules on an Express app (as main/index.js builds
// it: cors + json + the /library router), fake Electron dependencies, and a connection to a mock Jellyfin.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import cors from 'cors'
import express from 'express'
import { registerLibrary } from '../../src/main/library/index.js'
import { createJellyfinClient } from '../../src/main/library/jellyfin.js'
import { ffmpegBin, ffprobeBin } from './fixtures.mjs'

export const TOKEN = 'test-token-0123456789abcdef'

// reversible, obviously-not-plain "encryption"
export function fakeSafeStorage({ available = true } = {}) {
  const flip = (b) => Buffer.from([...b].reverse())
  return {
    available,
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.concat([Buffer.from('FAKE:'), flip(Buffer.from(s))]),
    decryptString: (b) => {
      if (b.subarray(0, 5).toString() !== 'FAKE:') throw new Error('not encrypted by this key')
      return flip(b.subarray(5)).toString()
    }
  }
}

export function fakeIpc() {
  const handlers = new Map()
  const listeners = new Map()
  return {
    on: (channel, fn) => listeners.set(channel, fn),
    handle: (channel, fn) => handlers.set(channel, fn),
    invoke: (channel, ...args) => handlers.get(channel)({}, ...args),
    sendSync(channel) {
      const event = {}
      listeners.get(channel)(event)
      return event.returnValue
    },
    channels: () => [...handlers.keys(), ...listeners.keys()].sort()
  }
}

export function tempDir(prefix = 'kaizen-lib-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

// opts: { mock, connect = true, dataDir, safeStorage, translateCues, spawn, clientOptions, maxAudio }
export async function startBackend(opts = {}) {
  const { mock, connect = true } = opts
  const dataDir = opts.dataDir || tempDir()
  const ownsDataDir = !opts.dataDir
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '200kb' }))
  const ipc = fakeIpc()
  const safeStorage = opts.safeStorage || fakeSafeStorage()
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const logs = []
  const library = registerLibrary(app, {
    app: null,
    ipcMain: ipc,
    safeStorage,
    appVersion: '3.0.0-test',
    getMainWindow: () => null,
    dataDir,
    ffmpegPath: opts.ffmpegPath || ffmpegBin,
    ffprobePath: ffprobeBin,
    translateCues: opts.translateCues || (async (cues) => ({ cues: cues.map((c) => ({ ...c, t: `[PT] ${c.t}` })), failed: false })),
    getBackendPort: () => port,
    token: TOKEN,
    spawn: opts.spawn,
    maxAudio: opts.maxAudio,
    log: (m) => logs.push(m),
    createClient: (options) => createJellyfinClient({ ...options, ...(opts.clientOptions || {}) })
  })
  const base = `http://127.0.0.1:${port}/library`

  const api = (route, { token = TOKEN, method = 'GET', headers = {}, body, signal } = {}) =>
    fetch(`${base}${route}${token === null ? '' : (route.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(token)}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      signal
    })
  const json = async (route, options) => {
    const res = await api(route, options)
    const text = await res.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      /* not json */
    }
    return { status: res.status, json: data, text, headers: res.headers }
  }
  const post = (route, body) => json(route, { method: 'POST', body })

  const backend = {
    app,
    server,
    port,
    base,
    dataDir,
    ipc,
    library,
    safeStorage,
    logs,
    api,
    json,
    post,
    connect: (extra = {}) =>
      ipc.invoke('library:connect', { url: mock.url, username: mock.user, password: mock.password, allowInvalidCert: false, ...extra }),
    async close() {
      library.close()
      await new Promise((resolve) => (server.closeAllConnections?.(), server.close(resolve)))
      if (ownsDataDir) fs.rmSync(dataDir, { recursive: true, force: true })
    }
  }
  if (connect && mock) {
    const result = await backend.connect()
    if (!result.ok) {
      await backend.close()
      throw new Error(`test setup: connect failed: ${JSON.stringify(result)}`)
    }
  }
  return backend
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function waitFor(check, { timeout = 3000, every = 20 } = {}) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (await check()) return true
    await sleep(every)
  }
  return false
}

export const pidAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
