import { AlertTriangle, X } from 'lucide-react'

/* Reusable confirmation dialog. Reuses the shared `.modal-*` styles. */
export default function ConfirmDialog({
  title = 'Are you sure?',
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onClose,
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <div style={{ color: 'var(--red)', flexShrink: 0, marginTop: '2px' }}>
            <AlertTriangle size={20} />
          </div>
          <p style={{ fontSize: '14px', color: 'var(--text)', lineHeight: 1.5, margin: 0 }}>
            {message}
          </p>
        </div>
        <div className="form-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>{cancelLabel}</button>
          <button type="button" className="btn-danger" onClick={onConfirm} autoFocus>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
