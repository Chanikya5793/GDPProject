export async function api(path, body) {
  if (import.meta.env.VITE_NLP_RUNTIME === 'browser') {
    const { browserAPI } = await import('./browser-client')
    return browserAPI(path, body)
  }
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = Array.isArray(data.detail) ? data.detail.map(e => `${e.loc?.join('.')}: ${e.msg}`).join('; ') : data.detail
    throw new Error(message || `Request failed (${response.status})`)
  }
  return data
}

export function download(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function highlightedSegments(text, evidence) {
  const spans = evidence.filter(e => Number.isInteger(e.start) && e.start >= 0 && e.end > e.start && e.end <= text.length).sort((a,b) => a.start - b.start)
  const result = []; let cursor = 0
  for (const span of spans) {
    if (span.start < cursor) continue
    if (span.start > cursor) result.push({ text: text.slice(cursor, span.start) })
    result.push({ text: text.slice(span.start, span.end), field: span.field || span.kind, rule: span.rule_id })
    cursor = span.end
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor) })
  return result
}
