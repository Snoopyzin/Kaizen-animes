// Render smoke tests of the library pages and components: the real source files are bundled with
// esbuild (React, react-router, react-query and Radix Themes included) and rendered to HTML with
// react-dom/server, with only the Electron-ish edges replaced by stubs (i18n reads the real locale
// JSON, Plyr / TracksMenu / sonner / the Kaizen context are fakes). Offline, a few seconds.
//
// What this proves: every state of every page renders without throwing, with realistic and with
// sparse data; every i18n key it touches exists (the stub `t` throws on a missing key); URLs carry the
// token; the markup has no React warnings (invalid nesting, missing keys), no "undefined" text, no
// unlabeled icon buttons, no unescaped server text. It does NOT run effects, clicks or a real <video>.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const src = path.join(appDir, 'src', 'renderer', 'src')
const localesDir = path.join(src, 'i18n', 'locales')

let esbuild = null
try {
  esbuild = await import('esbuild')
} catch {
  /* esbuild is a dependency of vite; without it the smoke tests are skipped, not failed */
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaizen-ui-smoke-'))
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))

const q = (p) => JSON.stringify(p.split(path.sep).join('/'))

/* ------------------------------ stubs (written to the temp dir) ------------------------------ */

const STUBS = {
  i18n: `
import fs from 'node:fs'
import path from 'node:path'
const root = ${q(localesDir)}
const dict = { pt: {}, en: {} }
for (const lang of ['pt', 'en']) {
  for (const file of fs.readdirSync(path.join(root, lang))) {
    dict[lang][file.replace(/\\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(root, lang, file), 'utf8'))
  }
}
let current = 'pt'
export const setTestLanguage = (lang) => { current = lang }
export const getLanguage = () => current
export const dateLocale = () => undefined
export function t(key, vars) {
  const dot = key.indexOf('.')
  const ns = key.slice(0, dot)
  const k = key.slice(dot + 1)
  const text = dict[current]?.[ns]?.[k]
  if (text === undefined) throw new Error('missing i18n key: ' + key + ' (' + current + ')')
  return vars ? text.replace(/\\{\\{(\\w+)\\}\\}/g, (_, name) => String(vars[name] ?? '')) : text
}
`,
  context: `
export const useKaizenContext = () => ({
  backendPort: 64621,
  vlcPath: '"C:\\\\Program Files (x86)\\\\VideoLAN\\\\VLC\\\\vlc.exe"'
})
`,
  tracks: `
import React from 'react'
export default function TracksMenu(props) {
  globalThis.__kz.tracks.push({
    streamUrl: props.streamUrl,
    storageKey: props.storageKey,
    urls: ['mediainfo', 'subtitles', 'audio'].map((kind) => props.buildUrl(kind))
  })
  return <div data-testid="tracks-menu" />
}
`,
  plyr: `
import React from 'react'
const Plyr = React.forwardRef(function Plyr(props, ref) {
  globalThis.__kz.plyr.push({ source: props.source, options: props.options })
  return <div data-testid="plyr" data-src={props.source?.sources?.[0]?.src} data-type={props.source?.sources?.[0]?.type} />
})
export default Plyr
`,
  sonner: `
const record = (kind) => (message, options) => { globalThis.__kz.toasts.push({ kind, message, options }) }
export const toast = Object.assign(record('default'), {
  success: record('success'), error: record('error'), warning: record('warning'), info: record('info')
})
export const Toaster = () => null
`
}

const HARNESS = `
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Theme } from '@radix-ui/themes'
import { setTestLanguage } from ${q(path.join(tmp, 'i18n.mjs'))}
import Library from ${q(path.join(src, 'pages', 'Library.jsx'))}
import LibrarySeries from ${q(path.join(src, 'pages', 'LibrarySeries.jsx'))}
import LibraryMovie from ${q(path.join(src, 'pages', 'LibraryMovie.jsx'))}
import LibraryPlayer from ${q(path.join(src, 'pages', 'LibraryPlayer.jsx'))}
import ConnectCard from ${q(path.join(src, 'components', 'library', 'ConnectCard.jsx'))}
import ErrorState from ${q(path.join(src, 'components', 'library', 'ErrorState.jsx'))}
import UnsupportedPanel from ${q(path.join(src, 'components', 'library', 'UnsupportedPanel.jsx'))}
import NextEpisodeOverlay from ${q(path.join(src, 'components', 'library', 'NextEpisodeOverlay.jsx'))}
import SmartImage from ${q(path.join(src, 'components', 'library', 'SmartImage.jsx'))}
import { PosterCard, ContinueCard } from ${q(path.join(tmp, 'cards.mjs'))}
import { KEYS } from ${q(path.join(src, 'library', 'hooks.js'))}
import { LibraryError } from ${q(path.join(src, 'library', 'api.js'))}

export { KEYS, LibraryError }
const pages = { Library, LibrarySeries, LibraryMovie, LibraryPlayer }
const parts = { ConnectCard, ErrorState, UnsupportedPanel, NextEpisodeOverlay, SmartImage, PosterCard, ContinueCard }

function seedError(qc, key, error) {
  const query = qc.getQueryCache().build(qc, { queryKey: key })
  query.setState({ ...query.state, status: 'error', fetchStatus: 'idle', error, errorUpdateCount: 1, errorUpdatedAt: Date.now() })
}

let client = null
function wrap(element, { path, route, seed = [], errors = [], lang = 'pt' }) {
  setTestLanguage(lang)
  globalThis.__kz = { toasts: [], tracks: [], plyr: [] }
  const qc = (client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, gcTime: Infinity } } }))
  for (const [key, data] of seed) qc.setQueryData(key, data)
  for (const [key, error] of errors) seedError(qc, key, error)
  return (
    <QueryClientProvider client={qc}>
      <Theme appearance="dark">
        <MemoryRouter initialEntries={[path || '/']}>
          <Routes>
            <Route path={route || '*'} element={element} />
            <Route path="*" element={<p>elsewhere</p>} />
          </Routes>
        </MemoryRouter>
      </Theme>
    </QueryClientProvider>
  )
}

export function renderPage(name, options) {
  return finish(wrap(React.createElement(pages[name]), options))
}
export function renderPart(name, props, options = {}) {
  return finish(wrap(React.createElement(parts[name], props), options))
}

function finish(tree) {
  const problems = []
  const original = console.error
  console.error = (...args) => {
    const message = args.map(String).join(' ')
    // Radix Themes' root uses useLayoutEffect: a server-render-only warning, not a bug
    if (!/useLayoutEffect does nothing on the server/.test(message)) problems.push(message.slice(0, 400))
  }
  let html
  try {
    html = renderToStaticMarkup(tree)
  } finally {
    console.error = original
    client?.clear() // no garbage-collection timers may outlive the test
  }
  return { html, problems, records: globalThis.__kz }
}
`

// PosterCard / ContinueCard are default exports: re-export them under names
const CARDS = `
export { default as PosterCard } from ${q(path.join(src, 'components', 'library', 'PosterCard.jsx'))}
export { default as ContinueCard } from ${q(path.join(src, 'components', 'library', 'ContinueCard.jsx'))}
`

let ui = null
test.before(async () => {
  if (!esbuild) return
  fs.writeFileSync(path.join(tmp, 'i18n.mjs'), STUBS.i18n)
  fs.writeFileSync(path.join(tmp, 'context.mjs'), STUBS.context)
  fs.writeFileSync(path.join(tmp, 'tracks.jsx'), STUBS.tracks)
  fs.writeFileSync(path.join(tmp, 'plyr.jsx'), STUBS.plyr)
  fs.writeFileSync(path.join(tmp, 'sonner.mjs'), STUBS.sonner)
  fs.writeFileSync(path.join(tmp, 'cards.mjs'), CARDS)

  const stubPlugin = {
    name: 'kaizen-stubs',
    setup(b) {
      const inApp = (args) => !args.importer.includes('node_modules')
      b.onResolve({ filter: /(^|\/)i18n$/ }, (args) =>
        inApp(args) ? { path: path.join(tmp, 'i18n.mjs') } : undefined
      )
      b.onResolve({ filter: /utils\/ContextProvider$/ }, () => ({ path: path.join(tmp, 'context.mjs') }))
      b.onResolve({ filter: /components\/TracksMenu$/ }, () => ({ path: path.join(tmp, 'tracks.jsx') }))
      b.onResolve({ filter: /^plyr-react$/ }, () => ({ path: path.join(tmp, 'plyr.jsx') }))
      b.onResolve({ filter: /^sonner$/ }, () => ({ path: path.join(tmp, 'sonner.mjs') }))
    }
  }
  const outfile = path.join(tmp, 'bundle.cjs')
  await esbuild.build({
    stdin: { contents: HARNESS, resolveDir: tmp, loader: 'jsx', sourcefile: 'harness.jsx' },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    nodePaths: [path.join(appDir, 'node_modules')],
    absWorkingDir: appDir,
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.gif': 'dataurl', '.ico': 'dataurl' },
    plugins: [stubPlugin],
    logLevel: 'silent'
  })
  globalThis.window = { api: { library: { token: 'TOKEN123' } } }
  ui = createRequire(import.meta.url)(outfile)
})
test.after(() => {
  delete globalThis.window
})

const skip = esbuild ? false : 'esbuild is not installed'
const it = (name, fn) => test(name, { skip }, fn)

/* ------------------------------ fixtures ------------------------------ */

const hex = (n) => n.toString(16).padStart(32, '0')
const ID = {
  dune: hex(0xd1),
  watched: hex(0xd2),
  noArt: hex(0xd3),
  xss: hex(0xd4),
  bad: hex(0xd5),
  show: hex(0x51),
  done: hex(0x52),
  empty: hex(0x53),
  sea1: hex(0x61),
  sea2: hex(0x62),
  sea0: hex(0x60),
  ep1: hex(0xe1),
  ep2: hex(0xe2),
  ep3: hex(0xe3),
  ep4: hex(0xe4),
  ep5: hex(0xe5),
  sp1: hex(0xe6)
}

const SERVER = { name: 'Casa', host: '192.168.0.10:8096', userName: 'gabriel', version: '10.10.3' }

const INDEX = () => ({
  server: SERVER,
  counts: { movies: 5, series: 3, episodes: 70 },
  fetchedAt: Date.UTC(2025, 0, 10, 15, 30),
  movies: [
    { key: `m:${ID.dune}`, id: ID.dune, title: 'Duna: Parte Dois', year: 2024, duration: 9960, width: 3840, height: 1606, addedAt: 1700000000000, rating: 8.4, genres: ['Ficção científica'], progress: { position: 3600, duration: 9960, watched: false }, favorite: true, hasImage: true },
    { key: `m:${ID.watched}`, id: ID.watched, title: 'Amélie', year: 2001, duration: 7320, width: 1920, height: 800, addedAt: 1600000000000, rating: 8.3, genres: [], progress: { position: 0, duration: 7320, watched: true }, favorite: false, hasImage: true },
    { key: `m:${ID.noArt}`, id: ID.noArt, title: 'Sem Pôster', year: null, duration: 0, width: 0, height: 0, addedAt: 0, rating: null, genres: [], progress: null, favorite: false, hasImage: false },
    { key: `m:${ID.xss}`, id: ID.xss, title: 'Tom & Jerry <script>alert(1)</script> "quotes"', year: 1992, duration: 3600, width: 1280, height: 720, addedAt: 1650000000000, rating: 6.1, genres: ['Animação'], progress: null, favorite: false, hasImage: true },
    { key: `m:${ID.bad}`, id: ID.bad, title: 'Campos Faltando' }
  ],
  series: [
    { key: `s:${ID.show}`, id: ID.show, title: 'Breaking Bad', year: 2008, seasons: 5, episodes: 62, watched: 20, addedAt: 1690000000000, lastWatchedAt: 1700000000000, rating: 9.5, genres: ['Drama'], favorite: false, hasImage: true },
    { key: `s:${ID.done}`, id: ID.done, title: 'Série Completa', year: 2019, seasons: 1, episodes: 1, watched: 1, addedAt: 1680000000000, lastWatchedAt: null, rating: null, genres: [], favorite: true, hasImage: true },
    { key: `s:${ID.empty}`, id: ID.empty, title: 'Sem Episódios', year: null, seasons: 0, episodes: 0, watched: 0, addedAt: 1670000000000, lastWatchedAt: null, rating: null, genres: [], favorite: false, hasImage: false }
  ],
  continueWatching: [
    { type: 'movie', videoId: ID.dune, key: `m:${ID.dune}`, title: 'Duna: Parte Dois', year: 2024, seriesId: null, seriesTitle: null, season: null, episode: null, episodeEnd: null, label: null, position: 3600, duration: 9960, next: false, updatedAt: 1700000000000, hasImage: true },
    { type: 'episode', videoId: ID.ep3, key: `s:${ID.show}`, title: 'Caralho Voador', year: 2008, seriesId: ID.show, seriesTitle: 'Breaking Bad', season: 1, episode: 3, episodeEnd: null, label: 'S01E03', position: 600, duration: 2880, next: false, updatedAt: 1699000000000, hasImage: true },
    { type: 'episode', videoId: ID.ep4, key: `s:${ID.done}`, title: 'Próximo Episódio', year: 2019, seriesId: ID.done, seriesTitle: 'Série Completa', season: 1, episode: 4, episodeEnd: 5, label: null, position: 0, duration: 2700, next: true, updatedAt: 1698000000000, hasImage: false }
  ]
})

const STATUS_ON = { connected: true, server: SERVER }

const EPISODES = {
  ep1: { id: ID.ep1, season: 1, episode: 1, episodeEnd: null, label: 'S01E01', title: 'Piloto', overview: 'A high school chemistry teacher is diagnosed with cancer.', duration: 3480, progress: { position: 0, duration: 3480, watched: true }, hasImage: true, airDate: '2008-01-20T00:00:00.0000000Z' },
  ep2: { id: ID.ep2, season: 1, episode: 2, episodeEnd: null, label: 'S01E02', title: 'O Gato Está no Saco', overview: null, duration: 2880, progress: { position: 0, duration: 2880, watched: true }, hasImage: true, airDate: null },
  ep3: { id: ID.ep3, season: 1, episode: 3, episodeEnd: 4, label: 'S01E03-E04', title: 'Dois em Um', overview: 'Dois episódios em um único arquivo, com muitas coisas acontecendo e que não são do interesse de ninguém.', duration: 5760, progress: { position: 1200, duration: 5760, watched: false }, hasImage: true, airDate: '2008-02-03T00:00:00.0000000Z' },
  ep5: { id: ID.ep5, season: 2, episode: 1, episodeEnd: null, label: 'S02E01', title: '', overview: '', duration: 0, progress: null, hasImage: false, airDate: null },
  sp1: { id: ID.sp1, season: 0, episode: 1, episodeEnd: null, label: 'S00E01', title: 'Especial: Nos Bastidores', overview: '<b>Bastidores</b><br>da série', duration: 1800, progress: null, hasImage: true, airDate: null }
}

const SERIES = (over = {}) => ({
  id: ID.show,
  title: 'Breaking Bad',
  year: 2008,
  overview: 'A chemistry teacher turned drug manufacturer.\nHe builds an empire.',
  genres: ['Drama', 'Crime'],
  rating: 9.4,
  officialRating: 'TV-MA',
  status: 'Ended',
  favorite: false,
  hasImage: true,
  hasBackdrop: true,
  counts: { seasons: 3, episodes: 5, watched: 2 },
  seasons: [
    { id: ID.sea1, season: 1, name: 'Season 1', episodes: [EPISODES.ep1, EPISODES.ep2, EPISODES.ep3] },
    { id: ID.sea2, season: 2, name: 'A Segunda Fase', episodes: [EPISODES.ep5] },
    { id: ID.sea0, season: 0, name: 'Specials', episodes: [EPISODES.sp1] }
  ],
  nextUp: EPISODES.ep3,
  ...over
})

const VIDEO = (over = {}) => ({
  id: ID.dune,
  kind: 'movie',
  title: 'Duna: Parte Dois',
  year: 2024,
  overview: 'Paul Atreides se une aos Fremen para vingar sua família.',
  genres: ['Ficção científica', 'Aventura'],
  rating: 8.4,
  officialRating: '14',
  season: null,
  episode: null,
  episodeEnd: null,
  label: null,
  seriesId: null,
  seriesTitle: null,
  fileName: 'Duna Parte Dois (2024).mkv',
  size: 12.4 * 1024 ** 3,
  duration: 9960,
  width: 3840,
  height: 1606,
  container: 'matroska,webm',
  vcodec: 'h264',
  vprofile: 'High',
  audio: [{ id: 1, codec: 'eac3', lang: 'eng', title: '', channels: 6, default: true }, { id: 2, codec: 'aac', lang: 'por', title: 'Brasil', channels: 2, default: false }],
  subs: [{ id: 3, codec: 'subrip', lang: 'por', title: '', external: false, default: false, forced: false }],
  playback: { supported: true, reason: null },
  progress: { position: 3600, duration: 9960, watched: false },
  favorite: true,
  hasImage: true,
  hasBackdrop: true,
  prev: null,
  next: null,
  ...over
})

const EPISODE_VIDEO = (over = {}) =>
  VIDEO({
    id: ID.ep3,
    kind: 'episode',
    title: 'Dois em Um',
    year: 2008,
    season: 1,
    episode: 3,
    episodeEnd: 4,
    label: 'S01E03-E04',
    seriesId: ID.show,
    seriesTitle: 'Breaking Bad',
    fileName: 'Breaking Bad S01E03-E04.mkv',
    width: 1920,
    height: 1080,
    duration: 5760,
    progress: { position: 1200, duration: 5760, watched: false },
    prev: { id: ID.ep2, label: 'S01E02', title: 'O Gato Está no Saco' },
    next: { id: ID.ep5, label: 'S02E01', title: 'Temporada Dois' },
    ...over
  })

/* ------------------------------ html checks ------------------------------ */

const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

function assertClean(result, label = '') {
  const { html, problems } = result
  assert.deepEqual(problems, [], `${label}: React warnings`)
  const plain = text(html)
  assert.doesNotMatch(plain, /\bundefined\b|\bNaN\b|\[object|\{\{|\bnull\b/, `${label}: leaked placeholder text`)
  assert.doesNotMatch(html, /<script/i, `${label}: raw <script> in the markup`)
  assert.doesNotMatch(html, /\bsrc="(undefined|null|)"/, `${label}: empty image source`)
  // every image is decorative or described
  for (const tag of html.match(/<img\b[^>]*>/g) || []) assert.match(tag, /\balt="/, `${label}: <img> without alt`)
  // icon-only buttons need a name
  for (const [, attrs, inner] of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const named = /aria-label="[^"]+"/.test(attrs) || /\btitle="[^"]+"/.test(attrs) || text(inner).trim() !== ''
    assert.ok(named, `${label}: unlabeled button ${attrs.slice(0, 80)}`)
  }
  for (const [, attrs, inner] of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
    if (/aria-hidden="true"/.test(attrs)) continue
    const named = /aria-label="[^"]+"/.test(attrs) || text(inner).trim() !== ''
    assert.ok(named, `${label}: unlabeled link ${attrs.slice(0, 80)}`)
  }
  return plain
}

// KAIZEN_UI_DUMP=<dir> also writes every rendered page there, to look at them in a browser
const dumpDir = process.env.KAIZEN_UI_DUMP
let dumped = 0
const page = (name, options) => {
  const result = ui.renderPage(name, options)
  if (dumpDir) {
    fs.mkdirSync(dumpDir, { recursive: true })
    const slug = String(options.path || '').replace(/[a-f0-9]{32}/g, 'ID').replace(/[^\w]+/g, '_')
    const file = `${String(++dumped).padStart(2, '0')}-${name}-${options.lang || 'pt'}${slug}.html`
    fs.writeFileSync(path.join(dumpDir, file), result.html)
  }
  return result
}

/* ------------------------------ Library page ------------------------------ */

it('Library: loading skeleton while the connection is checked', () => {
  const result = page('Library', { path: '/library', route: '/library' })
  const plain = assertClean(result, 'loading')
  assert.match(result.html, /role="status"/)
  assert.match(plain, /Carregando/)
})

it('Library: not connected shows the connect card', () => {
  const result = page('Library', {
    path: '/library',
    route: '/library',
    seed: [[ui.KEYS.status, { connected: false, server: null }]]
  })
  const plain = assertClean(result, 'connect')
  assert.match(plain, /Conecte seu servidor Jellyfin/)
  assert.match(plain, /Jellyfin é um servidor de mídia gratuito/)
  assert.match(result.html, /href="https:\/\/jellyfin\.org"[^>]*target="_blank"[^>]*rel="noreferrer"|rel="noreferrer"[^>]*target="_blank"/)
  assert.match(result.html, /placeholder="http:\/\/192\.168\.0\.10:8096"/)
  assert.match(result.html, /autoComplete="current-password"|autocomplete="current-password"/i)
  assert.match(result.html, /type="password"/)
  assert.match(plain, /Endereço do servidor/)
  assert.match(plain, /Usuário/)
  assert.match(plain, /Senha/)
  assert.match(plain, /Conectar/)
  assert.doesNotMatch(plain, /sem criptografia/, 'no http warning before an address is typed')
})

it('Library: connected, realistic catalog', () => {
  const result = page('Library', {
    path: '/library',
    route: '/library',
    seed: [
      [ui.KEYS.status, STATUS_ON],
      [ui.KEYS.index, INDEX()]
    ]
  })
  const plain = assertClean(result, 'library')
  const { html } = result
  assert.match(plain, /Biblioteca/)
  assert.match(plain, /5 filmes · 3 séries/)
  assert.match(plain, /Casa · 192\.168\.0\.10:8096 · gabriel/)
  assert.match(plain, /Atualizar/)
  assert.match(plain, /Desconectar/)
  assert.match(plain, /Atualizado às \d{1,2}:\d{2}/)
  for (const chip of ['Todos', 'Filmes', 'Séries', 'Minha lista']) assert.match(plain, new RegExp(chip))
  assert.match(html, /aria-pressed="true"[^>]*>Todos/)
  assert.match(plain, /Adicionados recentemente/)

  // continue watching
  assert.match(plain, /Continuar assistindo/)
  assert.match(plain, /Próximo/)
  assert.match(plain, /S01E03 · Caralho Voador/)
  assert.match(plain, /S01E04 · Próximo Episódio|Próximo Episódio/, 'an item without label still renders')
  assert.match(html, new RegExp(`href="/library/watch/${ID.ep3}"`))
  assert.match(html, new RegExp(`href="/library/watch/${ID.dune}"`))
  assert.match(plain, /Faltam 1h 2min|Faltam 1h 1min|Faltam \d+h \d+min|Faltam \d+min/)

  // grid: posters through the proxy, with the token, links to the right pages
  assert.match(html, new RegExp(`src="http://localhost:64621/library/image/${ID.dune}\\?type=primary&amp;w=360&amp;t=TOKEN123"`))
  assert.match(html, new RegExp(`href="/library/movie/${ID.dune}"`))
  assert.match(html, new RegExp(`href="/library/series/${ID.show}"`))
  assert.doesNotMatch(html, new RegExp(`image/${ID.noArt}`), 'no request for an item without art')
  assert.match(plain, /2024 · 2h 46min/)
  assert.match(plain, /5 temporadas · 62 episódios/)
  assert.match(plain, /20\/62/)
  assert.match(plain, /1 temporada · 1 episódio/)
  assert.match(plain, /Sem Episódios/)
  // hearts
  assert.match(html, /aria-label="Remover Duna: Parte Dois da Minha lista"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*aria-label="Remover Duna: Parte Dois da Minha lista"/)
  assert.match(html, /aria-label="Adicionar Amélie à Minha lista"/)
  // progress and watched
  assert.match(html, /role="progressbar"[^>]*aria-valuenow="36"/)
  assert.match(plain, /Assistido/)
  // server text is escaped
  assert.match(html, /Tom &amp; Jerry &lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;quotes&quot;/)
  // a movie with almost no fields still gets a card
  assert.match(plain, /Campos Faltando/)
  assert.deepEqual(result.records.toasts, [])
})

it('Library: the same page in English', () => {
  const result = page('Library', {
    path: '/library',
    route: '/library',
    lang: 'en',
    seed: [
      [ui.KEYS.status, STATUS_ON],
      [ui.KEYS.index, INDEX()]
    ]
  })
  const plain = assertClean(result, 'library en')
  assert.match(plain, /Library/)
  assert.match(plain, /Continue watching/)
  assert.match(plain, /5 movies · 3 series/)
  assert.match(plain, /5 seasons · 62 episodes/)
  assert.match(plain, /Refresh/)
  assert.match(plain, /Disconnect/)
  assert.match(plain, /My list/)
  assert.match(plain, /Recently added/)
  assert.doesNotMatch(plain, /Biblioteca|Atualizar|Filmes/)
})

it('Library: empty server, sparse index and odd values do not break the page', () => {
  const empty = page('Library', {
    path: '/library',
    route: '/library',
    seed: [
      [ui.KEYS.status, STATUS_ON],
      [ui.KEYS.index, { server: SERVER, counts: { movies: 0, series: 0, episodes: 0 }, movies: [], series: [], continueWatching: [], fetchedAt: 1 }]
    ]
  })
  const plain = assertClean(empty, 'empty')
  assert.match(plain, /Seu servidor ainda não tem filmes nem séries/)
  assert.match(plain, /Atualizar/)

  const sparse = page('Library', {
    path: '/library',
    route: '/library',
    seed: [
      [ui.KEYS.status, STATUS_ON],
      [ui.KEYS.index, { movies: [{ id: ID.bad, title: 'Só título' }], series: [{ id: ID.show, key: `s:${ID.show}`, title: 'Só série' }] }]
    ]
  })
  const sparsePlain = assertClean(sparse, 'sparse')
  assert.match(sparsePlain, /Só título/)
  assert.match(sparsePlain, /Só série/)
  assert.match(sparsePlain, /Casa · 192\.168\.0\.10:8096 · gabriel/, 'the chip falls back to the status server')

  const junk = page('Library', {
    path: '/library',
    route: '/library',
    seed: [
      [ui.KEYS.status, { connected: true, server: null }],
      [ui.KEYS.index, { movies: null, series: 'x', continueWatching: [null, { type: 'movie' }] }]
    ]
  })
  assertClean(junk, 'junk')
})

it('Library: loading the index shows a skeleton under the server chip', () => {
  const result = page('Library', { path: '/library', route: '/library', seed: [[ui.KEYS.status, STATUS_ON]] })
  const plain = assertClean(result, 'index loading')
  assert.match(plain, /Casa · 192\.168\.0\.10:8096 · gabriel/)
  assert.match(result.html, /aria-busy="true"/)
})

it('Library: SERVER_UNREACHABLE shows the banner with retry and change server', () => {
  const result = page('Library', {
    path: '/library',
    route: '/library',
    seed: [[ui.KEYS.status, STATUS_ON]],
    errors: [[ui.KEYS.index, new ui.LibraryError('SERVER_UNREACHABLE', 'x', 502)]]
  })
  const plain = assertClean(result, 'unreachable')
  assert.match(plain, /Não foi possível falar com o servidor/)
  assert.match(plain, /Tentar de novo/)
  assert.match(plain, /Trocar servidor/)
})

it('Library: other failures show a message and retry; stale data stays visible with a banner', () => {
  const generic = page('Library', {
    path: '/library',
    route: '/library',
    seed: [[ui.KEYS.status, STATUS_ON]],
    errors: [[ui.KEYS.index, new ui.LibraryError('UPSTREAM_ERROR')]]
  })
  const plain = assertClean(generic, 'upstream')
  assert.match(plain, /Algo deu errado/)
  assert.match(plain, /O servidor respondeu com um erro inesperado/)
  assert.match(plain, /Tentar de novo/)

  const local = page('Library', {
    path: '/library',
    route: '/library',
    seed: [[ui.KEYS.status, STATUS_ON]],
    errors: [[ui.KEYS.index, new ui.LibraryError('BACKEND_DOWN')]]
  })
  assert.match(assertClean(local, 'backend down'), /serviço local do aplicativo não está respondendo/)

  const stale = page('Library', {
    path: '/library',
    route: '/library',
    seed: [
      [ui.KEYS.status, STATUS_ON],
      [ui.KEYS.index, INDEX()]
    ]
  })
  assert.doesNotMatch(stale.html, /role="alert"/)
  // data + a failed refetch: seed the data, then mark the query as errored
  const withError = page('Library', {
    path: '/library',
    route: '/library',
    seed: [
      [ui.KEYS.status, STATUS_ON],
      [ui.KEYS.index, INDEX()]
    ],
    errors: [[ui.KEYS.index, new ui.LibraryError('SERVER_UNREACHABLE')]]
  })
  assertClean(withError, 'stale + error')
})

it('Library: AUTH_EXPIRED asks for the password again with the server fixed and the user prefilled', () => {
  const result = page('Library', {
    path: '/library',
    route: '/library',
    seed: [[ui.KEYS.status, { connected: true, server: { ...SERVER, url: 'https://media.example.com/jellyfin' } }]],
    errors: [[ui.KEYS.index, new ui.LibraryError('AUTH_EXPIRED', 'x', 409)]]
  })
  const plain = assertClean(result, 'auth expired')
  assert.match(plain, /Sua sessão expirou/)
  assert.match(plain, /O servidor Casa pediu a senha de gabriel outra vez/)
  assert.match(result.html, /value="gabriel"/)
  assert.match(plain, /Casa · https:\/\/media\.example\.com\/jellyfin/)
  assert.doesNotMatch(result.html, /placeholder="http:\/\/192/, 'the address is not an editable field')
  assert.match(plain, /Alterar servidor/)
  assert.doesNotMatch(plain, /sem criptografia/, 'https')
  assert.match(plain, /Conectar/)
})

it('Library: NOT_CONNECTED from a request falls back to the connect form', () => {
  const result = page('Library', {
    path: '/library',
    route: '/library',
    seed: [[ui.KEYS.status, STATUS_ON]],
    errors: [[ui.KEYS.index, new ui.LibraryError('NOT_CONNECTED', 'x', 409)]]
  })
  const plain = assertClean(result, 'not connected error')
  assert.match(plain, /Conecte seu servidor Jellyfin/)
})

/* ------------------------------ ConnectCard ------------------------------ */

it('ConnectCard: reconnect with the saved address over http warns about the missing encryption', () => {
  const insecure = ui.renderPart('ConnectCard', {
    mode: 'reconnect',
    server: { ...SERVER, url: 'http://192.168.0.10:8096', allowInvalidCert: true }
  })
  const plain = assertClean(insecure, 'reconnect http')
  assert.match(plain, /Conexão sem criptografia \(http\)/)
  assert.match(plain, /certificado não verificado/)

  const bare = ui.renderPart('ConnectCard', { mode: 'reconnect', server: SERVER })
  const barePlain = assertClean(bare, 'reconnect host only')
  assert.match(bare.html, /value="192\.168\.0\.10:8096"/, 'no saved address: the host is an editable field')
  assert.match(barePlain, /sem criptografia/, 'and a bare host is tried over http')

  const english = ui.renderPart('ConnectCard', { mode: 'connect', onCancel: () => {} }, { lang: 'en' })
  const enPlain = assertClean(english, 'connect en')
  assert.match(enPlain, /Connect your Jellyfin server/)
  assert.match(enPlain, /Cancel/)
  assert.match(enPlain, /Server address/)
})

/* ------------------------------ Series page ------------------------------ */

const seriesOptions = (over = {}, extra = {}) => ({
  path: `/library/series/${ID.show}`,
  route: '/library/series/:seriesId',
  seed: [[ui.KEYS.series(ID.show), SERIES(over)]],
  ...extra
})

it('Series: loading, hero, actions, seasons and episodes', () => {
  const loading = page('LibrarySeries', { path: `/library/series/${ID.show}`, route: '/library/series/:seriesId' })
  assertClean(loading, 'series loading')
  assert.match(loading.html, /aria-busy="true"/)

  const result = page('LibrarySeries', seriesOptions())
  const plain = assertClean(result, 'series')
  const { html } = result
  assert.match(plain, /Breaking Bad 2008/)
  assert.match(plain, /TV-MA/)
  assert.match(plain, /9,4/)
  assert.match(plain, /Finalizada/)
  assert.match(plain, /Drama, Crime/)
  assert.match(plain, /3 temporadas · 5 episódios · 2 de 5 assistidos/)
  assert.match(html, new RegExp(`image/${ID.show}\\?type=backdrop&amp;w=1280&amp;t=TOKEN123`))
  assert.match(html, new RegExp(`image/${ID.show}\\?type=primary&amp;w=480&amp;t=TOKEN123`))
  // overview as paragraphs of text
  assert.match(html, /<p>A chemistry teacher turned drug manufacturer\.<\/p>/)
  assert.match(html, /<p>He builds an empire\.<\/p>/)
  // next up button: continues the multi-episode file at its saved position
  assert.match(plain, /Continuar S01E03-E04 de 20:00/)
  assert.match(html, new RegExp(`href="/library/watch/${ID.ep3}"`))
  // favorite + mark all
  assert.match(html, /aria-pressed="false"[^>]*>[\s\S]*?Minha lista/)
  assert.match(plain, /Marcar tudo como assistido/)
  // seasons: own labels, specials last, the server's real name kept
  const order = ['Temporada 1', 'A Segunda Fase', 'Especiais'].map((label) => plain.indexOf(label))
  assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], `season order ${order}`)
  assert.doesNotMatch(plain, /Season 1|Specials/)
  // the season of the next episode is open: its episodes only
  assert.match(plain, /S01E01 · Piloto/)
  assert.match(plain, /S01E03-E04 · Dois em Um/)
  assert.doesNotMatch(plain, /Especial: Nos Bastidores/)
  assert.match(plain, /20 jan\.? 2008|20 de jan\.? de 2008/, 'air date shown as that very day')
  assert.match(plain, /1h 36min/)
  assert.match(html, /role="progressbar"[^>]*aria-valuenow="21"/)
  assert.match(plain, /Próximo/, 'the next-up episode is flagged')
  assert.match(html, /aria-label="Marcar Piloto como não assistido"|aria-label="Marcar S01E01 · Piloto como não assistido"/)
  assert.match(html, /aria-label="Assistir S01E03-E04 · Dois em Um"/)
  // episode stills: primary then thumb, with the token
  assert.match(html, new RegExp(`image/${ID.ep1}\\?type=primary&amp;w=400&amp;t=TOKEN123`))
  assert.deepEqual(result.records.toasts, [])
})

it('Series: all watched offers to watch again and to unmark; nothing to play is handled', () => {
  const done = page('LibrarySeries', seriesOptions({ nextUp: null, counts: { seasons: 3, episodes: 5, watched: 5 } }))
  const plain = assertClean(done, 'all watched')
  assert.match(plain, /Assistir de novo desde o início/)
  assert.match(plain, /Marcar tudo como não assistido/)
  assert.match(done.html, new RegExp(`href="/library/watch/${ID.ep1}"`), 'starts again at the first episode')

  const fresh = page('LibrarySeries', seriesOptions({ nextUp: EPISODES.ep1, counts: { seasons: 3, episodes: 5, watched: 0 } }))
  assert.match(assertClean(fresh, 'not started'), /Começar/)

  const none = page('LibrarySeries', seriesOptions({ seasons: [], nextUp: null, counts: { seasons: 0, episodes: 0, watched: 0 } }))
  const nonePlain = assertClean(none, 'no episodes')
  assert.match(nonePlain, /Nenhum episódio encontrado/)
  assert.doesNotMatch(nonePlain, /Marcar tudo/)

  const bare = page(
    'LibrarySeries',
    seriesOptions({ overview: null, genres: null, rating: null, officialRating: null, status: null, hasBackdrop: false, hasImage: false, counts: undefined, nextUp: undefined, favorite: true })
  )
  const barePlain = assertClean(bare, 'bare series')
  assert.match(barePlain, /Sem sinopse/)
  assert.match(bare.html, /aria-pressed="true"[^>]*>[\s\S]*?Na minha lista/)
  assert.doesNotMatch(bare.html, /type=backdrop/)
})

it('Series: specials first when they hold the next episode; English interface', () => {
  const result = page('LibrarySeries', seriesOptions({ nextUp: EPISODES.sp1 }, { lang: 'en' }))
  const plain = assertClean(result, 'series en')
  assert.match(plain, /Especial: Nos Bastidores/)
  assert.match(plain, /Bastidores da série/, 'markup in the synopsis is stripped')
  assert.match(plain, /Specials/)
  assert.match(plain, /Season 1/)
  assert.match(plain, /Ended/)
  assert.match(plain, /Continue S00E01|Start watching/)
})

it('Series: errors', () => {
  const missing = page(
    'LibrarySeries',
    seriesOptions({}, { seed: [], errors: [[ui.KEYS.series(ID.show), new ui.LibraryError('NOT_FOUND', 'x', 404)]] })
  )
  const plain = assertClean(missing, 'not found')
  assert.match(plain, /Não encontramos este item/)
  assert.match(missing.html, /href="\/library"/)

  const expired = page('LibrarySeries', {
    ...seriesOptions({}, { seed: [[ui.KEYS.status, STATUS_ON]] }),
    errors: [[ui.KEYS.series(ID.show), new ui.LibraryError('AUTH_EXPIRED', 'x', 409)]]
  })
  assert.match(assertClean(expired, 'expired'), /Sua sessão expirou/)

  const badId = page('LibrarySeries', { path: '/library/series/not-an-id', route: '/library/series/:seriesId' })
  assert.match(assertClean(badId, 'bad id'), /Não encontramos este item/)
})

/* ------------------------------ Movie page ------------------------------ */

const movieOptions = (over = {}, extra = {}) => ({
  path: `/library/movie/${ID.dune}`,
  route: '/library/movie/:videoId',
  seed: [[ui.KEYS.video(ID.dune), VIDEO(over)]],
  ...extra
})

it('Movie: hero, buttons, details', () => {
  const result = page('LibraryMovie', movieOptions())
  const plain = assertClean(result, 'movie')
  const { html } = result
  assert.match(plain, /Duna: Parte Dois 2024/)
  assert.match(plain, /2h 46min/)
  assert.match(plain, /8,4/)
  assert.match(plain, /4K/)
  assert.match(plain, /Ficção científica, Aventura/)
  assert.match(plain, /Paul Atreides/)
  assert.match(plain, /Continuar de 1:00:00/)
  assert.match(plain, /Assistir do início/)
  assert.match(html, new RegExp(`href="/library/watch/${ID.dune}"`))
  assert.match(plain, /Na minha lista/)
  assert.match(plain, /Marcar como assistido/)
  assert.match(plain, /3840×1606/)
  assert.match(plain, /H\.264 High/)
  assert.match(plain, /Inglês, Português/)
  assert.match(plain, /Legendas Português/)
  assert.match(plain, /12,4 GB/)
  assert.match(plain, /Duna Parte Dois \(2024\)\.mkv/)
  assert.doesNotMatch(plain, /player externo/, 'a supported file has no warning')
})

it('Movie: not started, watched, unsupported, sparse', () => {
  const fresh = page('LibraryMovie', movieOptions({ progress: null }))
  const freshPlain = assertClean(fresh, 'fresh')
  assert.match(freshPlain, /Assistir/)
  assert.doesNotMatch(freshPlain, /Continuar de|Assistir do início/)

  const watched = page('LibraryMovie', movieOptions({ progress: { position: 0, duration: 9960, watched: true } }))
  const watchedPlain = assertClean(watched, 'watched')
  assert.match(watchedPlain, /Assistir de novo/)
  assert.match(watchedPlain, /Marcar como não assistido/)

  const unsupported = page('LibraryMovie', movieOptions({ playback: { supported: false, reason: 'bit-depth' } }))
  const unsupportedPlain = assertClean(unsupported, 'unsupported')
  assert.match(unsupportedPlain, /vai precisar do player externo/)
  assert.match(unsupportedPlain, /10 bits/)

  const sparse = page(
    'LibraryMovie',
    movieOptions({ overview: null, genres: undefined, rating: null, officialRating: null, audio: undefined, subs: undefined, size: null, fileName: undefined, vcodec: undefined, width: 0, height: 0, duration: 0, year: null, hasBackdrop: false, hasImage: false, favorite: false, playback: undefined })
  )
  const sparsePlain = assertClean(sparse, 'sparse movie')
  assert.match(sparsePlain, /Sem sinopse/)
})

it('Movie: an episode id leaves for the series page; errors', () => {
  const episode = page('LibraryMovie', {
    path: `/library/movie/${ID.ep3}`,
    route: '/library/movie/:videoId',
    seed: [[ui.KEYS.video(ID.ep3), EPISODE_VIDEO()]]
  })
  assert.equal(text(episode.html).trim(), '', 'renders nothing: <Navigate> takes over')

  const missing = page('LibraryMovie', {
    path: `/library/movie/${ID.dune}`,
    route: '/library/movie/:videoId',
    errors: [[ui.KEYS.video(ID.dune), new ui.LibraryError('NOT_FOUND', 'x', 404)]]
  })
  assert.match(assertClean(missing, 'movie 404'), /Não encontramos este item/)

  const loading = page('LibraryMovie', { path: `/library/movie/${ID.dune}`, route: '/library/movie/:videoId' })
  assertClean(loading, 'movie loading')
  assert.match(loading.html, /aria-busy="true"/)

  const english = page('LibraryMovie', movieOptions({}, { lang: 'en' }))
  const plain = assertClean(english, 'movie en')
  assert.match(plain, /Continue from 1:00:00/)
  assert.match(plain, /Watch from the start/)
  assert.match(plain, /English, Portuguese/)
  assert.match(plain, /12\.4 GB/)
})

/* ------------------------------ Player page ------------------------------ */

const playerOptions = (video, extra = {}) => ({
  path: `/library/watch/${video.id}`,
  route: '/library/watch/:videoId',
  seed: [[ui.KEYS.video(video.id), video]],
  ...extra
})

it('Player: supported episode mounts Plyr + TracksMenu with the token and the right urls', () => {
  const result = page('LibraryPlayer', playerOptions(EPISODE_VIDEO()))
  const plain = assertClean(result, 'player')
  const { html, records } = result
  assert.match(html, new RegExp(`data-src="http://localhost:64621/library/stream/${ID.ep3}\\?t=TOKEN123"`))
  assert.match(html, /data-type="video\/webm"/)
  assert.equal(records.plyr.length, 1)
  assert.equal(records.plyr[0].source.type, 'video')
  assert.equal(records.plyr[0].options.seekTime, 10)
  assert.equal(records.plyr[0].options.i18n.play, 'Reproduzir')
  assert.ok(!records.plyr[0].options.controls.includes('captions'))
  assert.equal(records.tracks.length, 1)
  assert.equal(records.tracks[0].storageKey, `lib:${ID.ep3}`)
  assert.equal(records.tracks[0].streamUrl, `http://localhost:64621/library/stream/${ID.ep3}?t=TOKEN123`)
  assert.deepEqual(records.tracks[0].urls, [
    `http://localhost:64621/library/mediainfo/${ID.ep3}?t=TOKEN123`,
    `http://localhost:64621/library/subtitles/${ID.ep3}?t=TOKEN123`,
    `http://localhost:64621/library/audio/${ID.ep3}?t=TOKEN123`
  ])
  // title block, navigation
  assert.match(plain, /Breaking Bad/)
  assert.match(plain, /S01E03-E04 - Dois em Um/)
  assert.match(plain, /1h 36min · 1080p/)
  assert.match(html, new RegExp(`href="/library/series/${ID.show}"`))
  assert.match(html, new RegExp(`href="/library/watch/${ID.ep2}"`))
  assert.match(html, new RegExp(`href="/library/watch/${ID.ep5}"`))
  assert.match(plain, /Anterior/)
  assert.match(plain, /Próximo episódio/)
  assert.match(html, /<kbd[^>]*>N<\/kbd>/)
  assert.match(plain, /Voltar à série/)
  assert.doesNotMatch(plain, /não toca no player interno/)
  assert.deepEqual(records.toasts, [])
})

it('Player: a movie, an mp4, the last episode', () => {
  const movie = page('LibraryPlayer', playerOptions(VIDEO({ container: 'mov,mp4,m4a,3gp,3g2,mj2' })))
  const plain = assertClean(movie, 'movie player')
  assert.match(movie.html, /data-type="video\/mp4"/)
  assert.match(plain, /Duna: Parte Dois 2024/)
  assert.match(plain, /Voltar ao filme/)
  assert.doesNotMatch(plain, /Anterior|Próximo episódio/, 'a movie has no episode navigation')

  const last = page('LibraryPlayer', playerOptions(EPISODE_VIDEO({ next: null })))
  const lastPlain = assertClean(last, 'last episode')
  assert.match(lastPlain, /Anterior/)
  assert.doesNotMatch(lastPlain, /Próximo episódio/)

  const sparse = page('LibraryPlayer', playerOptions(VIDEO({ playback: undefined, container: undefined, duration: undefined, width: undefined, height: undefined, prev: undefined, next: undefined, year: null })))
  assertClean(sparse, 'sparse player')
  assert.equal(sparse.records.plyr.length, 1, 'a missing playback field does not block the player')
})

it('Player: an unplayable file never mounts a player and offers the external one', () => {
  const cases = [
    ['bit-depth', /10 bits/],
    ['container', /formato do arquivo \(avi\)/],
    ['video-codec', /codec mpeg4/],
    ['no-video', /não tem faixa de vídeo/],
    ['something-new', /não consegue reproduzir este arquivo/]
  ]
  for (const [reason, expected] of cases) {
    const video = EPISODE_VIDEO({ container: 'avi', vcodec: 'mpeg4', playback: { supported: false, reason } })
    const result = page('LibraryPlayer', playerOptions(video))
    const plain = assertClean(result, `unsupported ${reason}`)
    assert.equal(result.records.plyr.length, 0, `${reason}: no Plyr`)
    assert.equal(result.records.tracks.length, 0, `${reason}: no TracksMenu`)
    assert.doesNotMatch(result.html, /data-testid="plyr"/)
    assert.match(plain, /Este arquivo não toca no player interno/)
    assert.match(plain, expected)
    assert.match(plain, /Abrir no player externo/)
    assert.match(plain, /Usa o player definido em Configurações: C:\\Program Files \(x86\)\\VideoLAN\\VLC\\vlc\.exe/)
    assert.match(plain, /Voltar/)
    assert.doesNotMatch(plain, /Tentar de novo/, `${reason}: nothing to retry`)
  }
  const english = page('LibraryPlayer', playerOptions(VIDEO({ playback: { supported: false, reason: 'bit-depth' } }), { lang: 'en' }))
  const plain = assertClean(english, 'unsupported en')
  assert.match(plain, /does not play in the built-in player/)
  assert.match(plain, /Open in the external player/)
})

it('Player: loading and errors', () => {
  const loading = page('LibraryPlayer', { path: `/library/watch/${ID.dune}`, route: '/library/watch/:videoId' })
  assertClean(loading, 'player loading')
  assert.match(loading.html, /aria-busy="true"/)

  for (const [code, expected] of [
    ['NOT_FOUND', /Não encontramos este item/],
    ['SERVER_UNREACHABLE', /Não foi possível falar com o servidor/],
    ['INTERNAL', /Erro interno/]
  ]) {
    const result = page('LibraryPlayer', {
      path: `/library/watch/${ID.dune}`,
      route: '/library/watch/:videoId',
      errors: [[ui.KEYS.video(ID.dune), new ui.LibraryError(code)]]
    })
    assert.match(assertClean(result, code), expected)
    assert.equal(result.records.plyr.length, 0, `${code}: no player`)
  }
  const bad = page('LibraryPlayer', { path: '/library/watch/xyz', route: '/library/watch/:videoId' })
  assert.match(assertClean(bad, 'bad id'), /Não encontramos este item/)
})

/* ------------------------------ parts ------------------------------ */

it('UnsupportedPanel: every reason, both languages, retry only for runtime failures', () => {
  for (const lang of ['pt', 'en']) {
    for (const reason of ['container', 'video-codec', 'bit-depth', 'no-video', 'playback-error', 'network-error', 'whatever', undefined]) {
      const result = ui.renderPart('UnsupportedPanel', { reason, container: 'avi', codec: 'mpeg4', playerPath: 'C:\\vlc.exe', onExternal() {}, onRetry() {}, backTo: '/library/movie/x' }, { lang })
      const plain = assertClean(result, `${lang}/${reason}`)
      assert.match(plain, lang === 'pt' ? /Abrir no player externo/ : /Open in the external player/)
      const retry = /Tentar de novo|Try again/.test(plain)
      assert.equal(retry, reason === 'playback-error' || reason === 'network-error', `${lang}/${reason} retry button`)
    }
  }
  const network = ui.renderPart('UnsupportedPanel', { reason: 'network-error', onExternal() {} })
  assert.match(text(network.html), /A conexão com o servidor falhou/)
})

it('NextEpisodeOverlay renders nothing without a player container; SmartImage and cards degrade', () => {
  const none = ui.renderPart('NextEpisodeOverlay', { container: null, next: { id: ID.ep5, label: 'S02E01', title: 'x' }, seconds: 10 })
  assert.equal(text(none.html).trim(), '')

  const noArt = ui.renderPart('SmartImage', { sources: [], label: 'Sem arte', className: 'aspect-[2/3] w-40' })
  assert.match(noArt.html, /Sem arte/)
  assert.doesNotMatch(noArt.html, /<img/)
  const withArt = ui.renderPart('SmartImage', { sources: ['', null, 'http://x/a.jpg', 'http://x/b.jpg'] })
  assert.match(withArt.html, /src="http:\/\/x\/a\.jpg"/)
  assert.doesNotMatch(withArt.html, /b\.jpg/)

  const card = ui.renderPart('PosterCard', { item: { id: ID.bad, title: 'Mínimo' } })
  assert.match(assertClean(card, 'minimal card'), /Mínimo/)
  const continueCard = ui.renderPart('ContinueCard', { item: { type: 'movie', videoId: ID.dune, title: 'Filme', position: 5, duration: 100 } })
  assert.match(assertClean(continueCard, 'minimal continue card'), /Filme/)
})
