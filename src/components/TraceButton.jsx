import { useEffect, useRef, useState } from 'react'
import { Waypoints } from 'lucide-react'
import { cachedRecords } from '../api/plannerStore'
import { toTraceRecord, traceInputFor } from '../utils/traceInput'

async function localRecords() {
  const [tasks, reminders, notes] = await Promise.all(['task', 'reminder', 'note'].map(cachedRecords))
  return [
    ...tasks.map(record => toTraceRecord('task', record)),
    ...reminders.map(record => toTraceRecord('reminder', record)),
    ...notes.map(record => toTraceRecord('note', record)),
  ]
}

// Opens the step-by-step trace of how a reply was made. The trace code
// (and three.js) is only downloaded on the first click.
export default function TraceButton({ messages, botId, aiInfo, demo = false, label = 'Trace', className = '' }) {
  const handle = useRef(null)
  const opener = useRef(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => () => handle.current?.close(), [])

  async function open() {
    if (busy || handle.current) return
    setBusy(true)
    opener.current = document.activeElement
    try {
      // The demo has no copilot reply, so it traces a sample exchange whose
      // records and reply belong together.
      const [{ mountTrace }, copilot] = await Promise.all([
        import('@gdp/trace/embed'),
        demo
          ? import('@gdp/trace/sample').then(sample => sample.sampleCopilot())
          : localRecords().then(records => traceInputFor({ messages, botId, records, aiInfo })),
      ])
      handle.current = mountTrace({
        copilot,
        onClose: () => {
          handle.current?.close()
          handle.current = null
          opener.current?.focus?.()
        },
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className={`ai-trace-btn ${className}`} onClick={open} disabled={busy}
      title="See how this reply was made, step by step">
      <Waypoints size={13} aria-hidden="true" />
      <span>{busy ? 'Opening…' : label}</span>
    </button>
  )
}
