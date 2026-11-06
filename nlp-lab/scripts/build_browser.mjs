import { loadPyodide } from 'pyodide'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
process.on('uncaughtException', error => { console.error(error.message); process.exit(1) })

execFileSync(process.env.NLP_PYTHON || 'python', ['scripts/prepare_browser.py'], { stdio: 'inherit' })
// Isolate ONNX from Pyodide during the build to keep peak native memory bounded.
const seedTexts = await readFile('.browser-build/seed-texts.json', 'utf8')
const encoderSource = await readFile('src/transformer-encoder.js', 'utf8')
const vectorCache = `.browser-build/vectors-${createHash('sha256').update(seedTexts + encoderSource).digest('hex').slice(0,16)}.json`
let encodedSeed
try { encodedSeed = await readFile(vectorCache, 'utf8') } catch {
  encodedSeed = execFileSync(process.execPath, ['--max-old-space-size=4096', 'scripts/transformer_encode.mjs'], { input: seedTexts, encoding: 'utf8', maxBuffer: 64*1024*1024, stdio: ['pipe','pipe','inherit'] })
  await writeFile(vectorCache, encodedSeed)
}

// Train inside the exact same WASM runtime used by visitors. Native sklearn
// pickles from .lab-data are deliberately never included in a public build.
const py = await loadPyodide()
await py.loadPackage(['nltk', 'scikit-learn', 'pydantic', 'tzdata', 'micropip', 'fastapi'])
await py.runPythonAsync(`
import micropip
await micropip.install('dateparser==1.4.3')
`)
py.unpackArchive(new Uint8Array(await readFile('.browser-build/source.zip')), 'zip', { extractDir: '/lab' })
py.runPython(`import os, sys, json\nos.environ['NLPLAB_DATA_DIR'] = '/seed'\nsys.path.insert(0, '/lab')\nfrom nlplab.browser import transformer_missing, transformer_store`)
py.globals.set('_build_embeddings', encodedSeed)
py.runPython('transformer_store(_build_embeddings)')
await py.runPythonAsync(`
import os, sys, json, zipfile
os.environ['NLPLAB_DATA_DIR'] = '/seed'
os.environ['LOKY_MAX_CPU_COUNT'] = '1'
sys.path.insert(0, '/lab')
from nlplab.api import app
from nlplab.models import create_training_job, train
from nlplab.browser import checkpoint
store = app.state.store
job = create_training_job(store, 'Transformer and classical starter baseline', include_transformer=True)
train(store, job['id'])
result = store.get('models', job['id'])
if result['status'] != 'completed':
    raise RuntimeError(result.get('error', 'Browser baseline training failed'))
store.set_setting('active_model', job['id'])
checkpoint()
with zipfile.ZipFile('/runtime.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    from pathlib import Path
    for folder in ('/lab', '/seed'):
        for file in sorted(Path(folder).rglob('*')):
            if file.is_file() and '__pycache__' not in file.parts and not file.name.endswith(('-wal', '-shm')):
                archive.write(file, str(file).lstrip('/'))
print(json.dumps({'model': job['id'], 'evaluation': result['evaluation']['test']['hybrid:logistic']}))
`)
await writeFile('docs/transformer-browser-results.json', py.runPython("json.dumps({k:v for k,v in result.items() if k not in ('corpus_snapshot','examples_snapshot')}, indent=2)"))
await mkdir('public/runtime', { recursive: true })
await writeFile('public/runtime/nlp-runtime.zip', py.FS.readFile('/runtime.zip'))
await writeFile('public/runtime/transformer-results.json', await readFile('docs/transformer-browser-results.json'))
await writeFile('public/runtime/build.json', JSON.stringify({ pyodide: '314.0.7', source: process.env.GITHUB_SHA || 'local', built: new Date().toISOString() }))
console.log('Browser runtime built with a new synthetic-only model')
process.exit(0)
