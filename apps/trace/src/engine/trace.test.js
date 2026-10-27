import test from "node:test";
import assert from "node:assert/strict";
import { analyze, extract, SCENARIOS, SEED_RECORDS, termSteps, tokenize, TOKEN_PATTERNS } from "./pipeline.js";
import {
  attention,
  CONTEXT,
  inspectBPE,
  positionRow,
  trainBPEDetailed,
  W_K,
  W_Q,
} from "./transformer.js";

const inputs = [
  ...SCENARIOS.map((s) => s.prompt),
  "",
  "Tell me a story",
  "Delete my GDP report reminder",
  "Remind me to study",
  "Please move my adviser reminder to friday at 9:30 am",
];

test("the decision is made by the first rule that fires, and only rules up to it are checked", () => {
  for (const text of inputs) {
    const trace = analyze(text);
    const hits = trace.rules.filter((r) => r.hit);
    assert.equal(hits.length, 1, text);
    assert.equal(trace.rules.at(-1).hit, true, text);
    const reason = trace.rules.at(-1).id;
    assert.equal(trace.decision.reason, reason === "search" ? "search" : reason, text);
  }
  const tie = analyze(SCENARIOS[0].prompt);
  assert.equal(tie.gap, 0);
  assert.deepEqual(tie.candidates, ["A", "B"]);
});

test("the title trace is a chain from the normalized input to the final title", () => {
  for (const text of inputs) {
    const { steps, title } = extract(text);
    let current = steps.input;
    for (const step of steps.title) {
      assert.equal(step.before, current, text);
      assert.notEqual(step.after, step.before, text);
      current = step.after;
    }
    assert.equal(current, title, text);
  }
});

test("date and clock traces explain the values that were extracted", () => {
  const e = extract("Please move my adviser reminder to friday at 9:30 am");
  assert.equal(e.steps.intent.verb, "move");
  assert.equal(e.steps.date[0].rule, "weekday");
  assert.equal(e.steps.date[0].result, e.date);
  assert.equal(e.steps.clock.result, "09:30");
  assert.equal(extract("Remind me to study tomorrow at 3 PM").steps.clock.calc, "(3 mod 12) + 12 = 15");
});

test("every token names the regex alternative that matched it", () => {
  const names = TOKEN_PATTERNS.map((p) => p.name);
  for (const t of tokenize("At 11:00 call 3 advisors, then rest."))
    assert.ok(names.includes(t.rule));
  assert.equal(tokenize("11:00")[0].rule, "clock");
});

test("term steps keep exactly the extracted keywords", () => {
  for (const text of inputs) {
    const e = extract(text);
    assert.deepEqual(
      termSteps(e.title).filter((s) => s.kept).map((s) => s.term),
      e.keywords,
    );
  }
});

test("W_Q and W_K reproduce the projection formulas", () => {
  const m = attention(SCENARIOS[0].prompt);
  m.positions.forEach((x, i) =>
    [0, 1, 2, 3].forEach((j) => {
      assert.ok(Math.abs(m.query[i][j] - (x[j] * 0.7 + x[(j + 1) % 4] * 0.3)) < 1e-12);
      assert.ok(Math.abs(m.key[i][j] - (x[j] * 0.6 - x[(j + 2) % 4] * 0.2)) < 1e-12);
    }),
  );
  assert.equal(W_Q.length, 4);
  assert.equal(W_K[0].length, 4);
});

test("positional encoding follows sin/cos pairs with frequency 1 / 10000^(2k/d)", () => {
  assert.deepEqual(positionRow(0), [0, 1, 0, 1]);
  const p = positionRow(5);
  assert.ok(Math.abs(p[0] - Math.sin(5)) < 1e-12);
  assert.ok(Math.abs(p[1] - Math.cos(5)) < 1e-12);
  assert.ok(Math.abs(p[2] - Math.sin(5 / 100)) < 1e-12);
  assert.ok(Math.abs(p[3] - Math.cos(5 / 100)) < 1e-12);
});

test("BPE training rounds pick the most frequent pair and replay into the encoder", () => {
  const { rounds } = trainBPEDetailed();
  rounds.forEach((r) => {
    assert.ok(r.top.every((t) => t.count <= r.count));
    assert.ok(r.count >= 2);
  });
  const words = inspectBPE(SCENARIOS[0].prompt).words;
  assert.ok(words.find((w) => w.word === "advisor").pieces.join("") === "advisor</w>");
  assert.ok(attention(SCENARIOS[0].prompt).tokens.length <= CONTEXT);
});

test("layer norm and softmax intermediates match the outputs", () => {
  const m = attention(SCENARIOS[0].prompt);
  m.softmaxRows.forEach((s, i) => {
    assert.deepEqual(s.probs, m.weights[i]);
    assert.ok(Math.abs(s.exps.reduce((a, b) => a + b, 0) - s.sum) < 1e-12);
  });
  m.norm1Steps.forEach((s, i) => {
    assert.deepEqual(s.out, m.norm1[i]);
    assert.ok(Math.abs(s.mean) < 10);
  });
  assert.equal(SEED_RECORDS.length, 6);
});
