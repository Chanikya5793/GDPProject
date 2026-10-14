import { useEffect, useRef, useState } from 'react'

// Saves that finish faster than this never show the busy look: flashing a
// spinner (or a grayed button) for a few milliseconds reads as lag.
const BUSY_LOOK_DELAY_MS = 200

/**
 * Runs a modal's save once at a time and keeps its error for the modal to show.
 * The guard is a ref, not state, so a double click inside one frame still
 * reaches it before React re-renders the disabled button.
 */
export function useSubmit(onSave) {
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => () => { mounted.current = false }, [])

  const submit = async (payload) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      await onSave(payload)
    } catch (err) {
      if (mounted.current) setError(err?.message || 'Something went wrong. Try again.')
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return { submit, busy, error, setError }
}

export default function SubmitButton({ busy, children, className = 'btn-primary' }) {
  const [showBusy, setShowBusy] = useState(false)

  useEffect(() => {
    if (!busy) {
      setShowBusy(false)
      return undefined
    }
    const timer = setTimeout(() => setShowBusy(true), BUSY_LOOK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [busy])

  return (
    <button
      type="submit"
      className={`${className} btn-submit${showBusy ? ' is-busy' : ''}`}
      disabled={busy}
      aria-busy={busy}
    >
      {showBusy && <span className="btn-spinner" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function SubmitError({ message }) {
  if (!message) return null
  return <p className="modal-submit-error" role="alert">{message}</p>
}
