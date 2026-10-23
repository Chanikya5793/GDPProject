import { useEffect, useRef, useState } from 'react'
import { Waypoints } from 'lucide-react'
import { cachedRecords } from '../api/plannerStore'
import { toTraceRecord, traceInputFor } from '../utils/traceInput'

// The planner's current look: its light/dark theme, accent colour and font, which
// the trace view adopts so it reads as part of the planner.
function plannerLook() {
  const root = document.documentElement
  const theme = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
  const style = getComputedStyle(root)
  const accent = style.getPropertyValue(theme === 'dark' ? '--cyber' : '--green').trim() || null
  const font = getComputedStyle(document.body).fontFamily || null
  return { theme, accent, font }
}

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
export default function TraceButton({ messages, botId, demo = false, label = 'Trace', className = '' }) {
  const handle = useRef(null)
  const opener = useRef(null)
  const watcher = useRef(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => () => {
    watcher.current?.disconnect()
    handle.current?.close()
  }, [])

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
          : localRecords().then(records => traceInputFor({ messages, botId, records })),
      ])
      handle.current = mountTrace({
        copilot,
        ...plannerLook(),
        onClose: () => {
          watcher.current?.disconnect()
          handle.current?.close()
          handle.current = null
          opener.current?.focus?.()
        },
      })
      // Follow theme and accent changes while the trace is open.
      watcher.current = new MutationObserver(() => handle.current?.update?.(plannerLook()))
      watcher.current.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] })
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
