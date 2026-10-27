// The Tune schema: clamping, the code view's parser, diffs, and that every
// setting, lesson and step id refers to something real.
import test from "node:test";
import assert from "node:assert/strict";
import { loader } from "./load.mjs";

const { load, close } = await loader();
test.after(() => close());
const { SETTINGS, DEFAULTS, clean, resolve, resolveAll, changed, isTuned, diff, parseCode, toCode, settingFor, affectedSteps } =
  await load("/src/tune/schema.js");
const { PLANNER_STEPS, TRANSFORMER_STEPS, COPILOT_STEPS, stepsFor, copilotSteps } = await load("/src/steps.js");
const { LESSONS, lessonFor } = await load("/src/teach/lessons/index.js");
const { formatValue, formatChange } = await load("/src/tune/format.js");

const STEPS = { planner: PLANNER_STEPS, transformer: TRANSFORMER_STEPS, copilot: COPILOT_STEPS };
const ids = (track) => new Set(STEPS[track].map((s) => s.id));

test("every setting has a default of its type and a label and help", () => {
  for (const [track, list] of Object.entries(SETTINGS))
    for (const s of list) {
      const where = `${track}.${s.key}`;
      assert.ok(s.label && s.help, `${where}: label and help`);
      assert.ok(s.key in DEFAULTS[track], `${where}: no engine default`);
      assert.deepEqual(clean(s, s.default), s.default, `${where}: default is not clean`);
      if (s.type === "int" || s.type === "number") {
        assert.ok(s.min <= s.default && s.default <= s.max, `${where}: default outside min/max`);
        assert.ok(s.step > 0, `${where}: step`);
      }
      if (s.type === "bool") assert.equal(typeof s.default, "boolean", where);
      if (s.type === "select") assert.ok(s.options.some((o) => o.value === s.default), where);
      if (s.type === "words") assert.ok(Array.isArray(s.default), where);
      if (s.type === "pairs") assert.equal(typeof s.default, "object", where);
      assert.equal(settingFor(where), s);
    }
  assert.equal(settingFor("planner.nope"), null);
  assert.equal(settingFor("nope.key"), null);
});

test("every setting's steps exist in its track", () => {
  for (const [track, list] of Object.entries(SETTINGS))
    for (const s of list) {
      assert.ok(s.steps.length, `${track}.${s.key}: no steps`);
      for (const id of s.steps) assert.ok(ids(track).has(id), `${track}.${s.key}: unknown step ${id}`);
    }
});

test("clean clamps numbers, rounds ints and falls back to the default", () => {
  for (const list of Object.values(SETTINGS))
    for (const s of list) {
      if (s.type === "int" || s.type === "number") {
        assert.equal(clean(s, s.min - 1000), s.min);
        assert.equal(clean(s, s.max + 1000), s.max);
        assert.equal(clean(s, String(s.max)), s.max);
        for (const bad of [NaN, Infinity, -Infinity, "abc", undefined, {}, [1, 2]]) assert.equal(clean(s, bad), s.default, `${s.key} ${bad}`);
        if (s.type === "int") assert.ok(Number.isInteger(clean(s, s.min + 0.6)));
      }
      if (s.type === "bool") {
        assert.equal(clean(s, !s.default), !s.default);
        for (const bad of ["true", 1, null, undefined]) assert.equal(clean(s, bad), s.default);
      }
      if (s.type === "select") {
        for (const o of s.options) assert.equal(clean(s, o.value), o.value);
        assert.equal(clean(s, "nope"), s.default);
      }
      if (s.type === "words") {
        assert.deepEqual(clean(s, [" The ", "the", "", "  ", "B"]), ["the", "b"]);
        assert.deepEqual(clean(s, []), []);
        assert.equal(clean(s, "the"), s.default);
        // A copy of the default keeps the default's identity (engine fast path).
        assert.equal(clean(s, [...s.default]), s.default);
      }
      if (s.type === "pairs") {
        assert.deepEqual(clean(s, { " Foo ": " BAR ", empty: "", "": "x" }), { foo: "bar" });
        assert.deepEqual(clean(s, {}), {});
        for (const bad of [null, [], "a=b"]) assert.equal(clean(s, bad), s.default);
        assert.equal(clean(s, { ...s.default }), s.default);
      }
    }
});

test("resolve fills every key, ignores unknown keys and keeps defaults' identity", () => {
  for (const track of Object.keys(SETTINGS)) {
    const r = resolve(track, { bogus: 1 });
    assert.deepEqual(Object.keys(r).sort(), SETTINGS[track].map((s) => s.key).sort());
    for (const s of SETTINGS[track]) assert.equal(r[s.key], s.default, `${track}.${s.key}`);
    assert.deepEqual(resolve(track, null), resolve(track));
  }
  assert.deepEqual(Object.keys(resolveAll()).sort(), ["copilot", "planner", "transformer"]);
  assert.equal(isTuned(resolveAll()), false);
  assert.equal(isTuned(resolveAll({ copilot: { limit: 5 } })), false, "default value is not a change");
  assert.equal(isTuned(resolveAll({ copilot: { limit: 3 } })), true);
});

test("parseCode rejects bad JSON, non-objects and unknown keys", () => {
  for (const text of ["", "{", "{'a':1}", "nul"]) assert.match(parseCode(text).error ?? "", /Not valid JSON/, text);
  for (const text of ["[]", "null", "3", '"x"']) assert.equal(parseCode(text).error, "Expected an object.", text);
  assert.equal(parseCode('{"nope":{}}').error, "Unknown setting: nope");
  assert.equal(parseCode('{"copilot":{"limit":2,"lmit":3},"planner":{"x":1}}').error, "Unknown settings: copilot.lmit, planner.x");
  const ok = parseCode('{"copilot":{"limit":999,"stopwords":["A"]},"transformer":{"activation":"tanh"}}');
  assert.ok(ok.ok);
  assert.equal(ok.params.copilot.limit, 20);
  assert.deepEqual(ok.params.copilot.stopwords, ["a"]);
  assert.equal(ok.params.transformer.activation, "gelu");
  assert.ok(parseCode("{}").ok);
});

test("diff, changed and toCode round-trip through parseCode", () => {
  const tuned = resolveAll({
    planner: { useIdf: false, stopWords: [], aliases: { colour: "color" }, tieGap: 0.5 },
    copilot: { limit: 1, dimensions: 8, stopwords: ["foo"] },
    transformer: { activation: "relu", temperature: 3, merges: 0 },
  });
  const d = diff(tuned);
  assert.deepEqual(Object.keys(d.planner).sort(), ["aliases", "stopWords", "tieGap", "useIdf"]);
  assert.deepEqual(changed("copilot", tuned.copilot).sort(), ["dimensions", "limit", "stopwords"]);
  assert.deepEqual(parseCode(toCode(tuned, true)).params, tuned);
  assert.deepEqual(parseCode(toCode(tuned)).params, tuned);
  assert.deepEqual(diff(resolveAll()), {});
  assert.deepEqual(diff(parseCode(JSON.stringify(d)).params), d);
  assert.ok(affectedSteps("copilot", tuned.copilot).has("retrieval"));
  assert.equal(affectedSteps("planner", resolve("planner")).size, 0);
});

test("tuned steps are marked, and real copilot steps become what-ifs", () => {
  const p = resolveAll({ copilot: { limit: 1 } });
  const steps = copilotSteps({ response: { retrieval: { searches: [{ candidates: [] }] } } }, p);
  const r = steps.find((s) => s.id === "retrieval");
  assert.equal(r.badge, "tuned");
  assert.deepEqual(r.tuned, ["Sources kept"]);
  assert.equal(stepsFor("planner", p), PLANNER_STEPS, "an untuned track keeps its steps");
});

test("every step id has a lesson, in every mode", () => {
  for (const [mode, steps] of Object.entries(STEPS))
    for (const s of steps) {
      const l = lessonFor(s.id, mode);
      assert.ok(l, `${mode}/${s.id}: no lesson`);
      assert.ok(typeof l.what === "string" && l.what && typeof l.why === "string" && l.why, `${mode}/${s.id}: what/why`);
    }
  assert.equal(lessonFor("nope", "planner"), null);
  for (const id of Object.keys(LESSONS))
    assert.ok(Object.values(STEPS).some((list) => list.some((s) => s.id === id)), `lesson for unknown step ${id}`);
});

test("every lesson `try` names a real setting of a track the step runs in, with a valid, non-default value", () => {
  for (const [mode, steps] of Object.entries(STEPS))
    for (const s of steps) {
      const lesson = lessonFor(s.id, mode);
      for (const t of lesson.try ?? []) {
        const where = `${mode}/${s.id} try ${t.setting}`;
        const setting = settingFor(t.setting);
        assert.ok(setting, `${where}: unknown setting`);
        const track = t.setting.split(".")[0];
        // The copilot's model steps are the transformer illustration, run on its settings.
        assert.ok(track === mode || (mode === "copilot" && track === "transformer"), `${where}: setting of another track`);
        assert.deepEqual(clean(setting, t.value), t.value, `${where}: value ${JSON.stringify(t.value)} is not valid`);
        assert.notDeepEqual(t.value, setting.default, `${where}: value is the default`);
        assert.ok(typeof t.watch === "string" && t.watch.length > 10, `${where}: watch`);
        assert.doesNotMatch(formatChange(setting, t.value), /undefined|NaN|\[object/, where);
      }
    }
});

test("formatValue prints every setting's default and extremes", () => {
  for (const list of Object.values(SETTINGS))
    for (const s of list)
      for (const v of [s.default, s.min, s.max, [], {}].filter((v) => v !== undefined && clean(s, v) === v))
        assert.doesNotMatch(String(formatValue(s, v)), /undefined|NaN|\[object/, `${s.key} ${JSON.stringify(v)}`);
});

async function missingSources() {
  const { STEP_MODULES } = await load("/src/explain/steps/index.js");
  const { sourceOf } = await load("/src/explain/source.js");
  const missing = [];
  for (const m of Object.values(STEP_MODULES))
    for (const [file, name] of m.source ?? []) if (!sourceOf(file, name)) missing.push(`${m.id}: ${file}.${name}`);
  return missing;
}
// Reported, owned by the copilot step modules: promptSections was replaced in engine/copilot.js.
const KNOWN_MISSING = ["memory: copilot.promptSections"];

test("every step's “Real source” names a declaration that exists", async () => {
  assert.deepEqual((await missingSources()).filter((m) => !KNOWN_MISSING.includes(m)), []);
});

test("the memory step's source points at the current prompt code", async () => {
  assert.deepEqual(await missingSources(), []);
});
