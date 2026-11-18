import { useState } from 'react'
import { LockKeyhole } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function ChangePassword() {
  const { changePassword } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setSaved(false)
    setError('')
    if (newPassword !== confirmation) {
      setError('The new passwords must match.')
      return
    }
    setBusy(true)
    try {
      const result = await changePassword(currentPassword, newPassword)
      if (!result.success) {
        setError(result.error)
        return
      }
      setCurrentPassword('')
      setNewPassword('')
      setConfirmation('')
      setSaved(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <LockKeyhole size={18} />
        <h2>Change password</h2>
      </div>
      <form className="settings-profile-form" onSubmit={submit}>
        <label className="form-group">
          <span className="form-label">Current password</span>
          <input className="form-input" type="password" autoComplete="current-password"
            value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required disabled={busy} />
        </label>
        <label className="form-group">
          <span className="form-label">New password</span>
          <input className="form-input" type="password" autoComplete="new-password"
            value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={6} required disabled={busy} />
        </label>
        <label className="form-group">
          <span className="form-label">Confirm new password</span>
          <input className="form-input" type="password" autoComplete="new-password"
            value={confirmation} onChange={event => setConfirmation(event.target.value)} required disabled={busy} />
        </label>
        <div className="settings-profile-actions">
          {error && <span className="login-error" role="alert">{error}</span>}
          {saved && <span className="settings-saved" role="status">Password updated.</span>}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </div>
      </form>
    </section>
  )
}
