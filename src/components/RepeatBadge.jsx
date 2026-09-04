import { Repeat } from 'lucide-react'
import { recurrenceDetail, recurrenceLabel } from '../utils/recurrence'
import '../css/RepeatBadge.css'

/**
 * Marks a row as one of a repeating series.
 *
 * Every occurrence is a real record, so nothing about the row itself says it
 * belongs to a series. Deleting one leaves the other twelve, which is right but
 * surprising unless the row says so first.
 */
export default function RepeatBadge({ recurrence }) {
  const label = recurrenceLabel(recurrence)
  if (!label) return null
  return (
    <span className="repeat-badge" title={recurrenceDetail(recurrence)}>
      <Repeat size={10} aria-hidden="true" />
      {label}
    </span>
  )
}
