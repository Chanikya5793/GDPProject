// Tuned settings reach the engines: the default-run baseline, and the copilot
// search recomputed with other settings still matching the server on defaults.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loader } from "./load.mjs";

const { load, close } = await loader();
test.after(() => close());
const { resolveAll, resolve } = await load("/src/tune/schema.js");
const { buildCtx } = await load("/src/tune/context.js");
const { compareSteps } = await load("/src/tune/compare.js");
const { stepsFor, COPILOT_STEPS } = await load("/src/steps.js");
const { analyze, SCENARIOS, SEED_RECORDS, PLANNER_DEFAULTS } = await load("/src/engine/pipeline.js");
const { retrieve, vectorize, tokens, COPILOT_DEFAULTS } = await load("/src/engine/copilot.js");
const { sampleCopilot, SAMPLE_MESSAGE, SAMPLE_RECORDS } = await load("/src/engine/copilotSample.js");

const fixture = JSON.parse(readFileSync(new URL("../src/engine/fixtures/lexical.json", import.meta.url)));
const text = SCENARIOS[0].prompt;
const ctxFor = (params, extra = {}) =>
  buildCtx({ trace: analyze(text, SEED_RECORDS, null, params.planner), rerun: (p) => analyze(text, SEED_RECORDS, null, p), params, ...extra });

test("untuned settings have no baseline", () => {
  assert.equal(ctxFor(resolveAll()).baseline, null);
  // Equal to the defaults, even as copies, is still untuned.
  assert.equal(ctxFor(resolveAll({ planner: { stopWords: [...PLANNER_DEFAULTS.stopWords] }, copilot: { limit: 5 } })).baseline, null);
});

test("tuned settings carry a baseline run on the defaults", () => {
  const defaults = resolveAll();
  for (const partial of [{ planner: { useIdf: false } }, { copilot: { limit: 1 } }, { transformer: { temperature: 3 } }]) {
    const ctx = ctxFor(resolveAll(partial));
    const where = JSON.stringify(partial);
    assert.ok(ctx.baseline, `${where}: no baseline`);
    assert.deepEqual(ctx.baseline.params, defaults, `${where}: baseline params`);
    assert.equal(ctx.baseline.baseline, undefined, `${where}: nested baseline`);
    assert.equal(ctx.baseline.copilot.message, ctx.copilot.message);
  }
});

test("a tuned planner reruns the request on the defaults for the baseline", () => {
  const params = resolveAll({ planner: { useIdf: false, matchThreshold: 0.9 } });
  const ctx = ctxFor(params);
  assert.notDeepEqual(ctx.trace.vectors.results.map((r) => r.score), ctx.baseline.trace.vectors.results.map((r) => r.score));
  assert.deepEqual(ctx.baseline.trace.vectors.results.map((r) => r.score), analyze(text).vectors.results.map((r) => r.score));
  // Without rerun the baseline reuses the trace it was given.
  const noRerun = buildCtx({ trace: ctx.trace, params });
  assert.equal(noRerun.baseline.trace, ctx.trace);
  // Only the transformer tuned: the planner trace is shared, the model is not.
  const t = ctxFor(resolveAll({ transformer: { temperature: 3 } }));
  assert.equal(t.baseline.trace, t.trace);
  assert.notDeepEqual(t.model.ranked[0].probability, t.baseline.model.ranked[0].probability);
});

test("compare finds the steps a setting changes, and none untuned", () => {
  const untuned = ctxFor(resolveAll());
  assert.equal(compareSteps(stepsFor("planner"), untuned).size, 0);
  const params = resolveAll({ copilot: { limit: 1 } });
  const ctx = buildCtx({ trace: analyze(SAMPLE_MESSAGE), params, copilot: sampleCopilot() });
  const diff = compareSteps(COPILOT_STEPS, ctx);
  assert.ok(diff.has("retrieval"), "retrieval differs");
  assert.ok(!diff.has("message") && !diff.has("searchwords"), "upstream steps are unchanged");
  const p = resolveAll({ planner: { matchThreshold: 0.9 } });
  const search = SCENARIOS.find((s) => s.id === "search").prompt;
  const run = (q) => buildCtx({ trace: analyze(search, SEED_RECORDS, null, q.planner), rerun: (x) => analyze(search, SEED_RECORDS, null, x), params: q });
  assert.ok(compareSteps(stepsFor("planner", p), run(p)).has("decide"), "threshold 0.9 changes the search answer");
});

// Cosine of identical vectors comes out as 1.0000000000000002, so the largest
// threshold the Tune panel allows (1) still lets an exact match through.
test("match threshold 1 excludes every record", () => {
  const t = analyze(text, SEED_RECORDS, null, resolve("planner", { matchThreshold: 1 }));
  assert.ok(t.vectors.results.every((r) => r.score <= 1), JSON.stringify(t.vectors.results.map((r) => r.score)));
  assert.ok(t.rules.find((r) => r.test.includes("no record scores above")).hit);
});

test("copilot retrieval reacts to each tuned setting", () => {
  const base = retrieve(SAMPLE_MESSAGE, SAMPLE_RECORDS);
  const run = (partial) => retrieve(SAMPLE_MESSAGE, SAMPLE_RECORDS, resolve("copilot", partial));
  assert.ok(base.kept.length > 1, "the sample keeps several sources");
  assert.equal(run({ limit: 1 }).kept.length, 1);
  assert.deepEqual(run({ limit: 1 }).kept[0].record.id, base.kept[0].record.id);
  assert.equal(run({ maxDistance: 0 }).kept.length, 0);
  assert.ok(run({ candidates: 1 }).candidates.length === 1);
  assert.ok(run({ maxDistance: 1, requireShared: false }).kept.length >= base.kept.length);
  assert.ok(run({ stopwords: [] }).q.rows.length > base.q.rows.length, "no stopwords: more search words");
  assert.ok(run({ queryChars: 20 }).query.length <= 20);
  const small = vectorize(SAMPLE_MESSAGE, "", resolve("copilot", { dimensions: 8 }));
  assert.ok(small.rows.every((r) => r.slot < 8));
  const flat = vectorize("gdp gdp gdp", "", resolve("copilot", { logWeight: false }));
  assert.equal(flat.rows[0].weight, 3);
  assert.equal(vectorize("gdp gdp gdp").rows[0].weight, 1 + Math.log(3));
  assert.notDeepEqual(
    run({ titleBoost: 0 }).scored.map((s) => s.distance),
    base.scored.map((s) => s.distance),
  );
});

test("resolved defaults still match the backend fixture exactly", () => {
  const p = resolve("copilot");
  assert.deepEqual(p, COPILOT_DEFAULTS);
  for (const t of fixture.texts) {
    assert.deepEqual(tokens(t.text, p), t.tokens, t.text);
    const v = Object.fromEntries([...vectorize(t.text, "", p).vector].map(([k, w]) => [String(k), w]));
    assert.deepEqual(Object.keys(v).sort(), Object.keys(t.query).sort(), t.text);
    for (const k of Object.keys(v)) assert.ok(Math.abs(v[k] - t.query[k]) < 1e-9, `${t.text} slot ${k}`);
  }
  for (const r of fixture.records) {
    const v = Object.fromEntries([...vectorize(r.text, r.title, p).vector].map(([k, w]) => [String(k), w]));
    for (const k of Object.keys(r.document)) assert.ok(Math.abs(v[k] - r.document[k]) < 1e-9, `${r.type} slot ${k}`);
  }
});
