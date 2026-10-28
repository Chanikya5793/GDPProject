// A dedicated worker keeps real Python training and inference off the UI thread.
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/'
let python
let persistent = false
let queue = Promise.resolve()
const progress = message => self.postMessage({ type: 'progress', message })
const sync = populate => new Promise((resolve, reject) => python.FS.syncfs(populate, error => error ? reject(error) : resolve()))

async function initialize() {
  progress('Loading Python and scientific packages for this browser…')
  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`)
  python = await loadPyodide({ indexURL: PYODIDE_URL })
  await python.loadPackage(['nltk', 'scikit-learn', 'pydantic', 'tzdata', 'micropip', 'fastapi'])
  progress('Installing the date interpreter…')
  await python.runPythonAsync("import micropip\nawait micropip.install('dateparser==1.4.3')")
  progress('Loading English resources and the trained starter model…')
  const response = await fetch(new URL('../runtime/nlp-runtime.zip', import.meta.url))
  if (!response.ok) throw new Error('The browser NLP bundle could not be loaded. Reload the page.')
  python.unpackArchive(await response.arrayBuffer(), 'zip', { extractDir: '/' })
  python.FS.mkdirTree('/data')
  try {
    python.FS.mount(python.FS.filesystems.IDBFS, {}, '/data')
    await sync(true)
    persistent = true
  } catch (error) {
    console.warn('Browser persistence unavailable; using this session only.', error)
  }
  await python.runPythonAsync(`
import os, sys, shutil, json
os.environ['NLPLAB_DATA_DIR'] = '/data'
os.environ['LOKY_MAX_CPU_COUNT'] = '1'
sys.path.insert(0, '/lab')
if not os.path.exists('/data/lab.sqlite3'):
    shutil.copytree('/seed', '/data', dirs_exist_ok=True)
from nlplab.browser import dispatch, run_pending, checkpoint
# A closed tab cannot leave a retraining job permanently running.
from nlplab.api import app
from nlplab.store import now
for job in app.state.store.all('models'):
    if job['status'] in ('pending', 'running', 'evaluating'):
        job.update(status='failed', error='Interrupted by browser restart', finished_at=now())
        app.state.store.put('models', job['id'], job)
`)
  await save()
  progress(persistent ? 'Python NLP ready. Saved on this browser.' : 'Python NLP ready. Session only; browser storage is unavailable.')
}

async function save() {
  python.runPython('checkpoint()')
  if (persistent) await sync(false)
}

const initialized = initialize()
// Attach a rejection observer immediately, before messages arrive.
initialized.catch(error => self.postMessage({ type: 'progress', error: String(error), message: 'Browser Python could not start. Reload to retry.' }))

self.onmessage = ({ data: { id, path, body } }) => {
  queue = queue.then(async () => {
    try {
      await initialized
      python.globals.set('_request_path', path)
      python.globals.set('_request_json', JSON.stringify(body === undefined ? null : body))
      const result = JSON.parse(python.runPython("dispatch(_request_path, json.loads(_request_json))"))
      if (body !== undefined && result.ok) await save()
      if (path === '/health' && result.ok) result.data = { ...result.data, runtime: 'browser-python', storage: persistent ? 'browser' : 'session' }
      self.postMessage({ id, ...result })
      if (result.background) {
        queue = queue.then(async () => {
          progress('Training and evaluating a candidate in this browser…')
          python.runPython('run_pending()')
          await save()
          progress('Candidate evaluation finished. Review it in Experiments before activation.')
        }).catch(error => self.postMessage({ type: 'progress', error: String(error), message: 'Candidate training failed. The active model was retained.' }))
      }
    } catch (error) {
      self.postMessage({ id, ok: false, error: `Browser NLP: ${error.message || error}` })
    }
  })
}
