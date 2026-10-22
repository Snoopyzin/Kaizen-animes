// The login / subscription portal is switched off for now. All of its code is still here: set
// VITE_KAIZEN_AUTH=true (see .env.example) to put the whole app behind login + subscription again.
export const AUTH_ENABLED = import.meta.env?.VITE_KAIZEN_AUTH === 'true'

// The "follow on Instagram" screen (shown once, before the app). Build with VITE_KAIZEN_FOLLOW_GATE=false
// to leave it out, e.g. for automated runs.
export const FOLLOW_GATE_ENABLED = import.meta.env?.VITE_KAIZEN_FOLLOW_GATE !== 'false'
