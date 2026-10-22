// When the app should look for a new version on its own, and when it should tell the user about one.
// Pure helpers (no react, no i18n) so they can be unit tested.
export const AUTO_CHECK_KEY = 'checkForUpdates' // 'false' turns the automatic check off
export const LAST_CHECK_KEY = 'kaizen-update-last-check'
export const NOTIFIED_KEY = 'kaizen-update-notified'
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

const read = (storage, key) => {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

export const autoCheckEnabled = (storage = globalThis.localStorage) => read(storage, AUTO_CHECK_KEY) !== 'false'

export function setAutoCheck(enabled, storage = globalThis.localStorage) {
  try {
    storage?.setItem(AUTO_CHECK_KEY, enabled ? 'true' : 'false')
  } catch {
    /* storage blocked: the choice lasts until the app closes */
  }
}

// at most once per CHECK_EVERY_MS (a clock set back counts as "long ago")
export function shouldCheckNow({ enabled, last, now }) {
  if (!enabled) return false
  const lastTs = Number(last) || 0
  return lastTs > now || now - lastTs >= CHECK_EVERY_MS
}

// tell the user once per version
export const shouldNotify = (result, notifiedVersion) =>
  !!(result && result.ok && result.hasUpdate && result.latest && result.latest !== notifiedVersion)

export const remember = (key, value, storage = globalThis.localStorage) => {
  try {
    storage?.setItem(key, String(value))
  } catch {
    /* ignore */
  }
}
export const recall = (key, storage = globalThis.localStorage) => read(storage, key)
