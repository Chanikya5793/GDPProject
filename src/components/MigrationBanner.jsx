import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  hasLegacyPlannerData, legacyDataSummary, migrateLegacyPlannerData,
} from '../migration/localStorageMigration'

const DISMISSED_KEY = 'nw_migration_dismissed'

function summary(result) {
  const parts = [`${result.imported} moved`]
  if (result.skipped) parts.push(`${result.skipped} already there`)
  if (result.rejected?.length) parts.push(`${result.rejected.length} could not be read`)
  return parts.join(', ')
}

export default function MigrationBanner() {
  const { user, configured } = useAuth()
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  // Demo mode has no cloud to move anything into, so the offer would only
  // ever fail with "not configured"; the old records stay where they are.
  useEffect(() => {
    let dismissed = false
    try { dismissed = sessionStorage.getItem(DISMISSED_KEY) === '1' } catch { /* storage blocked */ }
    setVisible(Boolean(user && configured && !dismissed && hasLegacyPlannerData()))
  }, [user, configured])
  if (!visible) return null
  const count = Object.values(legacyDataSummary()).reduce((sum, value) => sum + value, 0)

  const migrate = async () => {
    setStatus('working')
    setError('')
    try {
      const result = await migrateLegacyPlannerData(user.uid)
      setDone(summary(result))
      setStatus('done')
      // The pages read from the server on mount; a reload is the one way to
      // make every one of them pick the moved records up at once.
      setTimeout(() => window.location.reload(), 1500)
    } catch (migrationError) {
      setStatus('idle')
      setError(migrationError.message || 'The migration did not go through. Try again.')
    }
  }

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISSED_KEY, '1') } catch { /* storage blocked */ }
    setVisible(false)
  }

  return (
    <div className="migration-banner" role="status">
      <ShieldCheck size={18} />
      <div>
        <strong>Secure your existing planner data</strong>
        <span>
          {status === 'done'
            ? `Done: ${done}. Reloading…`
            : `${count} local records are ready for encrypted, account-scoped migration.`}
        </span>
        {error && <span className="migration-error">{error}</span>}
      </div>
      {status !== 'done' && (
        <button type="button" className="btn-secondary" onClick={dismiss} disabled={status === 'working'}>
          Not now
        </button>
      )}
      <button type="button" className="btn-primary" onClick={migrate} disabled={status !== 'idle'}>
        {status === 'working' ? 'Migrating…' : status === 'done' ? 'Migrated' : 'Migrate now'}
      </button>
    </div>
  )
}
