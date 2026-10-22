// "Follow me on Instagram" gate: shown once, right after the language choice and before the app.
// Instagram offers no way to check who follows an account, so this is a nudge (open the profile, wait
// a few seconds, confirm), never a verification. The unlock is remembered on this machine.
export const INSTAGRAM_URL = 'https://www.instagram.com/gabriel.arm_/'
export const INSTAGRAM_HANDLE = '@gabriel.arm_'
export const FOLLOW_WAIT_SECONDS = 5

const KEY = 'kaizen-follow-gate'

// What the screen shows: the confirm button stays locked until the profile was opened AND the wait
// that starts then is over (`left` = seconds still to wait).
export function followStatus(opened, left) {
  if (!opened) return { ready: false, hint: 'openFirst' }
  if (left > 0) return { ready: false, hint: 'wait' }
  return { ready: true, hint: null }
}

// Instagram @ as the server stores it: no "@", no profile-link prefix, lower-case, 1-30 letters, digits,
// dots and underscores (no ".." and no dot at either end). Returns null when it is not a valid @.
export function normalizeInstagram(input) {
  if (typeof input !== 'string') return null
  let value = input.trim()
  const link = /^(https?:\/\/)?(www\.|m\.)?instagram\.com\/(_u\/)?/i
  if (link.test(value)) value = value.replace(link, '').replace(/[/?#].*$/, '') // a pasted profile link
  value = value.replace(/^@/, '').toLowerCase() // one "@" at most, like the server
  return /^(?!.*\.\.)(?!\.)(?!.*\.$)[a-z0-9._]{1,30}$/.test(value) ? value : null
}

export function isFollowUnlocked(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function unlockFollow(storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, '1')
  } catch {
    /* storage blocked: the screen simply comes back on the next launch */
  }
}
