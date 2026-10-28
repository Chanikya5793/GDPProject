let worker
let sequence = 0
const pending = new Map()

export function browserAPI(path, body) {
  if (!worker) {
    worker = new Worker(new URL('./browser-worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        window.dispatchEvent(new CustomEvent('nlp-runtime', { detail: data }))
        return
      }
      const task = pending.get(data.id)
      if (!task) return
      pending.delete(data.id)
      clearTimeout(task.timer)
      if (data.ok) task.resolve(data.data)
      else task.reject(new Error(data.error || 'Browser NLP request failed'))
    }
    worker.onerror = event => {
      for (const task of pending.values()) {
        clearTimeout(task.timer)
        task.reject(new Error(event.message || 'The browser NLP worker stopped. Reload to retry.'))
      }
      pending.clear()
      worker.terminate()
      worker = undefined
    }
  }
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Python is taking longer than expected. Wait for initialization, then reload if needed.')) }, 300000)
    pending.set(id, { resolve, reject, timer })
    worker.postMessage({ id, path, body })
  })
}
