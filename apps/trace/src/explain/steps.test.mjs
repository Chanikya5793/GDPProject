// Renders every frame of every 2D step for every example request, plus an
// applied change and a decoded sequence, and checks the frame contract.
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createServer } from "vite";

const server = await createServer({
  configFile: new URL("../../vite.config.js", import.meta.url).pathname,
  root: new URL("../..", import.meta.url).pathname,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});
const load = (path) => server.ssrLoadModule(path);
const { STEP_MODULES } = await load("/src/explain/steps/index.js");
const { PLANNER_STEPS, TRANSFORMER_STEPS, COPILOT_STEPS } = await load("/src/steps.js");
const { sampleCopilot, SAMPLE_RECORDS } = await load("/src/engine/copilotSample.js");
const { analyze, applyProposal, SCENARIOS, SEED_RECORDS } = await load("/src/engine/pipeline.js");
const { microscope } = await load("/src/engine/microscope.js");
const { buildTrack } = await load("/src/map/track.js");

function contexts() {
  const out = [];
  const make = (label, trace, records = SEED_RECORDS, applied = false, generated = []) => {
    const data = microscope(trace, generated);
    out.push({ label, ctx: { trace, data, model: data.transformer, records, applied, generatedTokens: generated } });
  };
  for (const s of SCENARIOS) make(s.id, analyze(s.prompt));
  for (const text of ["", "Delete my GDP report reminder", "Find my zebras", "  Ｍove café reminder at 11:00! 👋", "Remind me to study"])
    make(JSON.stringify(text), analyze(text));
  const chosen = analyze(SCENARIOS[0].prompt, SEED_RECORDS, "B");
  make("chosen B", chosen);
  make("applied B", chosen, applyProposal(SEED_RECORDS, chosen.decision.proposal), true);
  const first = microscope(analyze(SCENARIOS[1].prompt)).transformer.nextToken;
  make("decoded", analyze(SCENARIOS[1].prompt), SEED_RECORDS, false, [first, first]);
  return out;
}

// The copilot track: a full exchange, and the edges a real chat can produce.
function copilotContexts() {
  const base = sampleCopilot();
  const variants = [
    ["sample", base],
    ["stopwords only", { ...base, message: "please show me what i have to do", response: null }],
    ["no response yet", { ...base, response: null }],
    ["no records", { ...base, records: [] }],
    ["unicode", { ...base, message: "Straße café ﬁnal résumé 👋 C++" }],
    [
      "focus and history",
      {
        ...base,
        focus: SAMPLE_RECORDS[0],
        history: [
          { role: "user", text: "What is due this week?" },
          { role: "assistant", text: "Your GDP report is due Thursday." },
        ],
        response: { ...base.response, steps: [], proposals: [], unavailable: ["No matching task was found to update."] },
      },
    ],
  ];
  variants.push([
    "server funnel edges",
    {
      ...base,
      response: {
        ...base.response,
        retrieval: {
          ...base.response.retrieval,
          searches: [
            {
              query: base.message,
              requested: 25,
              limit: 5,
              max_distance: 0.98,
              candidates: [
                { rank: 1, distance: 0.611692, outcome: "kept", entity_type: "task", record_id: "t1", citation_id: "S1" },
                { rank: 2, distance: 0.7, outcome: "not_approved", entity_type: "note", record_id: null },
                { rank: 3, distance: 0.8, outcome: "kept", entity_type: "task", record_id: "server-only", citation_id: "S2" },
                { rank: 4, distance: 0.99, outcome: "too_far", entity_type: "reminder", record_id: "r1" },
              ],
            },
            {
              query: "GDP",
              entity_type: "task",
              requested: 25,
              limit: 5,
              max_distance: 0.98,
              candidates: [{ rank: 1, distance: 0.5, outcome: "stale_revision", entity_type: "task", record_id: "t1" }],
            },
          ],
        },
      },
    },
  ]);
  return variants.map(([label, copilot]) => {
    const trace = analyze(copilot.message);
    const data = microscope(trace);
    return { label, ctx: { trace, data, model: data.transformer, records: SEED_RECORDS, applied: false, generatedTokens: [], copilot } };
  });
}

test.after(() => server.close());

const inBounds = (block, cells, label) =>
  (cells ?? []).forEach(([r, c]) =>
    assert.ok(r >= 0 && r < block.rows && c >= 0 && c < block.cols, `${label}: cell ${r},${c} outside ${block.id}`),
  );

for (const [mode, steps, make] of [
  ["planner", PLANNER_STEPS, contexts],
  ["transformer", TRANSFORMER_STEPS, contexts],
  ["copilot", COPILOT_STEPS, copilotContexts],
]) {
  test(`${mode} map: blocks, per-frame state and math are consistent`, () => {
    for (const { label, ctx } of make()) {
      const track = buildTrack(steps, STEP_MODULES, ctx);
      const ids = track.blocks.map((b) => b.id);
      assert.equal(new Set(ids).size, ids.length, `${label}: duplicate block ids ${ids}`);
      for (const b of track.blocks)
        for (let r = 0; r < b.rows; r++)
          for (let c = 0; c < b.cols; c++) {
            const cell = b.cell(r, c);
            if (cell) assert.equal(typeof String(cell.text ?? ""), "string");
          }
      for (const col of track.columns) {
        const m = col.module;
        if (!m?.blocks) continue;
        assert.ok(col.blocks.length > 0, `${label}/${col.step.id}: no blocks`);
        assert.ok(m.state && m.math, `${label}/${col.step.id}: state and math are required`);
        for (let fi = 0; fi < col.count; fi++) {
          const frame = track.frames[col.start + fi].frame;
          const where = `${label}/${col.step.id} frame ${fi}`;
          const state = m.state(frame, ctx);
          for (const [id, s] of Object.entries(state)) {
            const block = track.byId.get(id);
            if (!block) {
              // Blocks of other steps may be absent for short inputs.
              assert.ok(!col.blocks.some((b) => b.id === id), `${where}: unknown block ${id}`);
              continue;
            }
            inBounds(block, s.active, where);
            inBounds(block, s.source, where);
          }
          const lines = m.math(frame, ctx);
          assert.ok(Array.isArray(lines), `${where}: math must return an array`);
          lines.forEach((l) => assert.ok(Array.isArray(l.terms) && typeof l.label === "string", `${where}: math line`));
          if (fi === col.count - 1)
            for (const b of col.blocks) {
              const done = state[b.id]?.done;
              if (!done) continue;
              for (let r = 0; r < b.rows; r++)
                for (let c = 0; c < b.cols; c++)
                  assert.ok(done(r, c), `${where}: ${b.id} ${r},${c} not done on the last frame`);
            }
        }
      }
    }
  });
}

const copilotOnly = new Set(COPILOT_STEPS.map((s) => s.id).filter((id) => !TRANSFORMER_STEPS.some((t) => t.id === id)));
for (const step of [...PLANNER_STEPS, ...TRANSFORMER_STEPS, ...COPILOT_STEPS.filter((s) => copilotOnly.has(s.id))]) {
  test(`step ${step.id} renders every frame`, (t) => {
    const module = STEP_MODULES[step.id];
    if (!module) return t.skip("no 2D module yet");
    assert.ok(module.code.length && module.source.length, "code and source are listed");
    const all = copilotOnly.has(step.id) ? copilotContexts() : [...contexts(), ...(TRANSFORMER_STEPS.some((s) => s.id === step.id) ? copilotContexts() : [])];
    for (const { label, ctx } of all) {
      const frames = module.frames(ctx);
      assert.ok(frames.length > 0, `${label}: no frames`);
      assert.ok(frames.length <= 400, `${label}: ${frames.length} frames`);
      frames.forEach((frame, at) => {
        assert.equal(typeof frame.say, "string", `${label} frame ${at}: say`);
        assert.ok(frame.say.length > 0, `${label} frame ${at}: empty say`);
        [].concat(frame.line ?? []).forEach((l) =>
          assert.ok(l >= 0 && l < module.code.length, `${label} frame ${at}: line ${l}`),
        );
        try {
          renderToString(createElement(module.Stage, { ctx, frame, frames, at, seek: () => {} }));
        } catch (error) {
          throw new Error(`${label} frame ${at}: ${error.message}`);
        }
      });
    }
  });
}
