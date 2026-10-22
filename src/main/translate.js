// Electron-free machine translation (to Portuguese) used for subtitles and API texts.
// Providers are tried in order: DeepL (only when the user set a key), then two keyless endpoints.

// Keyless, batch-friendly (the Chrome dictionary extension endpoint): one `q` per line, answers
// an aligned JSON array.
async function translateViaChromeDict(lines) {
  const body = new URLSearchParams()
  lines.forEach((l) => body.append('q', l))
  const res = await fetch('https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=pt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  if (!res.ok) throw new Error(`translate HTTP ${res.status}`)
  const json = await res.json() // an HTML captcha page when blocked -> throws here
  const out = json.map((x) => (Array.isArray(x) ? x[0] : x))
  if (out.length !== lines.length) throw new Error('translate: line count mismatch')
  return out
}

async function translateViaGoogle(lines) {
  const res = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=pt&dt=t', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: lines.join('\n') }).toString()
  })
  if (!res.ok) throw new Error(`translate HTTP ${res.status}`)
  const json = await res.json()
  const out = json[0]
    .map((seg) => seg[0])
    .join('')
    .split('\n')
  if (out.length !== lines.length) throw new Error('translate: line count mismatch')
  return out
}

// Optional, most reliable: set "deeplApiKey" (free tier at deepl.com/pro-api) in settings.json
async function translateViaDeepL(lines, key) {
  const host = key.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com'
  const body = new URLSearchParams({ target_lang: 'PT-BR' })
  lines.forEach((l) => body.append('text', l))
  const res = await fetch(`https://${host}/v2/translate`, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  })
  if (!res.ok) throw new Error(`DeepL HTTP ${res.status}`)
  return (await res.json()).translations.map((t) => t.text)
}

// getDeeplKey is called on every request so a key added in settings.json is picked up at once
export function createTranslator({ getDeeplKey = () => '' } = {}) {
  async function translateLines(lines) {
    const deeplKey = getDeeplKey()
    const providers = [
      ...(deeplKey ? [() => translateViaDeepL(lines, deeplKey)] : []),
      () => translateViaChromeDict(lines),
      () => translateViaGoogle(lines)
    ]
    let lastError
    for (const provider of providers) {
      try {
        return await provider()
      } catch (error) {
        lastError = error
        console.error('Translation provider failed:', error.message)
      }
    }
    throw lastError
  }

  // returns { cues, failed }: when every provider fails the cues keep their original text
  async function translateCues(cues) {
    const BATCH = 40
    const lines = cues.map((c) => c.t.replace(/\n/g, ' '))
    const out = []
    let failed = false
    for (let i = 0; i < lines.length; i += BATCH) {
      const batch = lines.slice(i, i + BATCH)
      try {
        out.push(...(await translateLines(batch)))
      } catch {
        failed = true
        out.push(...batch)
      }
    }
    return { cues: cues.map((c, i) => ({ ...c, t: out[i] })), failed }
  }

  return { translateLines, translateCues }
}
