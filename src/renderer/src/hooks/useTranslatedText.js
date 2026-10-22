import { useEffect, useState } from 'react'
import { getLanguage } from '../i18n'

// Machine-translates API text (AniList synopses, episode summaries...: always English) into
// Portuguese through the local backend. Every paragraph is cached in localStorage, so each text is
// translated once, and requests from many components are coalesced into a few batched calls.
const CACHE_PREFIX = 'kaizen-tr:'
const FLUSH_MS = 150
const MAX_BATCH = 40

const hash = (s) => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36) + s.length.toString(36)
}

const readCache = (key) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const writeCache = (key, value) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage full / unavailable */
  }
}

// HTML (AniList) or plain text (MAL, ani.zip) -> paragraphs of plain text
const toParagraphs = (input) => {
  const html = String(input).replace(/<br\s*\/?>/gi, '\n')
  const text = new DOMParser().parseFromString(html, 'text/html').body.textContent || ''
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/* ---------------- batching queue (shared by all components) ---------------- */
const pending = new Map() // paragraph -> { resolvers: [], reject: [] }
let timer = null
let port = null

function flush() {
  timer = null
  const entries = [...pending.entries()]
  pending.clear()
  for (let i = 0; i < entries.length; i += MAX_BATCH) {
    const chunk = entries.slice(i, i + MAX_BATCH)
    fetch(`http://localhost:${port}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: chunk.map(([text]) => text) })
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(({ texts }) => {
        chunk.forEach(([text, waiters], k) => {
          const out = texts[k] ?? text
          writeCache(CACHE_PREFIX + hash(text), out)
          waiters.resolve.forEach((fn) => fn(out))
        })
      })
      .catch((error) => chunk.forEach(([, waiters]) => waiters.reject.forEach((fn) => fn(error))))
  }
}

function translateParagraph(text, backendPort) {
  const cached = readCache(CACHE_PREFIX + hash(text))
  if (cached) return Promise.resolve(cached)
  port = backendPort
  return new Promise((resolve, reject) => {
    const waiters = pending.get(text) || { resolve: [], reject: [] }
    waiters.resolve.push(resolve)
    waiters.reject.push(reject)
    pending.set(text, waiters)
    if (!timer) timer = setTimeout(flush, FLUSH_MS)
  })
}

// returns { translated: string | null, loading: boolean }; translated is null when not applicable
export default function useTranslatedText(text, backendPort) {
  const [state, setState] = useState({ translated: null, loading: false })

  useEffect(() => {
    if (!text || !backendPort || getLanguage() !== 'pt') {
      setState({ translated: null, loading: false })
      return
    }
    const paragraphs = toParagraphs(text).slice(0, 40)
    if (!paragraphs.length) return

    // instant when everything is cached
    const cachedAll = paragraphs.map((p) => readCache(CACHE_PREFIX + hash(p)))
    if (cachedAll.every(Boolean)) {
      setState({ translated: cachedAll.join('\n\n'), loading: false })
      return
    }

    let cancelled = false
    setState({ translated: null, loading: true })
    Promise.all(paragraphs.map((p) => translateParagraph(p, backendPort)))
      .then((out) => !cancelled && setState({ translated: out.join('\n\n'), loading: false }))
      .catch(() => !cancelled && setState({ translated: null, loading: false })) // keep the original
    return () => {
      cancelled = true
    }
  }, [text, backendPort])

  return state
}
