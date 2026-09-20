import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'

// Firebase refuses a second verification mail requested within about a
// minute of the last one, and the app used to hand that refusal to the
// student on their very first Resend. Hold the button for this long instead.
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
  const { user, configured, refreshUser, resendVerification, verificationSentAt } = useAuth()
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
      setStatus(`Sent to ${user.email}. Older links stop working once a new one is sent.`)
    } catch (error) {
      if (error?.code === 'auth/too-many-requests') {
        // Firebase's own limit. The mail it already sent is almost certainly
        // sitting in a folder; say so rather than just "wait".
        setWaitUntil(Date.now() + 2 * RESEND_COOLDOWN_MS)
        setNow(Date.now())
        setStatus('Firebase is limiting resends for a few minutes. The email it already sent is probably in Junk.')
      } else {
        setStatus(error?.message || 'Could not send the email.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="verify-banner" role="status">
      <span>
        <strong>Verify your email.</strong> We sent a link to <strong>{user.email}</strong> from{' '}
        <code>noreply@planner.chanakyachowdary.in</code>. University mail usually files it under{' '}
        <strong>Junk</strong>. The planner stays read-only until the link is opened.
      </span>
      <span className="verify-banner-actions">
        <button className="btn-ghost" onClick={resend} disabled={busy || secondsLeft > 0}>
          {secondsLeft > 0 ? `Resend in ${secondsLeft}s` : 'Resend'}
        </button>
        <button className="btn-primary" onClick={check} disabled={busy}>I’ve verified</button>
      </span>
      {status && <span className="verify-banner-status">{status}</span>}
    </div>
  )
}
