// The "follow on Instagram" gate: persistence logic and a render smoke test (bundled with esbuild and
// rendered with react-dom/server, i18n stubbed with the real locale files). Offline, a second or two.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  FOLLOW_WAIT_SECONDS,
  INSTAGRAM_HANDLE,
  INSTAGRAM_URL,
  followStatus,
  isFollowUnlocked,
  normalizeInstagram,
  unlockFollow
} from '../src/renderer/src/auth/follow.js'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(appDir, 'src', 'renderer', 'src')
const localesDir = path.join(src, 'i18n', 'locales')

const memoryStorage = () => {
  const data = new Map()
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => void data.set(k, String(v))
  }
}

test('the gate is locked until it is unlocked, and the unlock is remembered', () => {
  const storage = memoryStorage()
  assert.equal(isFollowUnlocked(storage), false)
  unlockFollow(storage)
  assert.equal(isFollowUnlocked(storage), true)
  // a different value in the key never unlocks
  const other = memoryStorage()
  other.setItem('kaizen-follow-gate', 'no')
  assert.equal(isFollowUnlocked(other), false)
})

test('blocked or missing storage never throws: the gate just stays locked', () => {
  const broken = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('denied')
    }
  }
  assert.equal(isFollowUnlocked(broken), false)
  assert.doesNotThrow(() => unlockFollow(broken))
  assert.equal(isFollowUnlocked(null), false)
  assert.doesNotThrow(() => unlockFollow(null))
})

test('the confirm button needs the profile to be opened AND the wait to be over', () => {
  // never opened: locked, whatever the counter says
  assert.deepEqual(followStatus(false, FOLLOW_WAIT_SECONDS), { ready: false, hint: 'openFirst' })
  assert.deepEqual(followStatus(false, 0), { ready: false, hint: 'openFirst' })
  // opened: counting down
  assert.deepEqual(followStatus(true, FOLLOW_WAIT_SECONDS), { ready: false, hint: 'wait' })
  assert.deepEqual(followStatus(true, 1), { ready: false, hint: 'wait' })
  // opened and the wait is over
  assert.deepEqual(followStatus(true, 0), { ready: true, hint: null })
  assert.deepEqual(followStatus(true, -1), { ready: true, hint: null })
})

test('normalizeInstagram accepts what people type and rejects what Instagram does not allow', () => {
  const ok = [
    ['gabriel.arm_', 'gabriel.arm_'],
    ['@Gabriel.ARM_', 'gabriel.arm_'],
    ['  @user_1 ', 'user_1'],
    ['https://www.instagram.com/_u/name', 'name'],
    ['https://m.instagram.com/Name/', 'name'],
    ['https://www.instagram.com/gabriel.arm_/', 'gabriel.arm_'],
    ['http://instagram.com/Some.One?igshid=abc', 'some.one'],
    ['instagram.com/x', 'x'], // a pasted link without the scheme
    ['www.instagram.com/Some_One/', 'some_one'],
    ['a', 'a'],
    ['a'.repeat(30), 'a'.repeat(30)]
  ]
  for (const [input, expected] of ok) assert.equal(normalizeInstagram(input), expected, input)
  const bad = ['', '   ', '@', '@@name','a'.repeat(31), 'has space', 'dots..twice', '.leading', 'trailing.', 'acentuação', 'a/b', 'a@b', null, undefined, 42, {}]
  for (const input of bad) assert.equal(normalizeInstagram(input), null, String(input))
})

test('constants point at the creator profile', () => {
  assert.equal(INSTAGRAM_URL, 'https://www.instagram.com/gabriel.arm_/')
  assert.equal(INSTAGRAM_HANDLE, '@gabriel.arm_')
  assert.ok(FOLLOW_WAIT_SECONDS >= 3 && FOLLOW_WAIT_SECONDS <= 15)
})

let esbuild = null
try {
  esbuild = await import('esbuild')
} catch {
  /* esbuild comes with vite; without it the render test is skipped, not failed */
}

test('FollowGate renders in both languages with a safe link and a locked confirm button', { skip: !esbuild }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaizen-follow-'))
  try {
    const i18nStub = `
      import fs from 'node:fs'
      import path from 'node:path'
      const root = ${JSON.stringify(localesDir)}
      let current = 'pt'
      export const setTestLanguage = (l) => { current = l }
      export function t(key, vars) {
        const dot = key.indexOf('.')
        const file = path.join(root, current, key.slice(0, dot) + '.json')
        const text = JSON.parse(fs.readFileSync(file, 'utf8'))[key.slice(dot + 1)]
        if (text === undefined) throw new Error('missing i18n key: ' + key + ' (' + current + ')')
        return vars ? text.replace(/\\{\\{(\\w+)\\}\\}/g, (_, n) => String(vars[n] ?? '')) : text
      }
    `
    fs.writeFileSync(path.join(tmp, 'i18n.mjs'), i18nStub)
    const entry = `
      import React from 'react'
      import { renderToStaticMarkup } from 'react-dom/server'
      import FollowGate from ${JSON.stringify(path.join(src, 'auth', 'FollowGate.jsx'))}
      import { setTestLanguage } from ${JSON.stringify(path.join(tmp, 'i18n.mjs'))}
      export function render(lang) {
        setTestLanguage(lang)
        return renderToStaticMarkup(React.createElement(FollowGate, { onUnlock() {} }))
      }
    `
    const result = await esbuild.build({
      stdin: { contents: entry, resolveDir: appDir, loader: 'jsx' },
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
      jsx: 'automatic',
      logLevel: 'silent',
      plugins: [
        {
          name: 'stub-i18n',
          setup(build) {
            build.onResolve({ filter: /^\.\.\/i18n$/ }, () => ({ path: path.join(tmp, 'i18n.mjs') }))
          }
        }
      ]
    })
    const bundle = path.join(tmp, 'bundle.mjs')
    fs.writeFileSync(bundle, result.outputFiles[0].text)
    const { render } = await import(pathToFileURL(bundle).href)

    for (const [lang, title, confirm] of [
      ['pt', 'Siga o criador para liberar o Kaizen', 'Já segui, continuar'],
      ['en', 'Follow the creator to unlock Kaizen', 'I followed, continue']
    ]) {
      const html = render(lang)
      assert.ok(html.includes(title), `${lang}: title`)
      assert.ok(html.includes(confirm), `${lang}: confirm label`)
      assert.ok(html.includes(INSTAGRAM_HANDLE), `${lang}: handle shown`)
      assert.ok(html.includes(`href="${INSTAGRAM_URL}"`), `${lang}: profile link`)
      assert.ok(/rel="noopener noreferrer"/.test(html), `${lang}: link is rel=noopener noreferrer`)
      assert.ok(/target="_blank"/.test(html), `${lang}: opens outside the app`)
      assert.ok(/<button[^>]*disabled/.test(html), `${lang}: confirm starts locked`)
      assert.ok(!/undefined|\[object|\{\{/.test(html), `${lang}: no leaked placeholders`)
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
