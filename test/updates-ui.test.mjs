// The update notice rules (utils/updateNotice.js) and a render smoke test of the settings card.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  AUTO_CHECK_KEY,
  CHECK_EVERY_MS,
  autoCheckEnabled,
  setAutoCheck,
  shouldCheckNow,
  shouldNotify
} from '../src/renderer/src/utils/updateNotice.js'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(appDir, 'src', 'renderer', 'src')
const localesDir = path.join(src, 'i18n', 'locales')

const memory = () => {
  const data = new Map()
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => void data.set(k, String(v)) }
}

test('the automatic check is on by default and only "false" turns it off', () => {
  const s = memory()
  assert.equal(autoCheckEnabled(s), true)
  setAutoCheck(false, s)
  assert.equal(s.getItem(AUTO_CHECK_KEY), 'false')
  assert.equal(autoCheckEnabled(s), false)
  setAutoCheck(true, s)
  assert.equal(autoCheckEnabled(s), true)
  assert.equal(autoCheckEnabled(null), true) // no storage at all: still on
  const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.equal(autoCheckEnabled(broken), true)
  assert.doesNotThrow(() => setAutoCheck(false, broken))
})

test('shouldCheckNow: at most once per interval, never when disabled, a clock set back counts as long ago', () => {
  const now = 1_800_000_000_000
  assert.equal(shouldCheckNow({ enabled: false, last: 0, now }), false)
  assert.equal(shouldCheckNow({ enabled: true, last: null, now }), true) // never checked
  assert.equal(shouldCheckNow({ enabled: true, last: now - 1000, now }), false)
  assert.equal(shouldCheckNow({ enabled: true, last: now - CHECK_EVERY_MS + 1, now }), false)
  assert.equal(shouldCheckNow({ enabled: true, last: now - CHECK_EVERY_MS, now }), true)
  assert.equal(shouldCheckNow({ enabled: true, last: String(now + 5000), now }), true) // last is in the future
  assert.equal(shouldCheckNow({ enabled: true, last: 'junk', now }), true)
})

test('shouldNotify: once per version, only for real updates', () => {
  const update = { ok: true, hasUpdate: true, latest: '3.1.0' }
  assert.equal(shouldNotify(update, null), true)
  assert.equal(shouldNotify(update, '3.0.9'), true)
  assert.equal(shouldNotify(update, '3.1.0'), false) // already told
  assert.equal(shouldNotify({ ok: true, hasUpdate: false, latest: '3.0.0' }, null), false)
  assert.equal(shouldNotify({ ok: false, error: 'NETWORK' }, null), false)
  assert.equal(shouldNotify(null, null), false)
  assert.equal(shouldNotify(undefined, null), false)
})

let esbuild = null
try {
  esbuild = await import('esbuild')
} catch {
  /* esbuild comes with vite; without it the render test is skipped, not failed */
}

test('UpdatesCard renders in both languages (initial state)', { skip: !esbuild }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaizen-updates-'))
  try {
    fs.writeFileSync(
      path.join(tmp, 'i18n.mjs'),
      `
      import fs from 'node:fs'
      import path from 'node:path'
      const root = ${JSON.stringify(localesDir)}
      let current = 'pt'
      export const setTestLanguage = (l) => { current = l }
      export const dateLocale = () => undefined
      export function t(key, vars) {
        const dot = key.indexOf('.')
        const text = JSON.parse(fs.readFileSync(path.join(root, current, key.slice(0, dot) + '.json'), 'utf8'))[key.slice(dot + 1)]
        if (text === undefined) throw new Error('missing i18n key: ' + key + ' (' + current + ')')
        return vars ? text.replace(/\\{\\{(\\w+)\\}\\}/g, (_, n) => String(vars[n] ?? '')) : text
      }
    `
    )
    const entry = `
      import React from 'react'
      import { renderToStaticMarkup } from 'react-dom/server'
      import { Theme } from '@radix-ui/themes'
      import UpdatesCard from ${JSON.stringify(path.join(src, 'components', 'UpdatesCard.jsx'))}
      import { setTestLanguage } from ${JSON.stringify(path.join(tmp, 'i18n.mjs'))}
      export function render(lang) {
        setTestLanguage(lang)
        return renderToStaticMarkup(React.createElement(Theme, { appearance: 'dark' }, React.createElement(UpdatesCard)))
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
    for (const [lang, title, check] of [
      ['pt', 'Atualizações', 'Verificar atualizações'],
      ['en', 'Updates', 'Check for updates']
    ]) {
      const html = render(lang)
      assert.ok(html.includes(title), `${lang}: title`)
      assert.ok(html.includes(check), `${lang}: check button`)
      assert.ok(/role="switch"/.test(html), `${lang}: the automatic-check switch`)
      assert.ok(!/undefined|\[object|\{\{/.test(html), `${lang}: no leaked placeholders`)
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})
