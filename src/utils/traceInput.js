// Builds what the Trace view needs for one copilot reply, from data this
// browser already has. Nothing here sends anything anywhere.

// The client keeps '' where the server keeps null; the search text is built
// from the server's form, so empty values go back to null.
const orNull = value => (value === '' || value === undefined ? null : value)

export function toTraceRecord(type, record) {
  const common = {
    id: record.id,
    type,
    title: record.title || '',
    approvedForAi: record._approvedForAi !== false,
  }
  if (type === 'task') return {
    ...common, notes: record.notes || '', dueDate: orNull(record.dueDate), dueTime: orNull(record.dueTime),
    priority: record.priority || 'medium', category: record.category || 'Other', completed: Boolean(record.completed),
  }
  if (type === 'reminder') return {
    ...common, date: orNull(record.date), time: orNull(record.time), notes: record.notes || '',
    completed: Boolean(record.completed), seriesId: record.seriesId || null, recurrence: record.recurrence || null,
  }
  return { ...common, body: record.body || '' }
}

const today = () => {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// messages: the chat as shown; botId: the reply being traced.
export function traceInputFor({ messages, botId, records, aiInfo }) {
  const index = messages.findIndex(message => message.id === botId)
  const bot = messages[index]
  const before = messages.slice(0, Math.max(0, index))
  const userIndex = before.map(message => message.role).lastIndexOf('user')
  const user = before[userIndex]
  const history = before
    .slice(0, Math.max(0, userIndex))
    .filter(message => message.role === 'user' || message.role === 'bot')
    .slice(-20)
    .map(message => ({ role: message.role === 'bot' ? 'assistant' : 'user', text: message.text || '' }))
  return {
    message: bot?.trace?.question || user?.text || '',
    history,
    focus: bot?.trace?.focusId
      ? records.find(record => String(record.id) === String(bot.trace.focusId)) || null
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
    model: aiInfo ? { provider: aiInfo.provider, model: aiInfo.model } : null,
    timings: bot?.trace?.sent ? { sent: bot.trace.sent, firstText: bot.trace.firstText, final: bot.trace.final } : null,
    demo: false,
  }
}
