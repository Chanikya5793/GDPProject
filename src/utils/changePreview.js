// What a proposed change looks like to a person.
//
// The preview used to be JSON.stringify of the record before and after, so
// asking for a reminder produced a wall of braces and snake_case keys. That is
// the shape of the storage, not the shape of the decision: what someone needs
// in order to press Confirm is the title, when it lands, and what is different
// about it.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A date said the way a person says it: "Fri 4 Sep". Empty when there is none. */
export function spokenDate(value) {
  if (!value) return ''
  const [year, month, day] = String(value).split('-').map(Number)
  if (!year || !month || !day) return String(value)
  const date = new Date(Date.UTC(year, month - 1, day))
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()]
  return `${weekday} ${day} ${MONTHS[month - 1]}`
}

/** A 24-hour time as a clock reading: "1:30 PM". */
export function spokenTime(value) {
  if (!value) return ''
  const [hour, minute] = String(value).split(':').map(Number)
  if (Number.isNaN(hour)) return String(value)
  const suffix = hour < 12 ? 'AM' : 'PM'
  const clock = hour % 12 === 0 ? 12 : hour % 12
  return `${clock}:${String(minute || 0).padStart(2, '0')} ${suffix}`
}

/** When a record lands, however its type spells that. */
export function spokenWhen(content) {
  if (!content) return ''
  const day = spokenDate(content.due_date || content.date)
  const time = spokenTime(content.due_time || content.time)
  if (day && time) return `${day} at ${time}`
  return day || time || 'no date'
}

const FIELDS = [
  ['title', 'Title', value => value],
  ['due_date', 'Date', spokenDate],
  ['date', 'Date', spokenDate],
  ['due_time', 'Time', spokenTime],
  ['time', 'Time', spokenTime],
  ['priority', 'Priority', value => value],
  ['category', 'Category', value => value],
  ['notes', 'Notes', value => value],
  ['body', 'Text', value => value],
  ['completed', 'Done', value => (value ? 'yes' : 'no')],
  ['keep_scheduled', 'Pinned', value => (value ? 'yes' : 'no')],
]

/**
 * The change as a short list of lines, one per thing that is different.
 *
 * A create has no "before", so it reads as what will exist. An edit lists only
 * the fields that actually move, because showing every unchanged field is what
 * made the old preview unreadable.
 */
export function changeLines(proposal) {
  const before = proposal?.before
  const after = proposal?.after

  if (!after) {
    return [{ label: 'Deletes', to: before?.title || 'this record' }]
  }
  if (!before) {
    const lines = [{ label: 'Adds', to: after.title }]
    const when = spokenWhen(after)
    if (when && when !== 'no date') lines.push({ label: 'When', to: when })
    if (after.priority && after.priority !== 'medium') {
      lines.push({ label: 'Priority', to: after.priority })
    }
    if (after.keep_scheduled) lines.push({ label: 'Pinned', to: 'yes' })
    return lines
  }

  const lines = []
  const seen = new Set()
  for (const [key, label, format] of FIELDS) {
    if (seen.has(label)) continue
    if (!(key in after) && !(key in before)) continue
    const from = before[key]
    const to = after[key]
    if (from === to) continue
    seen.add(label)
    lines.push({ label, from: format(from) || '—', to: format(to) || '—' })
  }
  return lines.length ? lines : [{ label: 'No visible change', to: after.title }]
}

/** A one-line summary for a batch, where each change gets a single row. */
export function changeSummary(proposal) {
  const title = proposal?.after?.title || proposal?.before?.title || proposal?.entity_type
  if (!proposal?.after) return `Delete ${title}`
  if (!proposal?.before) return `Add ${title}${spokenWhen(proposal.after) !== 'no date' ? ` · ${spokenWhen(proposal.after)}` : ''}`
  const first = changeLines(proposal)[0]
  return first?.from ? `${title} · ${first.label} ${first.from} → ${first.to}` : title
}

/** Fields long enough that a from → to row is unreadable and a diff is not. */
const LONG_TEXT = [['body', 'Text'], ['notes', 'Notes']]

/**
 * The long-text field this proposal rewrites, if it rewrites one.
 *
 * Separated from `changeLines` because these two want completely different
 * treatment: a date changing is a from → to row, while a note's body changing
 * is a paragraph that has to be diffed to mean anything. Returns null for a
 * create or a delete, where there is no "before" to compare against.
 */
export function longTextChange(proposal) {
  const before = proposal?.before
  const after = proposal?.after
  if (!before || !after) return null
  for (const [key, label] of LONG_TEXT) {
    const from = before[key]
    const to = after[key]
    if (typeof from !== 'string' && typeof to !== 'string') continue
    if ((from || '') === (to || '')) continue
    return { field: key, label, before: from || '', after: to || '' }
  }
  return null
}
