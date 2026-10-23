// One-line "went in / came out" summaries per step, from the real results,
// for the Flow view. Kept short: details live in the 2D and 3D maps.
import { friendlyDate, friendlyTime } from "./engine/pipeline.js";

const q = (s) => `“${s}”`;
const list = (items, max = 6) =>
  items.length > max ? `${items.slice(0, max).join(", ")} … (${items.length})` : items.join(", ");
const pct = (p) => `${(p * 100).toFixed(1)}%`;
const vec = (row) => `[${row.map((v) => v.toFixed(2)).join(", ")}]`;

export function summarize(id, { trace, data, records, applied, generatedTokens }) {
  const m = data.transformer;
  const e = trace.entities;
  const last = m.tokens.length - 1;
  switch (id) {
    case "signal":
      return { in: q(trace.original), out: q(trace.normalized) };
    case "tokenize":
      return {
        in: q(trace.normalized),
        out: `${trace.tokens.length} tokens: ${list(trace.tokens.map((t) => t.text), 8)}`,
      };
    case "parse":
      return {
        in: `${trace.tokens.length} tokens`,
        out: [
          `action: ${e.intent}`,
          `date: ${e.date ? friendlyDate(e.date) : "none"}`,
          `time: ${e.time ? friendlyTime(e.time) : "none"}`,
          `title: ${e.title ? q(e.title) : "none"}`,
        ].join(" · "),
      };
    case "filter":
      return { in: e.title ? q(e.title) : "no title", out: e.keywords.length ? list(e.keywords) : "no search words" };
    case "vectorize":
      return {
        in: `${e.keywords.length} search words, ${trace.vectors.results.length} saved titles`,
        out: `${trace.vectors.dimensions.length} word dimensions, one number per word`,
      };
    case "retrieve": {
      const top = trace.vectors.results.slice(0, 3);
      return {
        in: "your words vs. each saved title",
        out: top.map((r) => `${r.record.id} ${r.record.title}: ${r.score.toFixed(2)}`).join(" · "),
      };
    }
    case "decide": {
      const hit = trace.rules.find((r) => r.hit);
      return {
        in: `${trace.rules.length} rules checked in order`,
        out: `${hit ? `“${hit.test}”` : "—"} → ${trace.decision.status === "clarify" ? `asks: ${trace.decision.message}` : trace.decision.message}`,
      };
    }
    case "respond": {
      const p = trace.decision.proposal;
      if (!p) return { in: trace.decision.status, out: "nothing to save" };
      return {
        in: `${p.intent} ${q(p.title)}`,
        out: applied
          ? `saved · ${records.length} reminders`
          : "waiting for you to confirm",
      };
    }
    case "bpe":
      return { in: q(trace.original), out: `${m.tokens.length} chunks: ${list(m.tokens, 8)}` };
    case "embedding":
      return { in: `${m.tokens.length} chunks`, out: m.tokens.length ? `“${m.tokens[last]}” → ${vec(m.embeddings[last])}` : "—" };
    case "position":
      return { in: "chunk numbers + position", out: m.tokens.length ? `position ${last} → ${vec(m.positions[last])}` : "—" };
    case "qk":
      return { in: `${m.tokens.length} × 4 numbers`, out: `${m.tokens.length} × ${m.tokens.length} relevance scores` };
    case "attention": {
      const row = m.weights[last] ?? [];
      const best = row.indexOf(Math.max(...row));
      return {
        in: "relevance scores",
        out: best >= 0 ? `last chunk looks most at “${m.tokens[best]}” (${pct(row[best])})` : "—",
      };
    }
    case "output":
      return { in: "percentages + chunk numbers", out: m.tokens.length ? `blended: ${vec(m.output[last])}` : "—" };
    case "residual":
      return { in: "blend + original", out: m.tokens.length ? `normalized: ${vec(m.norm1[last])}` : "—" };
    case "feedforward":
      return { in: "4 numbers per chunk", out: m.tokens.length ? `4 → 8 → 4: ${vec(m.norm2[last])}` : "—" };
    case "logits":
      return {
        in: `last chunk vs. ${m.vocabulary.length} known chunks`,
        out: m.ranked.slice(0, 3).map((r) => `“${r.token}” ${pct(r.probability)}`).join(" · "),
      };
    case "decode":
      return {
        in: "probabilities",
        out: `next: “${m.nextToken}”${generatedTokens.length ? ` · added so far: ${generatedTokens.join(" ")}` : ""}`,
      };
    default:
      return { in: "", out: "" };
  }
}

// The higher-level grouping the Flow view uses: which steps form one stage.
export const GROUPS = {
  planner: [
    { name: "Read the words", steps: ["signal", "tokenize"] },
    { name: "Understand the request", steps: ["parse", "filter"] },
    { name: "Find the reminder", steps: ["vectorize", "retrieve"] },
    { name: "Act safely", steps: ["decide", "respond"] },
  ],
  transformer: [
    { name: "Turn text into numbers", steps: ["bpe", "embedding", "position"] },
    { name: "Attention: which words matter to which", steps: ["qk", "attention", "output"] },
    { name: "Process each chunk", steps: ["residual", "feedforward"] },
    { name: "Predict the next chunk", steps: ["logits", "decode"] },
  ],
};
