import fs from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'src')
const dict = { pt: {}, en: {} }
for (const lang of ['pt', 'en']) {
  const dir = path.join(root, 'i18n/locales', lang)
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.json')) dict[lang][f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  }
}

// 1) namespaces / keys parity
let problems = 0
const namespaces = new Set([...Object.keys(dict.pt), ...Object.keys(dict.en)])
for (const ns of namespaces) {
  const a = Object.keys(dict.pt[ns] || {})
  const b = Object.keys(dict.en[ns] || {})
  const onlyPt = a.filter((k) => !b.includes(k))
  const onlyEn = b.filter((k) => !a.includes(k))
  if (!dict.pt[ns] || !dict.en[ns] || onlyPt.length || onlyEn.length) {
    problems++
    console.log(`PARITY ${ns}:`, !dict.pt[ns] ? 'missing pt file' : '', !dict.en[ns] ? 'missing en file' : '', onlyPt.length ? `only pt: ${onlyPt.join(', ')}` : '', onlyEn.length ? `only en: ${onlyEn.join(', ')}` : '')
  }
}

// 2) every static t('ns.key') used in source exists
const files = []
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (e.name !== 'locales') walk(p) }
    else if (/\.(jsx?|mjs)$/.test(e.name) && !/ copy/.test(e.name)) files.push(p)
  }
}
walk(root)
const used = new Map()
const dynamic = []
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  for (const m of src.matchAll(/(?<![\w.$])t\(\s*(['"`])([^'"`]+?)\1/g)) {
    const key = m[2]
    if (key.includes('${')) { dynamic.push(`${path.relative(root, f)}: ${key}`); continue }
    if (!used.has(key)) used.set(key, [])
    used.get(key).push(path.relative(root, f))
  }
  for (const m of src.matchAll(/(?<![\w.$])t\(\s*(['"])([^'"]+?)\1\s*\+/g)) dynamic.push(`${path.relative(root, f)}: ${m[2]}…(concat)`)
}
let missing = 0
for (const [key, where] of used) {
  const dot = key.indexOf('.')
  const ns = key.slice(0, dot)
  const k = key.slice(dot + 1)
  for (const lang of ['pt', 'en']) {
    if (dict[lang][ns]?.[k] === undefined) {
      missing++
      console.log(`MISSING ${lang} ${key}  (used in ${[...new Set(where)].join(', ')})`)
    }
  }
}
console.log(`\nnamespaces: ${namespaces.size}, static keys used: ${used.size}, missing: ${missing}, parity problems: ${problems}`)
console.log('dynamic key sites (check by hand):\n  ' + [...new Set(dynamic)].join('\n  '))

// 3) leftovers: JSON keys never referenced (informational)
const unused = []
for (const ns of Object.keys(dict.pt)) for (const k of Object.keys(dict.pt[ns])) if (!used.has(`${ns}.${k}`)) unused.push(`${ns}.${k}`)
console.log(`\nkeys not referenced statically (may be used dynamically): ${unused.length}`)
