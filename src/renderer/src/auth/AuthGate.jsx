import { useState } from 'react'
import { useAuth } from './AuthContext'
import LanguageGate from './LanguageGate'
import FollowGate from './FollowGate'
import LoginPage from './LoginPage'
import SubscriptionExpired from './SubscriptionExpired'
import StatusPill from './StatusPill'
import AuthShell from './AuthShell'
import { hasChosenLanguage } from '../i18n'
import { AUTH_ENABLED, FOLLOW_GATE_ENABLED } from './config'
import { isFollowUnlocked, unlockFollow } from './follow'

// Everything in the app sits behind: language choice -> follow on Instagram (once) -> login ->
// active subscription.
export default function AuthGate({ children }) {
  const { status, me } = useAuth()
  const [followed, setFollowed] = useState(isFollowUnlocked)
  if (!hasChosenLanguage()) return <LanguageGate />
  // with the portal on, the follow rule is enforced by the server (Instagram @ at sign-up), so the
  // local "just open the profile" screen is only for the portal-less build
  if (FOLLOW_GATE_ENABLED && !AUTH_ENABLED && !followed) {
    return (
      <FollowGate
        onUnlock={() => {
          unlockFollow()
          setFollowed(true)
        }}
      />
    )
  }
  if (!AUTH_ENABLED) return children // portal switched off for now (see auth/config.js)
  if (status === 'loading') return <AuthShell>{null}</AuthShell>
  if (status !== 'authenticated') return <LoginPage />
  if (!me?.access) return <SubscriptionExpired />
  return (
    <>
      {children}
      <StatusPill />
    </>
  )
}
