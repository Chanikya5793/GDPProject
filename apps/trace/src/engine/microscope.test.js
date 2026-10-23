import test from "node:test";
import assert from "node:assert/strict";
import { analyze, SCENARIOS } from "./pipeline.js";
import { microscope } from "./microscope.js";
import {
  CONTEXT,
  inspectBPE,
  encodeBPE,
  layerNorm,
  gelu,
} from "./transformer.js";

test("inspection preserves Unicode offsets and exposes the original characters", () => {
  const trace = analyze("Remind me 👋 to study tomorrow at 3 PM");
  const data = microscope(trace);
  data.characters.forEach((c) =>
    assert.equal(trace.original.slice(c.offset, c.offset + c.length), c.char),
  );
  assert.equal(data.characters.find((c) => c.char === "👋").length, 2);
});
test("per-dimension products reproduce the actual dot product and cosine score", () => {
  const trace = analyze(SCENARIOS[0].prompt),
    data = microscope(trace);
  data.contributions.forEach((c) => {
    assert.ok(
      Math.abs(c.terms.reduce((s, t) => s + t.product, 0) - c.dot) < 1e-10,
    );
    assert.ok(
      Math.abs(
        (c.dot / (trace.vectors.queryMagnitude * c.documentMagnitude) || 0) -
          c.score,
      ) < 1e-10,
    );
  });
});
test("BPE inspection records each applied merge and agrees with encoding", () => {
  const trace = inspectBPE("reminder call");
  assert.deepEqual(
    trace.words.flatMap((w) => w.pieces.filter((p) => p !== "</w>").map((p) => p.replace("</w>", "▁"))),
    encodeBPE("reminder call"),
  );
  trace.words.forEach((word) => {
    word.applied.forEach((step, i) =>
      assert.deepEqual(step.before, i ? word.applied[i - 1].after : word.start),
    );
    assert.ok(word.applied.every((s, i) => !i || s.rank > word.applied[i - 1].rank));
  });
});
test("attention inspection exposes each unmasked QK product before softmax", () => {
  const model = microscope(analyze(SCENARIOS[0].prompt)).transformer;
  model.query.forEach((q, i) =>
    model.key.forEach((k, j) => {
      assert.equal(
        model.scores[i][j],
        q.reduce((s, v, d) => s + v * k[d], 0) / 2,
      );
      assert.equal(model.masked[i][j], j > i ? -Infinity : model.scores[i][j]);
    }),
  );
});
test("residual normalization and GELU/feed-forward stages are real, finite calculations", () => {
  const data = microscope(analyze(SCENARIOS[0].prompt)).transformer;
  assert.deepEqual(layerNorm([3, 3, 3, 3]), [0, 0, 0, 0]);
  assert.equal(gelu(0), 0);
  data.norm1.forEach((row) =>
    assert.ok(Math.abs(row.reduce((a, b) => a + b, 0)) < 1e-10),
  );
  data.hidden.forEach((row) => assert.equal(row.length, 8));
  data.feedforward.forEach((row) => {
    assert.equal(row.length, 4);
    assert.ok(row.every(Number.isFinite));
  });
  data.norm2.forEach((row) =>
    assert.ok(Math.abs(row.reduce((a, b) => a + b, 0)) < 1e-10),
  );
});
test("vocabulary softmax is normalized and greedy decoding shifts the actual token window", () => {
  const trace = analyze(SCENARIOS[0].prompt),
    first = microscope(trace).transformer;
  assert.ok(
    Math.abs(first.probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-10,
  );
  assert.equal(
    first.nextToken,
    first.vocabulary[
      first.probabilities.indexOf(Math.max(...first.probabilities))
    ],
  );
  const second = microscope(trace, [first.nextToken]).transformer;
  assert.equal(second.tokens.length, CONTEXT);
  assert.deepEqual(second.tokens.slice(0, -1), first.tokens.slice(1));
  assert.equal(second.tokens.at(-1), first.nextToken);
  assert.ok(second.logits.every(Number.isFinite));
});
