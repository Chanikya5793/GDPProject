/* What a page shows when its first load fails: the reason and a way back.
   Every page used to stay on "Loading…" for good when the API refused or
   timed out with nothing cached. */
export default function LoadFailed({ message, onRetry }) {
  return (
    <div className="page-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 12 }}>
      <p className="login-error" role="alert">{message || 'Could not load your planner.'}</p>
      <button className="btn-primary" onClick={onRetry || (() => window.location.reload())}>Try again</button>
    </div>
  )
}
