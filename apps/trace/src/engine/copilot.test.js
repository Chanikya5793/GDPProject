import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CANDIDATES,
  canConfirm,
  citationCheck,
  promptSections,
  recordText,
  retrieve,
  sha256,
  tokens,
  vectorize,
} from "./copilot.js";

// Generated from the backend's own code by scripts/lexical_fixture.py.
const fixture = JSON.parse(readFileSync(new URL("./fixtures/lexical.json", import.meta.url)));
const sparse = (vector) => Object.fromEntries([...vector].sort((a, b) => a[0] - b[0]).map(([k, v]) => [String(k), v]));
const close = (a, b, label) => {
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), label);
  for (const k of Object.keys(a)) assert.ok(Math.abs(a[k] - b[k]) < 1e-9, `${label} slot ${k}`);
};

test("sha256 matches known digests", () => {
  assert.equal(sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  // Two 64-byte blocks: the length field must spill into the second one.
  assert.equal(sha256("a".repeat(56)), "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a");
  assert.equal(sha256("a".repeat(200)).length, 64);
});

test("tokens and query vectors match the backend exactly", () => {
  for (const t of fixture.texts) {
    assert.deepEqual(tokens(t.text), t.tokens, t.text);
    close(sparse(vectorize(t.text).vector), t.query, t.text);
  }
});

test("record text and document vectors match the backend exactly", () => {
  for (const r of fixture.records) {
    assert.equal(recordText(r), r.text, r.type);
    close(sparse(vectorize(r.text, r.title).vector), r.document, r.type);
  }
});

test("retrieval applies the overlap filter, the distance cutoff and the limit", () => {
  const records = fixture.records.map((r, i) => ({ ...r, id: `r${i}`, approvedForAi: true }));
  for (const t of fixture.texts) {
    const run = retrieve(t.text, records);
    for (const r of fixture.records) {
      const hit = run.scored?.find((s) => s.record.title === r.title);
      if (hit) assert.equal(hit.shared.length > 0, r.overlap[t.text], `${t.text} / ${r.title}`);
    }
    assert.ok((run.kept ?? []).every((k) => k.distance <= 0.98 && k.shared.length));
  }
  const stop = retrieve("please show me what i have to do", records);
  assert.deepEqual(stop.kept, []);
  assert.match(stop.skipped ?? "", /stopword/);
  // Records not approved for AI are never indexed, so they are set aside unread.
  const hidden = retrieve("GDP report", records.map((r) => ({ ...r, approvedForAi: false })));
  assert.equal(hidden.kept.length, 0);
  assert.equal(hidden.scored.length, 0);
  assert.equal(hidden.excluded.length, records.length);
  assert.deepEqual(stop.candidates, []);
  assert.equal(CANDIDATES, 25);
});

test("prompt sections keep the backend's order", () => {
  const names = promptSections({ message: "hi there", today: "2026-10-23" }).map((s) => s.name);
  assert.deepEqual(names.slice(1, 4), ["TODAY", "PLANNER_BRIEFING", "UNTRUSTED_SOURCES"]);
  assert.ok(names.indexOf("CONVERSATION") < names.indexOf("USER_QUESTION"));
  assert.ok(names.indexOf("USER_QUESTION") < names.indexOf("TOOLS_AVAILABLE"));
  assert.equal(names.at(-1), "Reply style");
});

test("the citation check and the confirm rule follow the backend", () => {
  assert.equal(citationCheck(["S9"], ["S1", "S2"], 0).abstain, true);
  assert.equal(citationCheck(["S9"], ["S1"], 1).abstain, false);
  assert.deepEqual(citationCheck(["S1", "S9"], ["S1"], 0).kept, ["S1"]);
  assert.equal(canConfirm({ base_revision: 3, status: "pending" }, 3).nextRevision, 4);
  assert.match(canConfirm({ base_revision: 3, status: "pending" }, 4).reason, /revision 4/);
  assert.equal(canConfirm({ base_revision: 3, status: "confirmed" }, 3).ok, false);
});

test("the retrieval step is badged real only when the reply carries the server's search", async () => {
  const { copilotSteps, COPILOT_STEPS } = await import("../steps.js");
  const { sampleCopilot } = await import("./copilotSample.js");
  const badge = (steps) => steps.find((s) => s.id === "retrieval").badge;
  assert.equal(badge(COPILOT_STEPS), "recomputed");
  assert.equal(badge(copilotSteps({ response: null })), "recomputed");
  assert.equal(badge(copilotSteps(sampleCopilot())), "real");
  const kept = sampleCopilot().response.retrieval.searches[0].candidates.filter((c) => c.outcome === "kept");
  assert.equal(kept[0].record_id, sampleCopilot().response.citations[0].record_id);
});
