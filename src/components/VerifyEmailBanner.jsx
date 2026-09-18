import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

/* Shown while the signed-in address is unverified. The planner API refuses
   every request until the link in the verification mail is opened, so
   without this the pages would only say "Verify your email" as an error. */
export default function VerifyEmailBanner() {
  const { user, configured, refreshUser, resendVerification } = useAuth()
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  if (!configured || !user || user.emailVerified) return null

  const check = async () => {
    setBusy(true)
    setStatus('')
    try {
      const refreshed = await refreshUser()
      if (!refreshed?.emailVerified) setStatus('Not verified yet. Open the link in the email, then try again.')
    } catch (error) {
      setStatus(error?.message || 'Could not check just now.')
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    setBusy(true)
    setStatus('')
    try {
      await resendVerification()
      setStatus(`Sent to ${user.email}.`)
    } catch (error) {
      setStatus(error?.code === 'auth/too-many-requests'
        ? 'Too many requests. Wait a few minutes before resending.'
        : error?.message || 'Could not send the email.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="verify-banner" role="status">
      <span>
        <strong>Verify your email.</strong> We sent a link to {user.email}; the planner stays read-only until it is opened.
      </span>
      <span className="verify-banner-actions">
        <button className="btn-ghost" onClick={resend} disabled={busy}>Resend</button>
        <button className="btn-primary" onClick={check} disabled={busy}>I’ve verified</button>
      </span>
      {status && <span className="verify-banner-status">{status}</span>}
    </div>
  )
}
