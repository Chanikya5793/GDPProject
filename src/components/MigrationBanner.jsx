import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import {
  hasLegacyPlannerData, legacyDataSummary, migrateLegacyPlannerData,
} from '../migration/localStorageMigration'

export default function MigrationBanner() {
  const { user } = useAuth()
  const [visible, setVisible] = useState(false)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  useEffect(() => setVisible(Boolean(user && hasLegacyPlannerData())), [user])
  if (!visible) return null
  const count = Object.values(legacyDataSummary()).reduce((sum, value) => sum + value, 0)

  const migrate = async () => {
    setStatus('working')
    setError('')
    try {
      await migrateLegacyPlannerData(user.uid)
      setStatus('done')
      setTimeout(() => window.location.reload(), 500)
    } catch (migrationError) {
      setStatus('idle')
      setError(migrationError.message)
    }
  }

  return (
    <div className="migration-banner" role="status">
      <ShieldCheck size={18} />
      <div>
        <strong>Secure your existing planner data</strong>
        <span>{count} local records are ready for encrypted, account-scoped migration.</span>
        {error && <span className="migration-error">{error}</span>}
      </div>
      <button className="btn-primary" onClick={migrate} disabled={status !== 'idle'}>
        {status === 'working' ? 'Migrating…' : status === 'done' ? 'Migrated' : 'Migrate now'}
      </button>
    </div>
  )
}

