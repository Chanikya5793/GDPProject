import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { verificationMessage } from '../utils/verificationEmail'

// Give an accepted request time to arrive and avoid rapid repeated sends.
// Firebase may impose a longer cooldown than this client-side minimum.
const RESEND_COOLDOWN_MS = 60_000
// How often to ask Firebase whether the link has been opened. The link is
// clicked in a mail app, not here, so without this the student had to come
// back and press a button -- and then reload -- before anything worked.
const POLL_MS = 8_000
const POLL_FOR_MS = 20 * 60_000

/* Shown while the signed-in address is unverified. The planner API refuses
   every request until the link in the verification mail is opened, so
   without this the pages would only say "Verify your email" as an error. */
export default function VerifyEmailBanner() {
  const { user, configured, refreshUser, resendVerification, verificationSentAt, verificationError } = useAuth()
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [waitUntil, setWaitUntil] = useState(0)
  const mountedAt = useRef(null)
  if (mountedAt.current === null) mountedAt.current = now
  const unverified = configured && user && !user.emailVerified

  // Tick once a second while a cooldown is showing.
  const holdUntil = Math.max(waitUntil, (verificationSentAt || 0) + RESEND_COOLDOWN_MS)
  const secondsLeft = Math.max(0, Math.ceil((holdUntil - now) / 1000))
  useEffect(() => {
    if (!unverified || secondsLeft === 0) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [unverified, secondsLeft])

  // Watch for the link being opened elsewhere. Once it has, the token has
  // already been refreshed by refreshUser; a reload lets every page fetch
  // again with it instead of sitting on the 403 it got before.
  useEffect(() => {
    if (!unverified) return undefined
    let cancelled = false
    const tick = async () => {
      if (document.visibilityState === 'hidden') return
      if (Date.now() - mountedAt.current > POLL_FOR_MS) return
      try {
        const refreshed = await refreshUser()
        if (!cancelled && refreshed?.emailVerified) window.location.reload()
      } catch { /* try again next tick */ }
    }
    const timer = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unverified])

  if (!unverified) return null

  const check = async () => {
    setBusy(true)
    setStatus('')
    try {
      const refreshed = await refreshUser()
      if (refreshed?.emailVerified) {
        window.location.reload()
        return
      }
      setStatus('Not verified yet. Open the link in the newest email, then this page updates on its own.')
    } catch (error) {
      setStatus(error?.message || 'Could not check just now.')
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    if (secondsLeft > 0) return
    setBusy(true)
    setStatus('')
    try {
      await resendVerification()
      setNow(Date.now())
      setStatus(`Verification email requested for ${user.email}. Check your inbox and Junk folder; delivery can take a few minutes.`)
    } catch (error) {
      if (error?.code === 'auth/too-many-requests') {
        // A provider rate limit does not establish that any mail arrived.
        setWaitUntil(Date.now() + 2 * RESEND_COOLDOWN_MS)
        setNow(Date.now())
        setStatus(verificationMessage(error))
      } else {
        setStatus(verificationMessage(error))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="verify-banner" role="status">
      <span>
        <strong>Verify your email.</strong>{' '}
        {verificationSentAt ? 'A verification email was requested for ' : 'Request a verification link for '}
        <strong>{user.email}</strong>. Check your inbox and <strong>Junk</strong> for{' '}
        <code>noreply@planner.chanakyachowdary.in</code>. If it is missing, ask university IT to check quarantine
        for this sender. Cloud sync requires a verified email.
      </span>
      <span className="verify-banner-actions">
        <button className="btn-ghost" onClick={resend} disabled={busy || secondsLeft > 0}>
          {secondsLeft > 0 ? `Resend in ${secondsLeft}s` : 'Resend'}
        </button>
        <button className="btn-primary" onClick={check} disabled={busy}>I’ve verified</button>
      </span>
      {(status || verificationError) && <span className="verify-banner-status">{status || verificationError}</span>}
    </div>
  )
}
