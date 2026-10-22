import { enUS, ptBR } from 'date-fns/locale'

// Strings live in ./locales/<lang>/<namespace>.json (one namespace per screen/component).
// Keys are flat inside a namespace and may contain dots: t('home.sections.airing').
// Interpolation: "Olá, {{name}}" + t('ns.key', { name }).
const modules = import.meta.glob('./locales/*/*.json', { eager: true })
const dictionary = { pt: {}, en: {} }
for (const [path, mod] of Object.entries(modules)) {
  const match = path.match(/\.\/locales\/([a-z]+)\/(.+)\.json$/)
  if (match && dictionary[match[1]]) dictionary[match[1]][match[2]] = mod.default ?? mod
}

export const LANGUAGES = [
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'English' }
]

const STORAGE_KEY = 'kaizen-language'

const read = (store) => {
  try {
    const value = store.getItem(STORAGE_KEY)
    return value === 'pt' || value === 'en' ? value : null
  } catch {
    return null
  }
}

// The language is asked on every launch: the choice made in this run lives in sessionStorage (it
// survives the page reload that applies it, but is gone when the app is closed). localStorage only
// remembers the last choice, to highlight it on the next start.
export const getStoredLanguage = () => read(sessionStorage)
export const getLastLanguage = () => read(localStorage)

// Language is read once at load; changing it reloads the page, so t() can be used anywhere
// (including module-level constants) without needing React state.
let current = getStoredLanguage() || getLastLanguage() || 'pt'

export const getLanguage = () => current
export const hasChosenLanguage = () => getStoredLanguage() !== null

export function setLanguage(lang) {
  for (const store of [sessionStorage, localStorage]) {
    try {
      store.setItem(STORAGE_KEY, lang)
    } catch {
      /* ignore */
    }
  }
  try {
    window.api?.saveToSettings?.('language', lang) // lets the main process localise its dialogs
  } catch {
    /* ignore */
  }
  window.location.reload()
}

export function t(key, vars) {
  const dot = key.indexOf('.')
  const ns = key.slice(0, dot)
  const k = key.slice(dot + 1)
  const text = dictionary[current]?.[ns]?.[k] ?? dictionary.en?.[ns]?.[k] ?? dictionary.pt?.[ns]?.[k]
  if (text === undefined) {
    if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`)
    return key
  }
  return vars ? text.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? '')) : text
}

export const dateLocale = () => (current === 'en' ? enUS : ptBR)

export function useI18n() {
  return { t, lang: current, setLanguage, dateLocale: dateLocale() }
}
