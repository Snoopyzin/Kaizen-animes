// "Is there a newer Kaizen?" (src/main/updates.js): version comparison, release parsing, error mapping.
import test from 'node:test'
import assert from 'node:assert/strict'
import { UPDATE_REPO, checkForUpdate, compareVersions, parseRelease } from '../src/main/updates.js'

const base = `https://github.com/${UPDATE_REPO.owner}/${UPDATE_REPO.name}/`
const release = (over = {}) => ({
  tag_name: 'v3.1.0',
  name: 'Kaizen 3.1.0',
  body: 'New things',
  published_at: '2026-11-01T10:00:00Z',
  html_url: `${base}releases/tag/v3.1.0`,
  assets: [
    { name: 'notes.txt', browser_download_url: `${base}releases/download/v3.1.0/notes.txt` },
    { name: 'kaizen-3.1.0-setup.exe', browser_download_url: `${base}releases/download/v3.1.0/kaizen-3.1.0-setup.exe` }
  ],
  ...over
})
const reply = (status, body) => async () => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => {
    if (body === undefined) throw new Error('no json')
    return body
  }
})

test('compareVersions: numeric, with v prefix, short forms and suffixes', () => {
  const table = [
    ['3.0.0', '3.0.0', 0],
    ['3.0.0', 'v3.0.1', -1],
    ['3.10.0', '3.9.9', 1], // numeric, not alphabetical
    ['3.0', '3.0.0', 0],
    ['3', '3.0.1', -1],
    ['v3.1.0-beta.2', '3.1.0', 0],
    ['2.99.99', '3.0.0', -1]
  ]
  for (const [a, b, expected] of table) assert.equal(compareVersions(a, b), expected, `${a} vs ${b}`)
  for (const bad of [null, undefined, '', 'latest', 'x.y.z']) {
    assert.equal(compareVersions('3.0.0', bad), null, String(bad))
    assert.equal(compareVersions(bad, '3.0.0'), null, String(bad))
  }
})

test('parseRelease: a newer tag is an update, the same or an older one is not', () => {
  const newer = parseRelease(release(), '3.0.0')
  assert.equal(newer.ok, true)
  assert.equal(newer.hasUpdate, true)
  assert.equal(newer.latest, '3.1.0')
  assert.equal(newer.current, '3.0.0')
  assert.equal(newer.pageUrl, `${base}releases/tag/v3.1.0`)
  assert.equal(newer.downloadUrl, `${base}releases/download/v3.1.0/kaizen-3.1.0-setup.exe`)
  assert.equal(newer.notes, 'New things')
  assert.equal(parseRelease(release(), '3.1.0').hasUpdate, false)
  assert.equal(parseRelease(release(), '4.0.0').hasUpdate, false)
})

test('parseRelease: only links that point at this project are kept', () => {
  const evil = parseRelease(
    release({
      html_url: 'https://evil.example/releases',
      assets: [{ name: 'setup.exe', browser_download_url: 'https://evil.example/setup.exe' }]
    }),
    '3.0.0'
  )
  assert.equal(evil.pageUrl, `${base}releases`)
  assert.equal(evil.downloadUrl, null)
  // another repository on github.com is not this project either
  const other = parseRelease(
    release({
      html_url: 'https://github.com/someone/else/releases/tag/v9',
      assets: [{ name: 'x.exe', browser_download_url: 'https://github.com/someone/else/releases/download/v9/x.exe' }]
    }),
    '3.0.0'
  )
  assert.equal(other.pageUrl, `${base}releases`)
  assert.equal(other.downloadUrl, null)
})

test('parseRelease: no installer asset, huge notes and junk fields are handled', () => {
  const none = parseRelease(release({ assets: [] }), '3.0.0')
  assert.equal(none.downloadUrl, null)
  assert.equal(none.hasUpdate, true)
  assert.equal(parseRelease(release({ body: 'x'.repeat(5000) }), '3.0.0').notes.length, 1200)
  const odd = parseRelease(release({ body: 7, name: {}, published_at: 5, assets: 'nope' }), '3.0.0')
  assert.equal(odd.ok, true)
  assert.equal(odd.notes, '')
  assert.equal(odd.publishedAt, null)
  for (const junk of [null, {}, { tag_name: 5 }, { tag_name: 'nightly' }, { tag_name: '' }]) {
    assert.deepEqual(parseRelease(junk, '3.0.0'), { ok: false, error: 'BAD_RESPONSE' })
  }
})

test('checkForUpdate maps every HTTP outcome to a code the UI can translate', async () => {
  assert.equal((await checkForUpdate({ current: '3.0.0', fetchImpl: reply(200, release()) })).hasUpdate, true)
  assert.deepEqual(await checkForUpdate({ current: '3.0.0', fetchImpl: reply(404, {}) }), { ok: false, error: 'NO_RELEASE' })
  assert.deepEqual(await checkForUpdate({ current: '3.0.0', fetchImpl: reply(403, {}) }), { ok: false, error: 'RATE_LIMITED' })
  assert.deepEqual(await checkForUpdate({ current: '3.0.0', fetchImpl: reply(429, {}) }), { ok: false, error: 'RATE_LIMITED' })
  assert.deepEqual(await checkForUpdate({ current: '3.0.0', fetchImpl: reply(500, {}) }), { ok: false, error: 'HTTP_ERROR' })
  assert.deepEqual(await checkForUpdate({ current: '3.0.0', fetchImpl: reply(200, undefined) }), { ok: false, error: 'BAD_RESPONSE' })
  const down = async () => {
    throw new TypeError('fetch failed')
  }
  assert.deepEqual(await checkForUpdate({ current: '3.0.0', fetchImpl: down }), { ok: false, error: 'NETWORK' })
})

test('checkForUpdate asks the right URL with the right headers and a timeout', async () => {
  let seen
  const fetchImpl = async (url, options) => {
    seen = { url, options }
    return reply(200, release())()
  }
  await checkForUpdate({ current: '3.0.0', fetchImpl })
  assert.equal(seen.url, 'https://api.github.com/repos/Snoopyzin/Kaizen-animes/releases/latest')
  assert.equal(seen.options.headers.Accept, 'application/vnd.github+json')
  assert.ok(seen.options.headers['User-Agent'], 'GitHub requires a User-Agent')
  assert.ok(seen.options.signal instanceof AbortSignal)
  assert.equal(JSON.stringify(seen.options.headers).includes('Authorization'), false, 'no credentials are sent')
})
