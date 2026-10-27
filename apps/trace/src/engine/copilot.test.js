import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPrompt,
  CANDIDATES,
  canConfirm,
  citationCheck,
  pyJson,
  safeExcerpt,
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

// Generated from the backend's own code by scripts/prompt_fixture.py.
const prompts = JSON.parse(readFileSync(new URL("./fixtures/prompt.json", import.meta.url)));

function exchangeOf(c) {
  const records = prompts.records;
  const kept = (c.expected.searches[0]?.candidates ?? [])
    .filter((x) => x.outcome === "kept")
    .map((x) => records.find((r) => r.id === x.record_id));
  const turn = {
    today: c.today,
    reply_style: c.settings.reply_style,
    daily_capacity_minutes: c.settings.max_daily_minutes ?? 360,
    indexed_entity_types: c.settings.indexed_entity_types,
    index_attachments: c.settings.index_attachments,
  };
  const focus = c.focus ? records.find((r) => r.id === c.focus.record_id) : null;
  const exchange = { message: c.message, history: c.history, earlier: c.earlier, focus, today: c.today, records, response: { retrieval: { turn } } };
  return { exchange, kept };
}

test("json encoding and excerpts match Python's", () => {
  assert.equal(pyJson({ a: [1, true, null], b: "“é”\n\u0001" }), '{"a": [1, true, null], "b": "\\u201c\\u00e9\\u201d\\n\\u0001"}');
  assert.equal(pyJson("👋"), '"\\ud83d\\udc4b"');
  assert.equal(safeExcerpt("  a \n\t b  ", 240), "a b");
  assert.equal(safeExcerpt("abcdef", 3), "abc…");
});

test("the rebuilt prompt matches the server's, section by section", () => {
  for (const c of prompts.cases) {
    const { exchange, kept } = exchangeOf(c);
    const built = buildPrompt(exchange, { kept, items: c.briefing_items ?? 40 });
    assert.deepEqual(built.sections.map((s) => s.name), c.expected.sections.map((s) => s.name), c.name);
    built.sections.forEach((s, i) => assert.equal(s.text, c.expected.sections[i].text, `${c.name}: ${s.name}`));
    assert.equal(built.chars, c.expected.chars, c.name);
    assert.deepEqual(built.issued, c.expected.issued, `${c.name}: citation ledger`);
  }
});

test("the browser's search reaches the server's outcomes on the same records", () => {
  for (const c of prompts.cases) {
    const run = retrieve(c.message, prompts.records, undefined, { types: c.settings.indexed_entity_types, attachments: c.settings.index_attachments });
    const outcome = (reason) => (!reason ? "kept" : reason.startsWith("distance") ? "too_far" : reason.startsWith("no shared") ? "no_shared_word" : "limit_reached");
    const mine = new Map(run.candidates.map((x) => [x.record.id, [Math.round(x.distance * 1e6) / 1e6, outcome(x.reason)]]));
    for (const x of c.expected.searches[0].candidates) assert.deepEqual(mine.get(x.record_id), [x.distance, x.outcome], `${c.name}: ${x.record_id}`);
  }
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
  const sample = sampleCopilot();
  const kept = sample.response.retrieval.searches[0].candidates.filter((c) => c.outcome === "kept");
  assert.equal(kept[0].record_id, sample.response.citations[0].record_id);
  // The sample's citation ids come from the same ledger the prompt uses.
  assert.equal(kept[0].citation_id, sample.response.citations[0].citation_id);
  assert.equal(sample.response.retrieval.result_count, sample.response.retrieval.turn.issued.length);
  const prompt = (steps) => steps.find((s) => s.id === "prompt").badge;
  assert.equal(prompt(COPILOT_STEPS), "recomputed");
  assert.equal(prompt(copilotSteps(sample)), "real");
  // The model illustration says how large the real prompt was.
  assert.match(copilotSteps(sample).find((s) => s.id === "bpe").limit, /characters \(roughly/);
});
