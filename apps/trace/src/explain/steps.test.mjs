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
const { PLANNER_STEPS, TRANSFORMER_STEPS } = await load("/src/steps.js");
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

test.after(() => server.close());

const inBounds = (block, cells, label) =>
  (cells ?? []).forEach(([r, c]) =>
    assert.ok(r >= 0 && r < block.rows && c >= 0 && c < block.cols, `${label}: cell ${r},${c} outside ${block.id}`),
  );

for (const [mode, steps] of [["planner", PLANNER_STEPS], ["transformer", TRANSFORMER_STEPS]]) {
  test(`${mode} map: blocks, per-frame state and math are consistent`, () => {
    for (const { label, ctx } of contexts()) {
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

for (const step of [...PLANNER_STEPS, ...TRANSFORMER_STEPS]) {
  test(`step ${step.id} renders every frame`, (t) => {
    const module = STEP_MODULES[step.id];
    if (!module) return t.skip("no 2D module yet");
    assert.ok(module.code.length && module.source.length, "code and source are listed");
    for (const { label, ctx } of contexts()) {
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
