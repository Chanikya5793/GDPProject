# TRACE

A teaching site that runs two small NLP programs in the browser and shows every intermediate
value:

- **Planner pipeline**: a reminder request such as “Move my call advisor reminder to October 20
  at 11 AM.” goes through normalization, tokenization, rule-based slot extraction, title terms,
  TF–IDF, cosine similarity, an ordered decision rule list and a revision-checked write.
- **Transformer block**: the same text is tokenized with byte-pair encoding and run through one
  attention head, add & norm, a GELU feed-forward layer, a vocabulary head and greedy decoding.
  The weights are fixed formulas, not trained, so the arithmetic is real and the predicted
  tokens are meaningless.

- **Copilot**: how the Northwest Planner copilot turns a chat message into a reply. Each step is
  badged **real** (values from the actual exchange), **recomputed** (the server's exact search
  algorithm, rerun in the browser; parity with the Python is tested against a fixture generated
  from `backend/app/local_embeddings.py`), or **illustration** (the transformer steps, which show
  how language models work in general on the user's words, not what the hosted model did).

Nothing calls a model or a network service.

## Inside the planner

The planner shows a **Trace** button under every copilot reply, and "See how the copilot works"
in the demo build. It calls `mountTrace` from `@gdp/trace/embed`, which opens TRACE full-screen
in its own shadow root so neither app's CSS reaches the other. The trace code and three.js are
loaded only on the first click. Inputs come from what the page already holds: the message, the
turns before it, the reply's citations, lookups and proposals, and the user's records read from
the encrypted local cache. Nothing is sent anywhere, and the message never goes into a URL.

Replies from a backend with this change carry `retrieval.searches`: every search the turn ran,
each candidate's rank, cosine distance and filter outcome, and the citation id it was shown to
the model as. The Retrieval step then switches its badge to **real** and walks the server's own
funnel next to the browser's recomputed distances. Candidates dropped as not approved, of a type
you do not index, or deleted are reported without their record id.

Search in the copilot is feature hashing, not TF–IDF: `slot = sha256(word)[0:4] mod 768`,
`weight = 1 + ln(count)`, cosine distance, cutoff 0.98, top 5 after the approval and shared-word
filters. Regenerate the parity fixture after changing the backend tokenizer:

```sh
backend/.venv312/bin/python apps/trace/scripts/lexical_fixture.py
```

## The standalone site

The full site is published with the planner on GitHub Pages at
<https://chanikya5793.github.io/GDPProject/trace/> (`TRACE_SITE_URL` in `src/site.js`, linked from
the embed). The Pages workflow builds the planner into `dist/` and then TRACE into `dist/trace/`
with the base `/GDPProject/trace/`, so both ship in one artifact.

```sh
# from the repository root
npm ci
npm run dev:trace     # http://127.0.0.1:4317
npm run test:trace    # every test below, about 30 s
npm run build:trace   # static site in apps/trace/dist (relative base)
npm run build:pages   # what Pages serves: planner in dist/, TRACE in dist/trace/
```

## Tune

**Tune** opens every setting of the current track: stop words, aliases, IDF on or off, the
match threshold and tie gap for the planner; stopwords, query length, vector slots, damping,
title boost, candidates, distance cutoff, the shared-word rule and the source limit for the
copilot; merges, context, positional encoding, √d scaling, the causal mask, residuals, the
activation and temperature for the transformer. The settings live in `src/tune/schema.js`; the
panel's form and its JSON code view edit the same object, and values are clamped before they run.

Each change reruns the request. Steps a setting can reach are marked **tuned**, a real or
recomputed copilot step becomes a **what-if** (the server always runs on the defaults), and the
Flow cards and guide show **default vs yours** for every step whose result changed. Only the
changed values are kept, in this browser's local storage, so a reload keeps them; **Reset**
returns a track to the defaults.

## Lessons and hover cards

The guide's lesson for each step (`src/teach/lessons`) says what the step does, why the system
needs it, the step worked on this run's real values, and **Try it** buttons that apply one
setting and say what to watch for. Glossary words (`src/teach/glossary.js`) are linked wherever
they appear. On the 2D and 3D maps, hovering a cell shows what the value means, its formula and
the arithmetic with this run's numbers.

## Tests

`npm run test:trace` runs, with `node --test` and Vite's SSR loader for the JSX modules:

- `src/engine/*.test.js`: engine invariants, and the copilot search's parity with the backend
  fixture;
- `src/explain/steps.test.mjs`: every frame of every step rendered for many inputs;
- `tests/schema.test.mjs`: clamping, the code view's parser, diffs, that every setting's steps
  exist, every step has a lesson and every lesson's Try it names a valid setting value;
- `tests/tuning.test.mjs`: the default-run baseline, default-vs-yours, the copilot search under
  each setting, and parity on the resolved defaults;
- `tests/matrix.test.mjs`: every step of every track under defaults, each switch flipped, each
  number at its min and max, empty lists and both extremes at once, for scenario, empty, long,
  unicode and emoji requests and chat edges. Frames, map state and math, the Tables view, every
  hover card, the Flow summary, the lesson example and the comparison must run and never print
  NaN, undefined or [object Object].

`npm run test:quick --workspace @gdp/trace` skips the matrix. CI runs `test:trace` and the Pages
build on every push.

## Three views

- **Flow** (the default) shows the whole system at stage level: each algorithm as a card, what
  it does in plain words, and what went in and came out for your sentence. Play moves stage by
  stage; **See every calculation** opens that stage on the map.
- **2D** and **3D** show the map described below, one frame at a time.

The guide on the left has a **Simple / Detailed** switch. **Simple** explains each step in plain
language next to the map. **Detailed** adds a third panel on the right with the engine's real
source code: the line that is running is highlighted and scrolled into view, the current values
are shown inline on that line, and a watch list underneath marks the values that just changed.
The guide also shows the formula and the arithmetic of the current frame.

When the planner asks a question (a missing title, date or time), answer it in the guide. The
answer is added to your request and the pipeline runs again, so you never have to retype it.

## Reading the map

Each track is one map of the real data: characters, tokens, vectors and matrices, laid out
step by step from left to right. Press **Play** and the computation runs on it frame by frame:

- cells being **read** are outlined in blue, the cell being **written** in amber, and a flow line
  runs from one to the other;
- cells not computed yet are dashed placeholders; values fade in as they are produced;
- the guide on the left names the step, explains it in plain words, gives the formula, says
  what the current frame does and shows its arithmetic with the real numbers;
- **Algorithm** highlights the line being executed, **Variables** lists the values in scope,
  **Tables** opens the same step as tables with a link to the engine's real source;
- click any value on the map to jump to the frame that computed it; hover for its full value.

**2D** draws the map flat, every value printed in its cell (drag to pan, scroll or pinch to
zoom). **3D** turns every number into a bar: height is the size of the value, teal positive, coral
negative, violet for probabilities. Bars grow out of the floor as they are computed, the bar being
written turns amber, the bars being read turn blue, and arcs carry the data between them; text
blocks stay flat plates. Drag to orbit, right-drag to pan, hover a bar for its exact value. The
camera follows the current frame until you move it; **Follow** (<kbd>C</kbd>) brings it back and
**Overview** (<kbd>O</kbd>) shows the whole track.

Keys: <kbd>Space</kbd> play/pause, <kbd>←</kbd>/<kbd>→</kbd> one frame,
<kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd> one step. Playback continues through the steps and
stops after Decide when the request needs an answer.

## What the planner understands

Commands start with `remind me`, `create`, `add`, `set`, `find`, `show`, `search`, `get`, `list`,
`move`, `reschedule`, `change`, `update`, `delete`, `remove` or `cancel`, optionally after
`please`. Dates: `today`, `tomorrow`, a weekday (the next one strictly after today), or a month
and day with an optional year. Times: `3 PM`, `11:30 am` or 24-hour `15:00`. Weekly reminders
need a weekday and `for 1–12 weeks`. “Today” is fixed to Monday, October 19, 2026 so runs are
reproducible.

Ties between candidate records, invalid dates or times, missing fields, unbounded recurrence,
more than one date or time, and chained commands all stop at Decide with a question. A
confirmed change is written only if the record still has the revision that was previewed.

## Source map

```text
src/engine/pipeline.js       normalization, tokenizer, extraction, TF–IDF, cosine, decision rules, apply
src/engine/transformer.js    BPE training/encoding, weights, attention, layer norm, GELU, vocabulary head
src/engine/microscope.js     per-character and per-product inspection data
src/engine/classroom.js      the eight self-checks offered in the Data panel
src/engine/copilot.js        browser port of the copilot's lexical search and prompt sections
src/engine/copilotSample.js  a sample copilot exchange for the demo and tests
src/embed.jsx                mountTrace(): the overlay the planner opens
src/steps.js                 step names, summaries and formulas
src/explain/steps/           one module per step: frames, narration, pseudocode, map blocks and state
src/map/                     block layout and painting, the 2D canvas map, the 3D map, camera
src/TrackView.jsx            guide panel, dock and playback
src/engine/*.test.js         engine invariants and trace consistency
src/explain/steps.test.mjs   renders every frame and checks every map state for many inputs
src/tune/                    settings schema, Tune panel, default-run baseline, default-vs-yours
src/teach/                   lessons, glossary
tests/                       schema, tuning and settings-matrix tests
```

## References

- Sennrich, Haddow and Birch, [Neural Machine Translation of Rare Words with Subword Units](https://arxiv.org/abs/1508.07909) (BPE)
- Manning, Raghavan and Schütze, [tf–idf weighting](https://nlp.stanford.edu/IR-book/html/htmledition/tf-idf-weighting-1.html) and [the vector space model](https://nlp.stanford.edu/IR-book/html/htmledition/dot-products-1.html)
- Vaswani et al., [Attention Is All You Need](https://arxiv.org/abs/1706.03762)
- Ba, Kiros and Hinton, [Layer Normalization](https://arxiv.org/abs/1607.06450)
- Hendrycks and Gimpel, [Gaussian Error Linear Units](https://arxiv.org/abs/1606.08415)
