# Browser Python deployment

The independent source branch is `codex/nlp-pages`. The public companion URL is
`https://chanikya5793.github.io/GDPProject/nlp/`. Planner and TRACE contain no
links to it. The lab has `noindex,nofollow` metadata; the URL remains public,
which is how GitHub Pages works. This is not an authentication boundary.

## Runtime

The Pages build runs the real `nlplab` Python code in a dedicated Pyodide
314.0.7 Web Worker. The same FastAPI endpoint functions, Pydantic schemas,
NLTK annotations, TF-IDF/classifiers, extraction/date rules and SQLite store
are used. `nlplab/browser.py` supplies an in-process transport instead of a
socket server or Starlette's thread pool. No alternative JavaScript parser or
recorded response set is used.

`scripts/prepare_browser.py` allowlists source files and English NLTK resources.
`scripts/build_browser.mjs` trains a fresh synthetic-only model inside the exact
WASM runtime, evaluates it, activates that starter model, and packages a clean
seed database. It never packages `.lab-data`, imported records, local reviews,
native model pickles, credentials, or the presenter's private data.

Visitors download the Python/scientific packages from the pinned Pyodide CDN,
dateparser from PyPI, and the source/resource/model bundle from this Pages path.
The first visit can take a minute on a slower connection. Analysis, reviewed
corrections, snapshot imports, experiments, retraining, activation and rollback
run in the browser worker. SQLite and model artifacts persist in IndexedDB on
that browser. Clearing site data resets this copy; devices do not share data.
If persistence is unavailable, the status banner states that storage is session
only. Long training jobs run off the UI thread, with queued API requests.

The local FastAPI mode and its API documentation remain available unchanged.
The static Pages deployment has no socket `/api` or Swagger server. Its controls
use the in-browser transport. It does not execute Planner requests.

## Build and verify

From `nlp-lab`, after the normal Python setup and `setup-nltk`:

```powershell
npm ci --legacy-peer-deps
# On Windows select the existing project Python for the resource packager.
$env:NLP_PYTHON = (Resolve-Path .venv/Scripts/python.exe).Path
npm run build:runtime
npm run build:pages
npx playwright install chromium
npm run test:pages
```

On Linux/macOS the packager uses `python`, or set `NLP_PYTHON` to the desired
executable. `npm run build` continues to build the native FastAPI client.
`npm run build:pages` uses `/GDPProject/nlp/` for asset paths. Browser tests run
the production build at this actual nested path, exercising real Python,
features/annotations, ambiguity/negation, export, IndexedDB reload persistence,
review, retraining, explicit activation and rollback. They verify no `/api`
network calls are made. `NLP_DEPLOYED_URL` can point these checks at production.

## CI and publishing

The six existing required CI jobs run on both the source branch and the small
`codex/pages-nlp-packaging` workflow integration branch. Northwest NLP Lab adds
the native pipeline, interface and browser jobs. The browser job uploads
`nlp-pages` only after its full browser workflow passes, retained for 90 days.

The shared Pages workflow gates on all required checks for its workflow
revision, the exact main SHA, and the independent NLP SHA. It builds Planner
and TRACE from the verified main SHA and downloads the tested NLP artifact
from the successful run for that exact independent SHA into `dist/nlp`.
It then publishes one composite artifact. This packaging-only change on main
keeps the NLP code independent while preserving the nested URL on later main
deployments. No Planner application code or navigation is changed.

To update the lab, push its source branch, wait for all CI, and run the existing
Deploy to GitHub Pages workflow using `codex/nlp-pages` (or let a subsequent
main deployment include the successful artifact). No PR from the source branch
is required. A failed check, incomplete browser build or expired artifact blocks
publishing instead of silently dropping `/nlp`. Re-run the Northwest NLP Lab
workflow/build to refresh an expired artifact before redeploying. Both source
SHAs appear in the deployment's job summary.
