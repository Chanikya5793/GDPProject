import test from "node:test";
import assert from "node:assert/strict";
import {
  analyze,
  applyProposal,
  extract,
  normalize,
  SCENARIOS,
  SEED_RECORDS,
  tokenize,
  vectorize,
} from "./pipeline.js";
import { attention, encodeBPE, softmax, trainBPE } from "./transformer.js";

test("the duplicate class scenario pauses without modifying either reminder", () => {
  const before = JSON.stringify(SEED_RECORDS);
  const trace = analyze(SCENARIOS[0].prompt);
  assert.equal(trace.decision.reason, "duplicate");
  assert.equal(trace.decision.proposal, undefined);
  assert.equal(trace.vectors.results[0].score, trace.vectors.results[1].score);
  assert.equal(JSON.stringify(SEED_RECORDS), before);
});
test("choosing B changes only B and increments only its revision", () => {
  const trace = analyze(SCENARIOS[0].prompt, SEED_RECORDS, "B");
  const next = applyProposal(SEED_RECORDS, trace.decision.proposal);
  assert.deepEqual(
    next.find((r) => r.id === "A"),
    SEED_RECORDS[0],
  );
  assert.deepEqual(
    next.filter((r) => r.id !== "B"),
    SEED_RECORDS.filter((r) => r.id !== "B"),
  );
  assert.deepEqual(
    next.find((r) => r.id === "B"),
    { ...SEED_RECORDS[1], date: "2026-10-20", time: "11:00", revision: 2 },
  );
  assert.equal(SEED_RECORDS[1].revision, 1);
  assert.throws(
    () => applyProposal(next, trace.decision.proposal),
    /record changed/,
  );
});
test("an unrelated selected ID cannot bypass candidate matching", () => {
  assert.equal(
    analyze(SCENARIOS[0].prompt, SEED_RECORDS, "C").decision.reason,
    "selection",
  );
});
test("multiple targets, chained instructions and recurring updates ask for a narrower request", () => {
  for (const text of [
    "Move my call advisor reminder to October 20 or October 21 at 11 AM",
    "Remind me to study tomorrow at 3 PM then delete my advisor reminder",
    "Move my advisor reminder to every Friday at 4 PM for 4 weeks",
  ]) {
    assert.equal(analyze(text).decision.status, "clarify", text);
    assert.equal(analyze(text).decision.proposal, undefined);
  }
});
test("invalid clocks, missing meridiem and impossible calendar dates cannot produce proposals", () => {
  for (const clock of [
    "25:00",
    "24:00",
    "13 PM",
    "0 AM",
    "11:99",
    "25",
    "11",
  ]) {
    const trace = analyze(`Remind me to study tomorrow at ${clock}`);
    assert.equal(trace.decision.status, "clarify", clock);
    assert.equal(trace.decision.proposal, undefined);
  }
  assert.equal(
    analyze("Remind me to study on February 30 at 11 AM").decision.reason,
    "validation",
  );
});
test("civil calendar and clock handling is deterministic across timezones", () => {
  assert.equal(
    extract("Remind me to study tomorrow at 12 AM").date,
    "2026-10-20",
  );
  assert.equal(extract("Remind me to study tomorrow at 12 AM").time, "00:00");
  assert.equal(extract("Remind me to study tomorrow at 12 PM").time, "12:00");
  assert.equal(extract("Remind me to study today at 23:59").time, "23:59");
  assert.equal(
    extract("Remind me to study on February 29 2028 at 11 AM").date,
    "2028-02-29",
  );
});
test("unbounded or excessive recurrence cannot silently make a single reminder", () => {
  for (const input of [
    SCENARIOS[4].prompt,
    "Remind me to study every Friday at 4 PM for 13 weeks",
    "Remind me to study every day at 4 PM for 4 weeks",
  ]) {
    assert.equal(analyze(input).decision.status, "clarify", input);
  }
  const proposal = analyze(SCENARIOS[5].prompt).decision.proposal;
  assert.deepEqual(proposal.dates, [
    "2026-10-23",
    "2026-10-30",
    "2026-11-06",
    "2026-11-13",
  ]);
  const next = applyProposal(SEED_RECORDS, proposal);
  assert.equal(next.length, 10);
  assert.equal(new Set(next.map((r) => r.id)).size, 10);
  assert.deepEqual(next.slice(0, 6), SEED_RECORDS);
});
test("create, search, delete and unknown commands take distinct paths", () => {
  assert.equal(analyze(SCENARIOS[1].prompt).decision.proposal.intent, "create");
  const search = analyze(SCENARIOS[2].prompt);
  assert.equal(search.decision.status, "answer");
  assert.equal(search.vectors.results[0].record.id, "C");
  const deletion = analyze("Delete my GDP report reminder").decision.proposal;
  assert.equal(deletion.intent, "delete");
  assert.equal(applyProposal(SEED_RECORDS, deletion).length, 5);
  assert.equal(analyze("Tell me a story").decision.status, "clarify");
  assert.equal(analyze("").decision.reason, "empty");
  assert.equal(analyze("Remind me tomorrow at 3 PM").decision.reason, "title");
  assert.equal(analyze("Remind me to study").decision.reason, "missing-fields");
  assert.equal(
    extract("Remind me to update report tomorrow at 3 PM").intent,
    "create",
  );
});
test("tokens preserve original offsets across Unicode normalization", () => {
  const input = "  Ｍove café reminder at 11:00! 👋";
  const tokens = tokenize(input);
  for (const token of tokens)
    assert.equal(input.slice(token.start, token.end), token.text);
  assert.equal(normalize("  Ｍove   CAFÉ "), "move café");
  assert.equal(tokens.find((t) => t.text === "11:00").kind, "number");
});
test("cosine similarity is computed, keeps unknown terms, and never returns non-finite scores", () => {
  const records = [
    { id: "1", title: "alpha beta" },
    { id: "2", title: "alpha gamma" },
  ];
  const vector = vectorize(["alpha", "beta"], records);
  assert.ok(Math.abs(vector.results[0].score - 1) < 1e-12);
  assert.ok(vector.results[1].score > 0 && vector.results[1].score < 1);
  assert.ok(
    vectorize(["alpha", "unknown"], records).results[0].score <
      vectorize(["alpha"], records).results[0].score,
  );
  for (const query of [[], ["unrelated"]])
    assert.ok(vectorize(query, records).results.every((r) => r.score === 0));
  assert.deepEqual(vectorize(["word"], []).results, []);
  assert.equal(
    analyze("Find my zebras").vectors.results.every((r) => r.score === 0),
    true,
  );
});
test("an explicit adviser alias is consistent with the index", () => {
  const trace = analyze("Find my adviser reminder");
  assert.deepEqual(
    trace.vectors.results.slice(0, 2).map((r) => r.record.id),
    ["A", "B"],
  );
});
test("BPE learns recurring character pairs and is deterministic", () => {
  const merges = trainBPE("low lower lowest", 8);
  assert.ok(merges.some((m) => m.merged === "lo"));
  assert.deepEqual(encodeBPE("Reminder!"), encodeBPE("Reminder!"));
  assert.equal(
    encodeBPE("reminder!").join("").replaceAll("▁", ""),
    "reminder!",
  );
});
test("causal attention is stable, normalized, masked and actually multiplies V", () => {
  const model = attention("Remind me to call advisor");
  assert.deepEqual(model.tokens, ["remind▁", "me▁", "to▁", "call▁", "advisor▁"]);
  model.weights.forEach((row, i) => {
    assert.ok(Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-12);
    assert.ok(row.slice(i + 1).every((v) => v === 0));
    assert.ok(row.every(Number.isFinite));
    model.output[i].forEach((v, d) =>
      assert.equal(
        v,
        row.reduce((sum, w, j) => sum + w * model.value[j][d], 0),
      ),
    );
  });
  assert.deepEqual(softmax([10000, 10000]), [0.5, 0.5]);
  assert.deepEqual(attention("").weights, []);
});
