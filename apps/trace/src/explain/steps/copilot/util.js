// Helpers shared by the copilot step modules.
import { QUERY_CHARS, retrieve } from "../../../engine/copilot.js";

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
export const short = (text, n = 60) => {
  const s = String(text ?? "");
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
export const num = (n) => Number(n).toLocaleString("en-US");

// The validated message and the search query cut from it.
export function messageOf(ctx) {
  const c = ctx.copilot;
  const raw = c.message ?? "";
  const trimmed = raw.trim();
  return { raw, trimmed, query: trimmed.slice(0, QUERY_CHARS), history: c.history ?? [], focus: c.focus ?? null };
}

// Rows of the "cmessage" block, read by later steps.
export const MESSAGE_ROW = { length: 0, history: 1, focus: 2, timezone: 3, query: 4 };

export const sampleNote = (ctx) => (ctx.copilot.demo ? " This is the sample exchange, not one you sent." : "");

// The browser's retrieval. Records not approved for AI are left out before
// scoring: the copilot never reads them, and neither does this page.
const cache = new WeakMap();
export function retrievalOf(ctx) {
  const c = ctx.copilot;
  let r = cache.get(c);
  if (!r) {
    const records = c.records ?? [];
    const hidden = records.filter((x) => x.approvedForAi === false);
    const readable = records.filter((x) => x.approvedForAi !== false);
    const result = retrieve(c.message ?? "", records);
    const candidates = result.candidates ?? [];
    r = {
      ...result,
      records,
      hidden,
      readable,
      candidates,
      keptRows: result.kept.map((k) => candidates.indexOf(k)),
    };
    cache.set(c, r);
  }
  return r;
}

// Word wrap for the answer block.
export function wrap(text, width = 48) {
  const lines = [];
  for (const para of String(text ?? "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
      while (line.length > width) {
        lines.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    lines.push(line);
  }
  return lines;
}

export const value = (v) =>
  v === undefined || v === null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

export const reasonOf = (u) => (typeof u === "string" ? u : (u?.reason ?? JSON.stringify(u)));
