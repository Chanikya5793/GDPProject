import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

/* Reusable confirmation dialog. Reuses the shared `.modal-*` styles.

   The confirm button is disabled from the first click until `onConfirm`
   settles, so a double-click or a held Enter cannot run a delete twice, and
   Escape closes it like the close button does. */
export default function ConfirmDialog({
  title = 'Are you sure?',
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onClose,
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape' && !busy) onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onConfirm()
    } catch (err) {
      setError(err?.message || 'That did not work. Please try again.')
      setBusy(false)
    }
    // On success the caller unmounts the dialog; no state to reset.
  }

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }} role="alertdialog" aria-modal="true">
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose} disabled={busy} aria-label="Close"><X size={16} /></button>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <div style={{ color: 'var(--red)', flexShrink: 0, marginTop: '2px' }}>
            <AlertTriangle size={20} />
          </div>
          <p style={{ fontSize: '14px', color: 'var(--text)', lineHeight: 1.5, margin: 0 }}>
            {message}
          </p>
        </div>
        {error && <p className="login-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>{cancelLabel}</button>
          <button type="button" className="btn-danger" onClick={confirm} disabled={busy} autoFocus>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
