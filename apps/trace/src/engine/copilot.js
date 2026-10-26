// The planner copilot's search, recomputed in the browser. Mirrors
// backend/app/local_embeddings.py ("local-lexical-v1"), tools.py record_text
// and the filters in rag.py RetrievalService. Parity with the Python is
// checked against a fixture in copilot.test.js.

export const STOPWORDS = new Set(
  "a about and are at be can did do for from have i in is it me my of on please show the to what when which who will with you".split(
    " ",
  ),
);
export const DIMENSIONS = 768;
// The 768 slots drawn as a 24 × 32 grid.
export const VECTOR_COLS = 32;
export const RETRIEVAL_LIMIT = 5;
export const CANDIDATES = RETRIEVAL_LIMIT * 5;
export const MAX_DISTANCE = 0.98;
export const QUERY_CHARS = 500;
export const MESSAGE_CHARS = 8000;
// The search settings a visitor can tune. The defaults are the server's own;
// anything else is a what-if the server never ran.
export const COPILOT_DEFAULTS = {
  stopwords: [...STOPWORDS],
  dimensions: DIMENSIONS,
  titleBoost: 2,
  logWeight: true,
  candidates: CANDIDATES,
  limit: RETRIEVAL_LIMIT,
  maxDistance: MAX_DISTANCE,
  requireShared: true,
  queryChars: QUERY_CHARS,
};
const stopSets = new WeakMap();
const stopSet = (p) => {
  if (p.stopwords === COPILOT_DEFAULTS.stopwords) return STOPWORDS;
  let set = stopSets.get(p.stopwords);
  if (!set) stopSets.set(p.stopwords, (set = new Set(p.stopwords)));
  return set;
};
// The trace names no provider or model: it explains what any hosted LLM in
// this position does. The settings below are the planner's real ones.
export const MODEL = {
  name: "an LLM",
  temperature: 0.1,
  reasoningEffort: "xhigh",
  output: "strict JSON schema (GeneratedAnswer)",
  maxRounds: 3,
  maxToolCalls: 4,
  deadlineSeconds: 90,
};

// Python's str.casefold for the characters that survive [a-z0-9] after it.
const FOLD = { ß: "ss", ẞ: "ss", ﬀ: "ff", ﬁ: "fi", ﬂ: "fl", ﬃ: "ffi", ﬄ: "ffl", ﬅ: "st", ﬆ: "st" };
export const casefold = (text) => text.toLowerCase().replace(/[ßẞﬀ-ﬆ]/g, (c) => FOLD[c] ?? c);

export function tokenSteps(text, p = COPILOT_DEFAULTS) {
  const folded = casefold(text);
  const words = folded.match(/[a-z0-9]+/g) ?? [];
  const stop = stopSet(p);
  return {
    folded,
    words,
    kept: words.filter((w) => !stop.has(w)),
    dropped: words.filter((w) => stop.has(w)),
  };
}
export const tokens = (text, p = COPILOT_DEFAULTS) => tokenSteps(text, p).kept;

// SHA-256 (FIPS 180-4), synchronous so every frame can show its digest.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);
export function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const length = ((bytes.length + 9 + 63) >> 6) << 6;
  const data = new Uint8Array(length);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const bits = bytes.length * 8;
  const view = new DataView(data.buffer);
  view.setUint32(length - 8, Math.floor(bits / 2 ** 32));
  view.setUint32(length - 4, bits >>> 0);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rot = (x, n) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      k = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += k;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}

// The first 4 digest bytes as a big-endian integer, modulo the dimensions (768).
export function slotOf(token, p = COPILOT_DEFAULTS) {
  const digest = sha256(token);
  const first = parseInt(digest.slice(0, 8), 16);
  return { digest, first, slot: first % p.dimensions };
}

// Sparse vector: slot → weight, plus the per-token working.
export function vectorize(text, title = "", p = COPILOT_DEFAULTS) {
  const counts = new Map();
  for (const t of tokens(text, p)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const titleTokens = [...new Set(tokens(title, p))];
  for (const t of titleTokens) counts.set(t, (counts.get(t) ?? 0) + p.titleBoost);
  const rows = [...counts]
    .filter(([, count]) => count > 0)
    .map(([token, count]) => ({
      token,
      count,
      titleBoost: titleTokens.includes(token),
      ...slotOf(token, p),
      weight: p.logWeight ? 1 + Math.log(count) : count,
    }));
  const vector = new Map();
  for (const r of rows) vector.set(r.slot, (vector.get(r.slot) ?? 0) + r.weight);
  return { rows, vector };
}

export function cosineDistance(a, b) {
  let dot = 0;
  for (const [slot, v] of a) if (b.has(slot)) dot += v * b.get(slot);
  const norm = (m) => Math.sqrt([...m.values()].reduce((s, v) => s + v * v, 0));
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return { dot, na, nb, distance: 1 };
  return { dot, na, nb, distance: 1 - dot / (na * nb) };
}

// tools.py record_text. Records use the planner's client field names.
export function recordText(record) {
  const type = record.type;
  const parts = [record.title];
  if (type === "task")
    parts.push(
      record.notes ?? "",
      `Due ${record.dueDate || "unscheduled"} ${record.dueTime || ""}`,
      `Priority ${record.priority ?? "medium"}`,
      `Category ${record.category ?? "Other"}`,
      record.completed ? "Completed" : "Open",
    );
  else if (type === "note") parts.push(record.body ?? "");
  else if (type === "reminder")
    parts.push(
      JSON.stringify({
        date: record.date ?? null,
        time: record.time ?? null,
        notes: record.notes ?? "",
        completed: !!record.completed,
        series_id: record.seriesId ?? null,
        recurrence: record.recurrence ?? null,
      }),
    );
  else parts.push(JSON.stringify({ starts_at: record.startsAt ?? null, ends_at: record.endsAt ?? null, notes: record.notes ?? "" }));
  return parts.filter(Boolean).join("\n");
}

// Every readable record scored, then the server's filters in order, then the
// top 5. Records not approved for AI are never indexed on the server, so they
// are set aside unread.
export function retrieve(message, records, p = COPILOT_DEFAULTS) {
  const query = message.trim().slice(0, p.queryChars);
  const q = vectorize(query, "", p);
  const queryTokens = new Set(tokens(query, p));
  const excluded = records.filter((r) => r.approvedForAi === false);
  const readable = records.filter((r) => r.approvedForAi !== false);
  if (!queryTokens.size)
    return {
      query,
      q,
      excluded,
      skipped: "every word is a stopword, so search is skipped",
      scored: [],
      candidates: [],
      kept: [],
    };
  const scored = readable
    .map((record) => {
      const text = recordText(record);
      const d = vectorize(text, record.title, p);
      const cos = cosineDistance(q.vector, d.vector);
      const shared = [...new Set(tokens(text, p))].filter((t) => queryTokens.has(t));
      return { record, text, d, ...cos, shared };
    })
    .sort((a, b) => a.distance - b.distance || String(a.record.id).localeCompare(String(b.record.id)));
  const candidates = scored.slice(0, p.candidates);
  const kept = [];
  for (const s of candidates) {
    s.reason =
      s.distance > p.maxDistance
        ? `distance ${s.distance.toFixed(3)} > ${p.maxDistance}`
        : p.requireShared && !s.shared.length
            ? "no shared word (hash collision)"
            : kept.length >= p.limit
              ? `limit of ${p.limit} reached`
              : null;
    if (!s.reason) kept.push(s);
  }
  return { query, q, excluded, scored, candidates, kept };
}

// The labelled sections of the user prompt, in the order rag.py _prompt
// writes them. Sizes are computed from what the browser knows.
export function promptSections({ message, history = [], focus = null, hits = [], today }) {
  const hitChars = hits.reduce((s, h) => s + Math.min(2000, h.text.length) + 120, 0);
  return [
    { name: "Preamble", what: "system instructions (not shown)", chars: null, real: false },
    { name: "TODAY", what: `the date in your timezone (${today})`, chars: 40, real: true },
    { name: "PLANNER_BRIEFING", what: "overdue, today, this week: up to 40 records", chars: null, real: false },
    { name: "UNTRUSTED_SOURCES", what: `${hits.length} search hit${hits.length === 1 ? "" : "s"}, each ≤ 2000 chars, marked untrusted`, chars: hitChars, real: true },
    { name: "TOOL_RESULTS", what: "results of lookups the model asks for", chars: null, real: false },
    { name: "CONVERSATION", what: `${history.length} earlier turn${history.length === 1 ? "" : "s"} (max 20 × 4000 chars)`, chars: history.reduce((s, t) => s + Math.min(4000, t.text.length), 0), real: true },
    { name: focus ? "FOCUS_RECORD" : "FOCUS_RECORD (none)", what: focus ? `“${focus.title}”, up to 4000 chars` : "no record attached", chars: focus ? Math.min(4000, recordText(focus).length) : 0, real: true },
    { name: "USER_QUESTION", what: "your message", chars: Math.min(MESSAGE_CHARS, message.trim().length), real: true },
    { name: "TOOLS_AVAILABLE", what: "the lookups the model may request", chars: null, real: false },
    { name: "Reply style", what: "a closing note on reply style (not shown)", chars: null, real: false },
  ];
}

// rag.py _finalize: an answer citing only ids that were never issued, with no
// changes to suggest, is replaced by an abstention.
export function citationCheck(citedIds, issuedIds, actionCount) {
  const issued = new Set(issuedIds);
  const unknown = citedIds.filter((id) => !issued.has(id));
  const abstain = citedIds.length > 0 && unknown.length === citedIds.length && actionCount === 0;
  return { unknown, abstain, kept: citedIds.filter((id) => issued.has(id)) };
}

// repository.py confirm transaction: only a pending proposal whose base
// revision still matches the record can be written.
export function canConfirm(proposal, currentRevision) {
  if (proposal.status && proposal.status !== "pending") return { ok: false, reason: `status is ${proposal.status}` };
  if (currentRevision !== undefined && currentRevision !== proposal.base_revision)
    return { ok: false, reason: `record is at revision ${currentRevision}, proposal expects ${proposal.base_revision}` };
  return { ok: true, nextRevision: proposal.base_revision + 1 };
}
