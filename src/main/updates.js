// "Is there a newer Kaizen?": asks GitHub for the latest published release of the project and compares
// its tag with the installed version. Electron-free so it can be unit tested. It only reads public data;
// installing is left to the user (the release page / installer opens in the browser).
export const UPDATE_REPO = { owner: 'Snoopyzin', name: 'Kaizen-animes' }

const NOTES_MAX = 1200

// "v3.1.0", "3.1", "3.1.0-beta.2" -> [3, 1, 0]; anything else -> null
function parts(version) {
  const m = String(version ?? '')
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)] : null
}

// -1 when a < b, 0 when equal, 1 when a > b, null when one of them is not a version
export function compareVersions(a, b) {
  const x = parts(a)
  const y = parts(b)
  if (!x || !y) return null
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

// GitHub release JSON -> what the UI needs. Links are only kept when they point at this project.
export function parseRelease(json, current, repo = UPDATE_REPO) {
  const latest = typeof json?.tag_name === 'string' ? json.tag_name.trim().replace(/^v/i, '') : ''
  const order = compareVersions(current, latest)
  if (!latest || order === null) return { ok: false, error: 'BAD_RESPONSE' }

  const base = `https://github.com/${repo.owner}/${repo.name}/`
  const pageUrl =
    typeof json.html_url === 'string' && json.html_url.startsWith(base) ? json.html_url : `${base}releases`
  const asset = Array.isArray(json.assets)
    ? json.assets.find(
        (a) =>
          typeof a?.name === 'string' &&
          /\.exe$/i.test(a.name) &&
          typeof a.browser_download_url === 'string' &&
          a.browser_download_url.startsWith(`${base}releases/download/`)
      )
    : null
  const notes = typeof json.body === 'string' ? json.body.trim().slice(0, NOTES_MAX) : ''
  return {
    ok: true,
    current: String(current),
    latest,
    hasUpdate: order === -1,
    name: typeof json.name === 'string' ? json.name.slice(0, 120) : '',
    notes,
    publishedAt: typeof json.published_at === 'string' ? json.published_at : null,
    pageUrl,
    downloadUrl: asset ? asset.browser_download_url : null
  }
}

// -> { ok: true, ...parseRelease } | { ok: false, error: NO_RELEASE | RATE_LIMITED | HTTP_ERROR | NETWORK | BAD_RESPONSE }
export async function checkForUpdate({
  current,
  fetchImpl = globalThis.fetch,
  repo = UPDATE_REPO,
  timeoutMs = 10000
} = {}) {
  let response
  try {
    response = await fetchImpl(`https://api.github.com/repos/${repo.owner}/${repo.name}/releases/latest`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Kaizen-updater',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch {
    return { ok: false, error: 'NETWORK' }
  }
  if (response.status === 404) return { ok: false, error: 'NO_RELEASE' } // nothing published yet
  if (response.status === 403 || response.status === 429) return { ok: false, error: 'RATE_LIMITED' }
  if (!response.ok) return { ok: false, error: 'HTTP_ERROR' }
  let json
  try {
    json = await response.json()
  } catch {
    return { ok: false, error: 'BAD_RESPONSE' }
  }
  return parseRelease(json, current, repo)
}
