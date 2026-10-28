# Northwest NLP Lab

A local companion to Northwest Planner: type an English command, inspect nine real NLP stages, correct the prediction, compare classical models, and export a validated Planner request. This application does not connect to or execute changes in Planner.

## Run locally

Use Python 3.12+ and Node.js 22.12+ (or Node 24+). Run from `nlp-lab/`:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -e ".[dev]"
.venv/Scripts/python.exe -m nlplab.cli setup-nltk
npm install
```

If npm 10 crashes with `Cannot read properties of null (reading 'edgesOut')`, use `npm install --legacy-peer-deps`. The lockfile pins the verified dependency graph.

For the exact verified Python dependency versions, install `-r requirements-lock.txt` before installing the editable project. The measured starter-corpus baseline is checked in at `docs/baseline-results.json`; compare both validation and test results, since the template families differ substantially in difficulty.

Start the Python service in one terminal:

```powershell
.venv/Scripts/python.exe -m nlplab.cli serve
```

Start the interface in another:

```powershell
npm run dev
```

Open **http://127.0.0.1:5174**. API documentation is at **http://127.0.0.1:8001/docs**. The initial pipeline uses rules while no model is active. On macOS/Linux use `.venv/bin/python` instead of `.venv/Scripts/python.exe`.

For a single-process local application, run `npm run build`, then start Python and open **http://127.0.0.1:8001**. FastAPI serves the built interface. Dependencies and NLTK resources require network access during setup; inference and training then operate locally.

If this Windows sandbox's temporary directory is unwritable, set `TEMP` and `TMP` to a writable project-local temporary directory before installation or testing. No environment variables from Northwest Planner are needed.

## Suggested walkthrough

1. Run `Create a task called Chemistry report tomorrow at 3pm with high priority`. Expand the context controls to freeze the reference clock when comparing results.
2. Inspect normalization, token/POS/lemma annotations, extraction evidence, date resolution, and the final request. Classification features appear after a candidate has been trained and selected.
3. Try `Delete my task chemistry`. In **Target resolution**, select a ranked sample record. Fuzzy similarity is a suggestion; it never silently chooses a record.
4. Try `Don't delete the task Pay rent` or a compound command. Export remains disabled while the request needs clarification.
5. Use **Correct prediction** to edit the action, item type, fields, filters, target, outcome, and optional original-text spans. Approve the correction.
6. Open **Experiments**, train a candidate, inspect validation/test results, and explicitly activate the completed version. Previous completed versions can be reactivated.
7. Add a literal phrase rule in **Configuration**, try the draft in the inspector, and rerun the same request. The previous command remains available for comparison. Save and activate a version separately.
8. Export JSON. The download contains the semantic command, Planner method/path/body, context, and version IDs. IDs and idempotency keys are allocated on first export; exporting the same run again returns the same payload.

## Pipeline and algorithms

1. Original input and an aware reference datetime / IANA timezone.
2. Explicit punctuation, whitespace and abbreviation normalization with original-offset mapping. A small whitelist corrects known command typos in analysis; arbitrary names and quoted data are preserved.
3. NLTK Treebank tokenization, averaged-perceptron POS tagging, WordNet lemmatization, and regex POS phrase chunking. Missing resource warnings identify unavailable annotations instead of fabricating them.
4. Training-only word TF-IDF (1–2 grams) and character-within-word TF-IDF (3–5 grams). Negation/stopwords are retained.
5. Independent action/item heads: logistic regression, Multinomial Naive Bayes, and group-calibrated Linear SVM. Rules-only, model-only, and hybrid modes use the same extraction/validation path. Hybrid prioritizes explicit command rules and surfaces confident disagreements.
6. Declarative phrase rules and regex extraction produce field-level evidence.
7. Date expressions resolve against the frozen reference using dateparser and explicit weekday rules. Bare weekdays mean the upcoming matching day, including today. `next Friday` means the next occurrence strictly after today. Numeric slash dates and bare hours ask for clarification.
8. Unique case-insensitive exact title matching for modifications, with ranked character-sequence similarity suggestions otherwise. Find applies local text/date/status/priority filters to the selected snapshot.
9. Strict Planner content validation gates payload readiness. Missing dates, missing titles/updates, unsupported combinations, negation and compound commands block export.

Titles and content should be quoted when they contain command words, temporal words, or punctuation. Use `Create a note called Title: body text` and `Update the note Title body to "replacement text"`. Use `Rename the task Old title to New title` for renaming. Recurrence, multi-action messages, conversational follow-ups, semantic paraphrase generation, and live execution are outside v1.

## Data, evaluation, and model lifecycle

The deterministic starter generator contains **800 synthetic examples**, covering 16 supported action/item combinations and safety/unsupported cases. These are template-generated bootstrap labels, **not human-reviewed real-user data**. Origin and review status are shown in the UI. Gold labels are authored independently of the runtime parser. The five sample titles are deliberately small; this corpus is useful for checking wiring and exposing failures, not establishing broad language understanding.

Splits are assigned by template family. Identical utterances cannot cross splits. Vectorizers fit on training data only; SVM calibration uses grouped folds within training. Reviewed corrections inherit an existing text/family's split, so reviewing a test example does not move it into training. New reviewed families go into training. Each experiment snapshots the corpus and configuration; subsequent corrections do not rewrite historical results.

Metrics include action/item macro-F1, exact field-value micro-F1, end-to-end exact semantic payload/outcome accuracy, ready-payload schema validity, clarification rate, ready coverage and accepted exact accuracy. Volatile record-creation IDs/idempotency keys and Planner defaults are excluded from semantic exact matching. The threshold chart reports **intent** accuracy among ready validation requests, not complete payload accuracy. A zero-denominator metric displays zero; see accepted counts before interpreting it.

Models stay candidates after training. Activation is explicit, blocked until evaluation completes, and independent of configuration activation. Failed or interrupted jobs cannot replace the active model. Artifacts are server-generated only: the API does not accept uploaded pickle/model files. The CLI can train without activating:

```powershell
.venv/Scripts/python.exe -m nlplab.cli train
.venv/Scripts/python.exe -m nlplab.cli export-corpus > corpus.json
```

SQLite, snapshots, reviews, immutable runs, exports and experiment metadata live in ignored `.lab-data/`. Artifacts live under `.lab-data/models/`; NLTK resources live under ignored `nltk_data/`. Set `NLPLAB_DATA_DIR` to override the database/artifact location. Keep a single service worker; this is a loopback-only, single-user development tool without remote authentication.

## Planner compatibility and API

`nlplab/planner_contract_v1.py` is a standalone snapshot of the existing Planner Pydantic record/content contracts. The contract test compares it against `../backend/app/models.py` and fails on drift. Runtime imports no Planner cloud services.

- Create: `PUT /v1/records/{type}/{new_id}`, expected revision `0`.
- Update/complete/reschedule: the same upsert route with the selected record's revision and unchanged fields preserved. Unspecified date/time fields remain unchanged.
- Delete: `DELETE /v1/records/{type}/{id}` with expected revision and idempotency key.
- Find: `GET /v1/records/{type}`, plus an explicit `local_filters` instruction. No unsupported search endpoint or query parameters are invented.

Snapshot import accepts a complete array of PlannerRecord objects, or paste a `{ "records": [...] }` wrapper in the UI. Download the sample format from Dataset. Revisions in an exported request refer to the imported snapshot and can be stale if a future consumer sends it; Planner's existing revision checks remain necessary. A future live consumer must also use Planner's authenticated proposal/confirmation workflow. The lab's direct HTTP previews are never executed here.

Primary routes:

| Route | Purpose |
|---|---|
| `POST /api/analyze` | Text + aware reference datetime + timezone + dataset/config/model selection → command, status, evidence, trace, optional request preview |
| `GET /api/runs`, `GET /api/runs/{id}` | Immutable historical results |
| `POST /api/runs/{id}/export` | Validate readiness and allocate a stable export |
| `GET /api/datasets`, `GET /api/datasets/{id}`, `POST /api/datasets/import` | Local planner snapshots |
| `GET /api/examples`, `POST /api/examples/review` | Search corpus and approve corrections |
| `GET/POST /api/configurations`, `POST /api/configurations/{id}/activate` | Validated declarative configuration versions |
| `POST /api/training`, `GET /api/training/{id}` | Background training and progress/failure details |
| `GET /api/models`, `POST /api/models/{id}/activate` | Candidate versions and explicit activation/rollback |
| `GET /api/experiments` | Stored experiment metrics |

An analyze request can supply either a saved `configuration_id` or an inline `configuration`. An inline draft takes precedence and receives a content-derived version. Explicit `model_id` selects a candidate for inspection without activation; otherwise the active model is used. `selected_record_id` records an explicit target selection within the requested entity type and dataset.

## Verification

```powershell
.venv/Scripts/python.exe -m pytest
npm test
npm run build
```

Tests cover the action/type matrix, Planner contract drift, unchanged-field preservation, source spans, ambiguous dates/targets, missing fields, quoted data, safety blockers, imports, stable exports, correction/configuration lifecycle, real training/evaluation, and failed-training isolation. UI tests cover disabled export, example selection, highlights and timezone handling.
