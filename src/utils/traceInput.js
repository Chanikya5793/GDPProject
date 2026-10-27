// Builds what the Trace view needs for one copilot reply, from data this
// browser already has. Nothing here sends anything anywhere.
import { toHistory } from './chatHistory'

// The client keeps '' where the server keeps null; the search text is built
// from the server's form, so empty values go back to null.
const orNull = value => (value === '' || value === undefined ? null : value)

// One record in the server's field set, under the client's names. The trace
// rebuilds the search index and the prompt from these, so every field the
// server reads is carried: dates, estimates, revision, approved attachments.
export function toTraceRecord(type, record) {
  const common = {
    id: record.id,
    type,
    title: record.title || '',
    approvedForAi: record._approvedForAi !== false,
    revision: record._revision ?? null,
    updatedAt: record.updatedAt || null,
  }
  if (type === 'task') return {
    ...common, notes: record.notes || '', dueDate: orNull(record.dueDate), dueTime: orNull(record.dueTime),
    priority: record.priority || 'medium', category: record.category || 'Other', completed: Boolean(record.completed),
    estimatedMinutes: record.estimatedMinutes || 30, keepScheduled: Boolean(record.keepScheduled),
  }
  if (type === 'reminder') return {
    ...common, date: orNull(record.date), time: orNull(record.time), notes: record.notes || '',
    completed: Boolean(record.completed), seriesId: record.seriesId || null, recurrence: record.recurrence || null,
  }
  if (type === 'schedule') return {
    ...common, startsAt: record.starts_at || record.startsAt || null, endsAt: record.ends_at || record.endsAt || null,
    notes: record.notes || '',
  }
  return {
    ...common, body: record.body || '',
    attachments: (record.attachments || []).filter(a => a.text).map(a => ({ text: a.text, approvedForAi: Boolean(a.approvedForAi) })),
  }
}

const today = () => {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// What an assistant turn proposed, by record, as the server replays it
// (api.py proposed_changes): live replies carry proposals, restored ones the
// stored list.
function proposedOf(message) {
  if (message.proposed?.length) return message.proposed
  const byRecord = new Map((message.citations || []).map(c => [c.record_id, c.citation_id]))
  return (message.proposals || []).slice(0, 20).map(p => {
    const change = { operation: p.operation, entity_type: p.entity_type }
    if (p.record_id) change.record_id = p.record_id
    if (byRecord.get(p.record_id)) change.citation_id = byRecord.get(p.record_id)
    const title = (p.after || p.before)?.title
    if (title) change.title = title
    return change
  })
}

// messages: the chat as shown; botId: the reply being traced.
export function traceInputFor({ messages, botId, records }) {
  const index = messages.findIndex(message => message.id === botId)
  const bot = messages[index]
  const before = messages.slice(0, Math.max(0, index))
  const userIndex = before.map(message => message.role).lastIndexOf('user')
  const user = before[userIndex]
  const prior = before.slice(0, Math.max(0, userIndex))
  // Exactly the history this device sent with the question (toHistory), with
  // what each assistant turn proposed, as a stored thread replays it.
  const kept = prior.filter(message => message.id !== 'welcome' && message.role !== 'error' && String(message.text || '').trim())
  const history = toHistory(prior).map((turn, i, all) => {
    const source = kept[kept.length - all.length + i]
    const proposed = turn.role === 'assistant' && source ? proposedOf(source) : []
    return proposed.length ? { ...turn, proposed } : turn
  })
  // Sources cited earlier in the thread keep their S-numbers on the server,
  // which is how the copilot can point back at them.
  const earlier = []
  for (const message of prior) {
    for (const citation of message.citations || []) {
      if (!earlier.some(item => item.citation_id === citation.citation_id)) {
        earlier.push({
          citation_id: citation.citation_id, entity_type: citation.entity_type || null,
          record_id: citation.record_id, title: citation.title,
        })
      }
    }
  }
  const focusId = bot?.trace?.focusId
  const focusType = bot?.trace?.focusType
  return {
    message: bot?.trace?.question || user?.text || '',
    history,
    earlier,
    focus: focusId
      ? records.find(record => String(record.id) === String(focusId) && (!focusType || record.type === focusType)) || null
      : null,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    today: today(),
    records,
    response: bot ? {
      answer: bot.text || '',
      steps: bot.steps || [],
      citations: bot.citations || [],
      retrieval: bot.retrieval || null,
      proposals: bot.proposals || [],
      unavailable: bot.unavailable || [],
    } : null,
    timings: bot?.trace?.sent ? { sent: bot.trace.sent, firstText: bot.trace.firstText, final: bot.trace.final } : null,
    demo: false,
  }
}
