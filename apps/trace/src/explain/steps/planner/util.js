// Helpers shared by the planner step modules. Pure functions only.
import { terms } from "../../../engine/pipeline.js";

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export const hex = (cp, pad = 4) => cp.toString(16).toUpperCase().padStart(pad, "0");
export const uPlus = (cp) => `U+${hex(cp)}`;

// The UTF-16 code units of one code point, as hex.
export const unitsOf = (ch) =>
  Array.from({ length: ch.length }, (_, i) => hex(ch.charCodeAt(i)));

const NAMED = { " ": "space", "\t": "tab", "\n": "newline", "\r": "carriage return" };
// A printable name for a character in prose and tables.
export const visible = (ch) => NAMED[ch] ?? (/\s/u.test(ch) ? uPlus(ch.codePointAt(0)) : ch);
// A string with whitespace made visible, for code-style display.
export const showWs = (s) =>
  s.replace(/ /g, "␣").replace(/\t/g, "⇥").replace(/\n/g, "↵").replace(/\r/g, "␍");

export function charClass(ch) {
  if (/\s/u.test(ch)) return "whitespace";
  if (/\p{L}/u.test(ch)) return "letter";
  if (/\p{M}/u.test(ch)) return "combining mark";
  if (/\p{Nd}/u.test(ch)) return "digit";
  if (/\p{N}/u.test(ch)) return "number";
  if (/\p{P}/u.test(ch)) return "punctuation";
  if (/\p{S}/u.test(ch)) return "symbol";
  return "other";
}

export const codePoints = (s) => Array.from(s, (ch) => uPlus(ch.codePointAt(0))).join(" ");

// Code points of a string with their UTF-16 offsets.
function cells(s) {
  let o = 0;
  return Array.from(s, (ch) => {
    const cell = { ch, o };
    o += ch.length;
    return cell;
  });
}

// Changed regions between two strings, from a longest-common-subsequence
// alignment over code points. Offsets are UTF-16 offsets into each string.
// hunk: { bStart, bEnd, aStart, aEnd, from, to }
export function diff(before, after) {
  const a = cells(before);
  const b = cells(after);
  let p = 0;
  while (p < a.length && p < b.length && a[p].ch === b[p].ch) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s].ch === b[b.length - 1 - s].ch) s++;
  const A = a.slice(p, a.length - s);
  const B = b.slice(p, b.length - s);
  const n = A.length;
  const m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = A[i].ch === B[j].ch ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const offA = (k) => (k < a.length ? a[k].o : before.length);
  const offB = (k) => (k < b.length ? b[k].o : after.length);
  const hunks = [];
  let open = null;
  let i = 0;
  let j = 0;
  const close = () => {
    if (!open) return;
    open.bEnd = offA(p + i);
    open.aEnd = offB(p + j);
    open.from = before.slice(open.bStart, open.bEnd);
    open.to = after.slice(open.aStart, open.aEnd);
    hunks.push(open);
    open = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && A[i].ch === B[j].ch) {
      close();
      i++;
      j++;
      continue;
    }
    if (!open) open = { bStart: offA(p + i), aStart: offB(p + j) };
    if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) i++;
    else j++;
  }
  close();
  return hunks;
}

// Whitespace runs that `replace(/\s+/g, " ")` actually changes.
export function collapseHunks(before) {
  const hunks = [];
  let shift = 0;
  for (const m of before.matchAll(/\s+/g)) {
    if (m[0] === " ") continue;
    const aStart = m.index - shift;
    hunks.push({ bStart: m.index, bEnd: m.index + m[0].length, aStart, aEnd: aStart + 1, from: m[0], to: " " });
    shift += m[0].length - 1;
  }
  return hunks;
}

// Leading and trailing whitespace that `trim()` removes.
export function trimHunks(before) {
  const hunks = [];
  const lead = before.match(/^\s+/)?.[0] ?? "";
  if (lead) hunks.push({ bStart: 0, bEnd: lead.length, aStart: 0, aEnd: 0, from: lead, to: "" });
  const tail = before.slice(lead.length).match(/\s+$/)?.[0] ?? "";
  if (tail && lead.length < before.length) {
    const end = before.length - lead.length - tail.length;
    hunks.push({ bStart: before.length - tail.length, bEnd: before.length, aStart: end, aEnd: end, from: tail, to: "" });
  }
  return hunks;
}

// Spans for <Chars>: one side of a list of hunks.
export function hunkSpans(hunks, side, active = -1, cls = side === "before" ? "removed" : "hit") {
  return hunks
    .map((h, i) =>
      side === "before"
        ? { start: h.bStart, end: h.bEnd, cls: i === active ? "active" : cls }
        : { start: h.aStart, end: h.aEnd, cls: i === active ? "active" : cls },
    )
    .filter((s) => s.end > s.start);
}

// The records in the order vectorize() saw them (aligned with
// vectors.documents). The trace only keeps them sorted by score, so the
// order is recovered from ctx.records and each record's title terms.
export function analyzedRecords(ctx) {
  const { trace } = ctx;
  const records = ctx.records ?? [];
  const docs = trace.vectors.documents;
  const rank = (r) => {
    const i = records.findIndex((x) => x.id === r.id);
    return i < 0 ? Infinity : i;
  };
  const pool = trace.vectors.results
    .map((r) => r.record)
    .sort((x, y) => rank(x) - rank(y) || x.id.localeCompare(y.id, undefined, { numeric: true }));
  const used = new Set();
  return docs.map((doc) => {
    const key = doc.join(" ");
    const hit =
      pool.find((r) => !used.has(r) && terms(r.title).join(" ") === key) ??
      pool.find((r) => !used.has(r));
    used.add(hit);
    return hit;
  });
}

// Index of `needle` in `hay`, as a span, or null.
export function spanOf(hay, needle, from = 0) {
  if (!needle) return null;
  const i = hay.indexOf(needle, from);
  return i < 0 ? null : { start: i, end: i + needle.length };
}

// ---- Map layer helpers ----

// Rows of the Extract "slots" block, in order. Other steps read these by index.
export const SLOT_ROWS = ["intent", "date", "time", "recurring", "weeks", "title", "issues"];
export const slotRow = (key) => SLOT_ROWS.indexOf(key);

// Columns of the Cosine "cosine" block.
export const COSINE_COLS = ["title", "q·d", "‖d‖", "cos", "rank", "> 0.08"];

// Cells of the Tokenize "tokens" block (text column) whose normalized text
// spells `text`, as a contiguous run.
export function tokenCells(trace, text) {
  if (!text) return [];
  const want = Array.from(String(text).matchAll(/\S+/g), (m) => m[0]);
  const toks = trace.tokens;
  const norm = toks.map((t) => t.normalized);
  // Compare on the concatenation without spaces so "11:00!" style splits still match.
  const target = want.join("");
  for (let i = 0; i < toks.length; i++) {
    let acc = "";
    for (let k = i; k < toks.length; k++) {
      acc += norm[k];
      if (acc === target) return Array.from({ length: k - i + 1 }, (_, n) => [i + n, 1]);
      if (!target.startsWith(acc)) break;
    }
  }
  return [];
}

// Leading/trailing and repeated whitespace made visible; single spaces kept.
export const edgeWs = (s) =>
  s
    .replace(/\t/g, "⇥")
    .replace(/\n/g, "↵")
    .replace(/^\s+|\s+$/g, (m) => "␣".repeat(m.length))
    .replace(/\s{2,}/g, (m) => "␣".repeat(m.length));

// Progressive reveal: a cell of an own block is done from the first frame
// that writes it (lists it as active), always when `isStatic`, and on the
// last frame. `cellsOf(frame, ctx)` returns { id: { active, source } }.
const revealCache = new WeakMap();
function firstWrites(module, ctx, cellsOf) {
  let byModule = revealCache.get(ctx);
  if (!byModule) revealCache.set(ctx, (byModule = new Map()));
  let hit = byModule.get(module.id);
  if (!hit) {
    const frames = module.frames(ctx);
    const first = new Map();
    frames.forEach((f, i) => {
      for (const [id, v] of Object.entries(cellsOf(f, ctx)))
        for (const [r, c] of v.active ?? []) {
          const key = `${id}:${r},${c}`;
          if (!first.has(key)) first.set(key, i);
        }
    });
    hit = { first, last: frames.length - 1 };
    byModule.set(module.id, hit);
  }
  return hit;
}
export function revealState(module, frame, ctx, cellsOf, own) {
  const { first, last } = firstWrites(module, ctx, cellsOf);
  const fi = frame.fi ?? last;
  const s = cellsOf(frame, ctx);
  for (const [id, isStatic] of Object.entries(own))
    s[id] = {
      ...(s[id] ?? {}),
      done: (r, c) => fi >= last || isStatic(r, c) || (first.get(`${id}:${r},${c}`) ?? Infinity) <= fi,
    };
  return s;
}
export const indexed = (frames) => frames.map((f, fi) => ({ ...f, fi }));

// Rows of the Decide "decision" block.
export function decisionRows(trace) {
  const d = trace.decision;
  const p = d.proposal;
  const rows = [
    { key: "status", value: d.status, tone: d.status === "proposal" ? "good" : d.status === "answer" ? "keyword" : "warn" },
    { key: "reason", value: d.reason },
    { key: "message", value: d.message },
  ];
  if (p)
    rows.push(
      { key: "intent", value: p.intent },
      { key: "targetId", value: p.targetId ?? "null" },
      { key: "expectedRevision", value: p.expectedRevision ?? "null" },
      { key: "title", value: p.title },
      { key: "date / time", value: `${p.date ?? "null"} / ${p.time ?? "null"}` },
      { key: "dates", value: p.dates.join(", ") || "[]" },
    );
  return rows;
}
export const decisionRow = (trace, key) => decisionRows(trace).findIndex((r) => r.key === key);
