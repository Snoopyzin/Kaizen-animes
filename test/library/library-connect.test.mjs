// library:connect / :disconnect / :status over IPC against the mock Jellyfin: every error code of spec section 8.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { startMockJellyfin } from './mock-jellyfin.mjs'
import { startBackend, TOKEN } from './helpers.mjs'
import { tlsCert, tlsKey } from './tls-fixture.mjs'

let mock
const backends = []
const servers = []
test.before(async () => {
  mock = await startMockJellyfin()
})
test.after(async () => {
  for (const b of backends) await b.close()
  for (const s of servers) await new Promise((resolve) => (s.closeAllConnections?.(), s.close(resolve)))
  await mock.close()
})
const backend = async (opts = {}) => {
  const b = await startBackend({ mock, connect: false, ...opts })
  backends.push(b)
  return b
}
const plainServer = async (handler) => {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  servers.push(server)
  return `http://127.0.0.1:${server.address().port}`
}
const deadPort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })

test('the IPC channels are registered and the token is the per-run secret', async () => {
  const b = await backend()
  assert.deepEqual(b.ipc.channels(), ['library:connect', 'library:disconnect', 'library:status', 'library:token'])
  assert.equal(b.ipc.sendSync('library:token'), TOKEN)
  assert.deepEqual(await b.ipc.invoke('library:status'), { connected: false, server: null })
})

test('connect with the right credentials: result, persistence, device id in the Authorization header', async () => {
  const b = await backend()
  const before = mock.requests.length
  const r = await b.connect()
  assert.equal(r.ok, true)
  assert.deepEqual(r.server, { name: 'Kaizen Testbed', host: new URL(mock.url).host, url: mock.url, userName: 'kaizen', version: '12.2.0', allowInvalidCert: false })
  assert.deepEqual(await b.ipc.invoke('library:status'), { connected: true, server: r.server })
  const file = JSON.parse(fs.readFileSync(path.join(b.dataDir, 'library-server.json'), 'utf8'))
  assert.equal(file.server.url, mock.url)
  assert.equal(file.server.userId, mock.userId.replace(/-/g, ''))
  assert.equal(file.server.token.enc, true)
  const raw = JSON.stringify(file)
  assert.equal(raw.includes('Testbed-Pass'), false, 'the password is never stored')
  const login = mock.requests.slice(before).find((x) => x.path === '/Users/AuthenticateByName')
  assert.match(login.headers.authorization, /^MediaBrowser Client="Kaizen", Device="Kaizen Desktop", DeviceId="[0-9a-f-]{36}", Version="3\.0\.0-test"$/)
  assert.equal(login.headers.authorization.includes('Token='), false, 'no token on the login request')
})

test('connect accepts the address the way users type it', async () => {
  for (const url of [mock.url + '/', mock.url + '/web/index.html', `  ${mock.url.replace('http://', '')}  `]) {
    const b = await backend()
    const r = await b.connect({ url })
    assert.equal(r.ok, true, url)
    assert.equal(b.library.store.current().url, mock.url)
  }
})

test('BAD_URL, and bad argument types / lengths', async () => {
  const b = await backend()
  const call = (args) => b.ipc.invoke('library:connect', args)
  for (const url of ['', 'ftp://x', 'javascript:alert(1)', 'a'.repeat(2049), null, 42]) {
    assert.equal((await call({ url, username: 'a', password: 'b' })).error, 'BAD_URL', String(url).slice(0, 20))
  }
  assert.equal((await call({ url: mock.url, username: 'a'.repeat(257), password: 'b' })).error, 'BAD_CREDENTIALS')
  assert.equal((await call({ url: mock.url, username: 'a', password: 'b'.repeat(1025) })).error, 'BAD_CREDENTIALS')
  assert.equal((await call({ url: mock.url, username: '', password: 'b' })).error, 'BAD_CREDENTIALS')
  assert.equal((await call({ url: mock.url, username: 5, password: 'b' })).error, 'BAD_CREDENTIALS')
  assert.equal((await call({ url: mock.url, username: 'a', password: null })).error, 'BAD_CREDENTIALS')
  assert.equal((await call(undefined)).error, 'BAD_URL')
  assert.equal((await call('http://x')).error, 'BAD_URL')
  assert.deepEqual(await b.ipc.invoke('library:status'), { connected: false, server: null })
})

test('BAD_CREDENTIALS: wrong password and unknown user; the message never repeats the password', async () => {
  const b = await backend()
  const wrong = await b.connect({ password: 'hunter2-wrong' })
  assert.deepEqual([wrong.ok, wrong.error], [false, 'BAD_CREDENTIALS'])
  assert.equal(JSON.stringify(wrong).includes('hunter2'), false)
  assert.equal((await b.connect({ username: 'nobody' })).error, 'BAD_CREDENTIALS')
  assert.deepEqual(await b.ipc.invoke('library:status'), { connected: false, server: null })
  assert.equal(b.logs.some((l) => l.includes('hunter2')), false)
})

test('a failed connect leaves the previous connection untouched', async () => {
  const b = await backend()
  assert.equal((await b.connect()).ok, true)
  const before = b.library.store.current()
  assert.equal((await b.connect({ password: 'nope' })).error, 'BAD_CREDENTIALS')
  assert.equal((await b.connect({ url: `http://127.0.0.1:${await deadPort()}` })).error, 'UNREACHABLE')
  assert.deepEqual(b.library.store.current(), before)
  assert.equal((await b.json('/status')).json.connected, true)
})

test('UNREACHABLE: nothing listening, and a host that does not resolve', async () => {
  const b = await backend()
  const closed = await b.connect({ url: `http://127.0.0.1:${await deadPort()}` })
  assert.deepEqual([closed.ok, closed.error], [false, 'UNREACHABLE'])
  const nowhere = await b.connect({ url: 'http://no-such-host.invalid:8096' })
  assert.equal(nowhere.error, 'UNREACHABLE')
})

test('TIMEOUT: a server that never answers', async () => {
  const hanging = await plainServer(() => {}) // accepts, never replies
  const b = await backend({ clientOptions: { headersTimeoutMs: 250 } })
  const t0 = Date.now()
  const r = await b.connect({ url: hanging })
  assert.deepEqual([r.ok, r.error], [false, 'TIMEOUT'])
  assert.ok(Date.now() - t0 < 3000)
  // the same when it is the login that hangs
  mock.hang(/POST \/Users\/AuthenticateByName/, 1)
  assert.equal((await b.connect()).error, 'TIMEOUT')
  mock.clearRules()
})

test('NOT_JELLYFIN: other servers, other products, garbage and missing routes', async () => {
  const b = await backend()
  const cases = [
    ['an unrelated JSON api', (req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"hello":"world"}') }],
    ['html', (req, res) => { res.setHeader('content-type', 'text/html'); res.end('<html><body>Welcome to nginx!</body></html>') }],
    ['404', (req, res) => { res.statusCode = 404; res.end('nope') }],
    ['emby', (req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ServerName: 'x', Version: '4.8', Id: 'abc', ProductName: 'Emby Server' })) }],
    ['a reverse proxy login wall', (req, res) => { res.statusCode = 401; res.end('login required') }]
  ]
  for (const [name, handler] of cases) {
    const r = await b.connect({ url: await plainServer(handler) })
    assert.deepEqual([name, r.ok, r.error], [name, false, 'NOT_JELLYFIN'])
  }
  // our own backend is not a Jellyfin server either
  assert.equal((await b.connect({ url: `http://127.0.0.1:${b.port}` })).error, 'NOT_JELLYFIN')
})

test('SERVER_ERROR: the server fails', async () => {
  const b = await backend()
  const broken = await plainServer((req, res) => { res.statusCode = 500; res.end('boom') })
  assert.equal((await b.connect({ url: broken })).error, 'SERVER_ERROR')
  mock.fail(/POST \/Users\/AuthenticateByName/, 500, 1)
  assert.equal((await b.connect()).error, 'SERVER_ERROR')
  mock.clearRules()
  // a login answer without a token is a server problem too
  const odd = await plainServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url.startsWith('/System/Info/Public')) res.end(JSON.stringify({ ServerName: 'X', Version: '12', Id: 'abc', ProductName: 'Jellyfin Server' }))
    else res.end('{"User":{"Name":"x"}}')
  })
  assert.equal((await b.connect({ url: odd })).error, 'SERVER_ERROR')
})

test('a second connect while one is in flight is rejected as busy', async () => {
  const b = await backend()
  mock.slow(/POST \/Users\/AuthenticateByName/, 300, 1)
  const first = b.connect()
  await new Promise((r) => setTimeout(r, 50))
  const second = await b.connect()
  assert.deepEqual([second.ok, second.error, second.message], [false, 'SERVER_ERROR', 'busy'])
  assert.equal((await first).ok, true)
  mock.clearRules()
})

test('TLS_ERROR for an untrusted certificate, accepted only with allowInvalidCert (and only for that server)', async () => {
  const secure = await startMockJellyfin({ tls: { key: tlsKey, cert: tlsCert } })
  try {
    const b = await startBackend({ mock: secure, connect: false })
    backends.push(b)
    const strict = await b.connect()
    assert.deepEqual([strict.ok, strict.error], [false, 'TLS_ERROR'])
    const trusted = await b.connect({ allowInvalidCert: true })
    assert.equal(trusted.ok, true)
    // the reconnect form needs the base url (https, sub-path) and the trust choice
    assert.equal(trusted.server.url, secure.url)
    assert.equal(trusted.server.allowInvalidCert, true)
    assert.deepEqual((await b.json('/status')).json.server, trusted.server)
    assert.deepEqual((await b.json('/')).json.server, trusted.server)
    assert.deepEqual((await b.ipc.invoke('library:status')).server, trusted.server)
    assert.equal(JSON.stringify(trusted.server).includes('token'), false)
    assert.equal(JSON.parse(fs.readFileSync(path.join(b.dataDir, 'library-server.json'), 'utf8')).server.allowInvalidCert, true)
    // the setting is remembered: library calls work against the self-signed server...
    assert.equal((await b.json('/')).status, 200)
    // ...and a restart (new store reading the file) keeps trusting only it
    assert.equal(b.library.store.current().allowInvalidCert, true)
    // connecting to a different untrusted server without the flag still fails
    const again = await b.connect({ url: secure.url, allowInvalidCert: false })
    assert.equal(again.error, 'TLS_ERROR')
  } finally {
    await secure.close()
  }
})

test('connect follows ONE redirect that keeps the host (http -> moved/https) and stores the final address', async () => {
  const real = mock.url
  const redirector = await plainServer((req, res) => {
    res.statusCode = 302
    res.setHeader('location', `${real}${req.url}`)
    res.end()
  })
  const b = await backend()
  const r = await b.connect({ url: redirector })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(b.library.store.current().url, real)
  // a redirect to ANOTHER host is not followed
  const away = await plainServer((req, res) => {
    res.statusCode = 302
    res.setHeader('location', `http://localhost:${new URL(real).port}${req.url}`)
    res.end()
  })
  assert.equal((await b.connect({ url: away })).error, 'NOT_JELLYFIN')
})

test('connecting again replaces the connection and rebuilds every cache', async () => {
  const b = await backend()
  await b.connect()
  const first = await b.json('/')
  assert.equal(first.status, 200)
  const tokensBefore = mock.state.tokens.size
  await b.connect()
  assert.equal(mock.state.tokens.size, tokensBefore + 1, 'a new session')
  const second = await b.json('/')
  assert.ok(second.json.fetchedAt >= first.json.fetchedAt)
  assert.notEqual(second.json.fetchedAt, first.json.fetchedAt, 'not served from the old cache')
})

test('disconnect: logs out on the server (best effort), forgets everything, survives an unreachable server', async () => {
  const b = await backend()
  await b.connect()
  const logoutsBefore = mock.state.sessionsLoggedOut
  assert.deepEqual(await b.ipc.invoke('library:disconnect'), { ok: true })
  assert.equal(mock.state.sessionsLoggedOut, logoutsBefore + 1)
  assert.deepEqual(await b.ipc.invoke('library:status'), { connected: false, server: null })
  const file = JSON.parse(fs.readFileSync(path.join(b.dataDir, 'library-server.json'), 'utf8'))
  assert.equal(file.server, null)
  assert.equal((await b.json('/')).json.error, 'NOT_CONNECTED')
  assert.deepEqual(await b.ipc.invoke('library:disconnect'), { ok: true }, 'idempotent')

  // server gone: still disconnects
  const gone = await startMockJellyfin()
  const b2 = await startBackend({ mock: gone, clientOptions: { headersTimeoutMs: 300 } })
  backends.push(b2)
  await gone.close()
  assert.deepEqual(await b2.ipc.invoke('library:disconnect'), { ok: true })
  assert.equal(b2.library.store.current(), null)
})

test('the connection survives a restart without any network access', async () => {
  const b = await backend()
  await b.connect()
  const dataDir = b.dataDir
  const requests = mock.requests.length
  // a second backend on the same data dir (the app restarted) knows the server without calling it
  const b2 = await startBackend({ mock, connect: false, dataDir, safeStorage: b.safeStorage })
  backends.push(b2)
  assert.equal(mock.requests.length, requests, 'no request at start-up')
  assert.equal((await b2.ipc.invoke('library:status')).connected, true)
  assert.equal((await b2.json('/')).status, 200)
})
