// The stored connection: URL normalisation, token encryption, corrupt-file recovery, atomic writes.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { ConnectionError, FILE_NAME, createConnectionStore, hostOf, normalizeUrl, publicServer } from '../../src/main/library/connection.js'
import { fakeSafeStorage, tempDir } from './helpers.mjs'

const dirs = []
const newDir = () => {
  const d = tempDir('kaizen-conn-')
  dirs.push(d)
  return d
}
test.after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

const USER_ID = 'c0ffee00c0ffee00c0ffee00c0ffee00'
const sample = (extra = {}) => ({
  url: 'http://192.168.0.10:8096',
  name: 'Casa',
  serverId: 'abc',
  version: '10.9.1',
  userId: USER_ID,
  userName: 'gabriel',
  allowInvalidCert: false,
  token: 'secret-access-token-0123456789',
  ...extra
})

/* ------------------------------ URL normalisation ------------------------------ */

test('normalizeUrl: accepted forms', () => {
  const table = [
    ['http://192.168.0.10:8096', 'http://192.168.0.10:8096'],
    ['192.168.0.10:8096', 'http://192.168.0.10:8096'],
    ['  192.168.0.10:8096  ', 'http://192.168.0.10:8096'],
    ['jellyfin.local', 'http://jellyfin.local'],
    ['localhost:8096', 'http://localhost:8096'],
    ['HTTP://HOST.Example.COM:8096/', 'http://host.example.com:8096'],
    ['https://media.example.com', 'https://media.example.com'],
    ['https://media.example.com/', 'https://media.example.com'],
    ['https://media.example.com:443', 'https://media.example.com'],
    ['http://host:80', 'http://host'],
    ['http://host:8096/web/index.html', 'http://host:8096'],
    ['http://host:8096/web/index.html#/home.html', 'http://host:8096'],
    ['http://host:8096/web/', 'http://host:8096'],
    ['http://host:8096/web', 'http://host:8096'],
    ['http://host:8096/index.html', 'http://host:8096'],
    ['https://host/jellyfin', 'https://host/jellyfin'],
    ['https://host/jellyfin/', 'https://host/jellyfin'],
    ['https://host/jellyfin/web/index.html', 'https://host/jellyfin'],
    ['https://host/media/jellyfin/web', 'https://host/media/jellyfin'],
    ['http://user:pass@host:8096/', 'http://host:8096'],
    ['https://user@host/jellyfin?x=1#frag', 'https://host/jellyfin'],
    ['http://[::1]:8096', 'http://[::1]:8096'],
    ['http://10.0.0.5:8096//', 'http://10.0.0.5:8096']
  ]
  for (const [input, expected] of table) assert.equal(normalizeUrl(input), expected, input)
})

test('normalizeUrl: rejected forms', () => {
  for (const input of ['', '   ', 'ftp://host', 'file:///etc/passwd', 'javascript:alert(1)', 'http://', 'ws://host', 'http://ho st', 'a'.repeat(2049), 'http://host\n.evil.test', null, undefined, 42, {}]) {
    assert.throws(() => normalizeUrl(input), (error) => error instanceof ConnectionError && error.code === 'BAD_URL', String(input).slice(0, 30))
  }
})

test('hostOf and publicServer expose only display names, the base url and the trust flag (never a token)', () => {
  assert.equal(hostOf('http://192.168.0.10:8096/jellyfin'), '192.168.0.10:8096')
  assert.equal(hostOf('https://media.example.com'), 'media.example.com')
  assert.equal(hostOf('nonsense'), '')
  const server = { url: 'https://h:1/jellyfin', name: 'N', userName: 'u', version: 'v', token: 'x', userId: 'y', allowInvalidCert: true, deviceId: 'd' }
  assert.deepEqual(publicServer(server), { name: 'N', host: 'h:1', url: 'https://h:1/jellyfin', userName: 'u', version: 'v', allowInvalidCert: true })
  assert.equal(publicServer({ url: 'http://h' }).allowInvalidCert, false)
  assert.equal(publicServer(null), null)
})

/* ------------------------------ persistence ------------------------------ */

test('a new store is "not connected" and has a generated device id', () => {
  const store = createConnectionStore({ dataDir: newDir(), safeStorage: fakeSafeStorage() })
  assert.deepEqual(store.status(), { connected: false, server: null })
  assert.equal(store.current(), null)
  assert.match(store.deviceId, /^[0-9a-f-]{36}$/)
})

test('save + reload: the token round-trips through safeStorage and is not in the file', async () => {
  const dataDir = newDir()
  const safeStorage = fakeSafeStorage()
  const store = createConnectionStore({ dataDir, safeStorage })
  await store.save(sample())
  const raw = fs.readFileSync(path.join(dataDir, FILE_NAME), 'utf8')
  assert.equal(raw.includes('secret-access-token'), false, 'no clear-text token on disk')
  const file = JSON.parse(raw)
  assert.equal(file.version, 1)
  assert.equal(file.server.token.enc, true)
  assert.equal(file.server.url, 'http://192.168.0.10:8096')
  assert.equal(file.server.deviceId, store.deviceId)
  assert.ok(file.server.connectedAt > 0)
  assert.equal('password' in file.server, false)

  const again = createConnectionStore({ dataDir, safeStorage })
  assert.equal(again.deviceId, store.deviceId)
  assert.equal(again.current().token, 'secret-access-token-0123456789')
  assert.deepEqual(again.status(), {
    connected: true,
    server: { name: 'Casa', host: '192.168.0.10:8096', url: 'http://192.168.0.10:8096', userName: 'gabriel', version: '10.9.1', allowInvalidCert: false }
  })
  assert.equal(JSON.stringify(again.status()).includes('secret'), false)
})

test('without OS encryption the token is stored with enc:false (documented fallback)', async () => {
  const dataDir = newDir()
  const store = createConnectionStore({ dataDir, safeStorage: fakeSafeStorage({ available: false }) })
  await store.save(sample())
  const file = JSON.parse(fs.readFileSync(path.join(dataDir, FILE_NAME), 'utf8'))
  assert.deepEqual(file.server.token, { enc: false, data: 'secret-access-token-0123456789' })
  const again = createConnectionStore({ dataDir, safeStorage: fakeSafeStorage({ available: false }) })
  assert.equal(again.current().token, 'secret-access-token-0123456789')
  // and a null safeStorage (not even injected) works too
  const bare = createConnectionStore({ dataDir: newDir(), safeStorage: null })
  await bare.save(sample())
  assert.equal(bare.current().token, 'secret-access-token-0123456789')
})

test('an encrypted token that cannot be decrypted keeps the server but asks for the password again', async () => {
  const dataDir = newDir()
  const store = createConnectionStore({ dataDir, safeStorage: fakeSafeStorage() })
  await store.save(sample())
  // the file was copied to another machine: that key store cannot decrypt it
  const stranger = { isEncryptionAvailable: () => true, encryptString: () => Buffer.alloc(0), decryptString: () => { throw new Error('wrong key') } }
  const other = createConnectionStore({ dataDir, safeStorage: stranger })
  assert.equal(other.status().connected, true)
  assert.equal(other.current().token, null)
  // OS encryption gone entirely
  const none = createConnectionStore({ dataDir, safeStorage: fakeSafeStorage({ available: false }) })
  assert.equal(none.current().token, null)
})

test('the token is decrypted lazily: a store created before Electron is ready still gets it later', async () => {
  // on Windows safeStorage only works after the app's "ready" event, but the store is created while
  // the app is starting (regression: the saved session came back as "expired" after every restart)
  const dataDir = newDir()
  const real = fakeSafeStorage()
  const first = createConnectionStore({ dataDir, safeStorage: real })
  await first.save(sample())

  let ready = false
  const early = { ...real, isEncryptionAvailable: () => ready }
  const store = createConnectionStore({ dataDir, safeStorage: early })
  assert.equal(store.status().connected, true)
  assert.equal(store.current().token, null, 'not decryptable yet')
  ready = true
  assert.equal(store.current().token, 'secret-access-token-0123456789', 'decrypted on first use after ready')
  assert.equal(store.current().token, 'secret-access-token-0123456789')
})

test('clear() forgets the server and the token but keeps the device id', async () => {
  const dataDir = newDir()
  const store = createConnectionStore({ dataDir, safeStorage: fakeSafeStorage() })
  await store.save(sample())
  const device = store.deviceId
  await store.clear()
  assert.deepEqual(store.status(), { connected: false, server: null })
  const file = JSON.parse(fs.readFileSync(path.join(dataDir, FILE_NAME), 'utf8'))
  assert.equal(file.server, null)
  assert.equal(file.deviceId, device)
  assert.equal(createConnectionStore({ dataDir, safeStorage: fakeSafeStorage() }).deviceId, device)
})

test('save normalises the URL it was given', async () => {
  const store = createConnectionStore({ dataDir: newDir(), safeStorage: fakeSafeStorage() })
  await store.save(sample({ url: 'host:8096/web/index.html' }))
  assert.equal(store.current().url, 'http://host:8096')
  await assert.rejects(store.save(sample({ url: 'ftp://nope' })), /invalid server address/)
})

/* ------------------------------ damaged files ------------------------------ */

test('a corrupt main file falls back to the .bak copy; both corrupt = not connected (never throws)', async () => {
  const dataDir = newDir()
  const file = path.join(dataDir, FILE_NAME)
  const store = createConnectionStore({ dataDir, safeStorage: fakeSafeStorage() })
  await store.save(sample({ name: 'First' }))
  await store.save(sample({ name: 'Second' })) // the first one is now the .bak
  assert.equal(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')).server.name, 'First')

  fs.writeFileSync(file, '{"version":1,"server":{"url":') // truncated by a crash
  const logs = []
  const recovered = createConnectionStore({ dataDir, safeStorage: fakeSafeStorage(), log: (m) => logs.push(m) })
  assert.equal(recovered.status().server.name, 'First')
  assert.ok(logs.some((m) => /backup/.test(m)))

  fs.writeFileSync(file + '.bak', 'garbage')
  const lost = createConnectionStore({ dataDir, safeStorage: fakeSafeStorage() })
  assert.deepEqual(lost.status(), { connected: false, server: null })
  assert.match(lost.deviceId, /^[0-9a-f-]{36}$/)
})

test('well-formed JSON with the wrong content is treated as corrupt', async () => {
  for (const content of ['null', '[]', '{"version":2}', '{"version":1,"server":{"url":"ftp://x","userId":"' + USER_ID + '"}}', '{"version":1,"server":{"url":"http://h","userId":"not-hex"}}']) {
    const dataDir = newDir()
    fs.writeFileSync(path.join(dataDir, FILE_NAME), content)
    const store = createConnectionStore({ dataDir, safeStorage: fakeSafeStorage() })
    assert.equal(store.status().connected, false, content)
  }
})

test('the main file is not overwritten from a damaged state: the good copy stays as .bak', async () => {
  const dataDir = newDir()
  const store = createConnectionStore({ dataDir, safeStorage: fakeSafeStorage() })
  await store.save(sample({ name: 'Good' }))
  await store.save(sample({ name: 'Good' })) // the first copy is now the .bak
  fs.writeFileSync(path.join(dataDir, FILE_NAME), 'broken')
  const reloaded = createConnectionStore({ dataDir, safeStorage: fakeSafeStorage() }) // restores "Good" from .bak
  await reloaded.save(sample({ name: 'Newer' }))
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, FILE_NAME) + '.bak', 'utf8')).server.name, 'Good')
})

/* ------------------------------ atomic write ------------------------------ */

function flakyFs(failures, code = 'EPERM') {
  let left = failures
  const calls = { rename: 0, copy: 0 }
  return {
    calls,
    ...fs,
    readFileSync: fs.readFileSync,
    writeFileSync: fs.writeFileSync,
    mkdirSync: fs.mkdirSync,
    unlinkSync: fs.unlinkSync,
    copyFileSync: (...args) => {
      calls.copy++
      return fs.copyFileSync(...args)
    },
    renameSync: (from, to) => {
      calls.rename++
      if (left-- > 0) throw Object.assign(new Error(`${code}: operation not permitted`), { code })
      return fs.renameSync(from, to)
    }
  }
}

test('atomic write retries a rename that fails with EPERM / EBUSY (antivirus) and then succeeds', async () => {
  for (const code of ['EPERM', 'EBUSY']) {
    const dataDir = newDir()
    const fsImpl = flakyFs(3, code)
    const store = createConnectionStore({ dataDir, safeStorage: fakeSafeStorage(), fsImpl, sleep: async () => {} })
    await store.save(sample())
    assert.equal(fsImpl.calls.rename, 4, 'three failures then success')
    assert.equal(fsImpl.calls.copy, 0)
    assert.equal(createConnectionStore({ dataDir, safeStorage: fakeSafeStorage() }).status().connected, true)
    assert.equal(fs.existsSync(path.join(dataDir, FILE_NAME + '.tmp')), false, 'no temp file left')
  }
})

test('atomic write falls back to copy + unlink when the rename never works', async () => {
  const dataDir = newDir()
  const fsImpl = flakyFs(99)
  const store = createConnectionStore({ dataDir, safeStorage: fakeSafeStorage(), fsImpl, sleep: async () => {} })
  await store.save(sample({ name: 'Copied' }))
  assert.equal(fsImpl.calls.copy, 1)
  assert.equal(createConnectionStore({ dataDir, safeStorage: fakeSafeStorage() }).status().server.name, 'Copied')
  assert.equal(fs.existsSync(path.join(dataDir, FILE_NAME + '.tmp')), false)
})

test('a non-retryable rename error is reported (not silently swallowed)', async () => {
  const dataDir = newDir()
  const fsImpl = flakyFs(1, 'ENOSPC')
  const store = createConnectionStore({ dataDir, safeStorage: fakeSafeStorage(), fsImpl, sleep: async () => {} })
  await assert.rejects(store.save(sample()), /ENOSPC/)
})

test('writes never overlap: concurrent save and clear end in the order they were asked', async () => {
  const dataDir = newDir()
  const store = createConnectionStore({ dataDir, safeStorage: fakeSafeStorage() })
  await Promise.all([store.save(sample({ name: 'A' })), store.clear(), store.save(sample({ name: 'C' }))])
  const again = createConnectionStore({ dataDir, safeStorage: fakeSafeStorage() })
  assert.equal(again.status().server.name, 'C')
})
