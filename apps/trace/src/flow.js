// One-line "went in / came out" summaries per step, from the real results,
// for the Flow view. Kept short: details live in the 2D and 3D maps.
import { friendlyDate, friendlyTime } from "./engine/pipeline.js";
import { MODEL, promptSections, QUERY_CHARS, retrieve, tokenSteps, vectorize } from "./engine/copilot.js";

const q = (s) => `“${s}”`;
const list = (items, max = 6) =>
  items.length > max ? `${items.slice(0, max).join(", ")} … (${items.length})` : items.join(", ");
const pct = (p) => `${(p * 100).toFixed(1)}%`;
const vec = (row) => `[${row.map((v) => v.toFixed(2)).join(", ")}]`;

function summarizeCopilot(id, c) {
  const query = c.message.trim().slice(0, QUERY_CHARS);
  const r = c.response;
  switch (id) {
    case "message":
      return { in: q(c.message.trim()), out: `${c.message.trim().length} chars · ${c.history.length} earlier turns${c.focus ? ` · about “${c.focus.title}”` : ""}` };
    case "searchwords": {
      const s = tokenSteps(query);
      return { in: `${s.words.length} words`, out: s.kept.length ? list(s.kept) : "only stopwords: search skipped" };
    }
    case "hashvector": {
      const v = vectorize(query);
      return { in: `${v.rows.length} search words`, out: v.rows.length ? list(v.rows.map((x) => `${x.token}→${x.slot}`), 5) : "empty vector" };
    }
    case "retrieval": {
      const run = retrieve(c.message, c.records);
      if (run.skipped) return { in: `${c.records.length} records`, out: "search skipped" };
      return {
        in: `${c.records.length} records in this browser`,
        out: run.kept.length ? run.kept.map((k) => `${k.record.title} (${k.distance.toFixed(2)})`).join(" · ") : "no record close enough",
      };
    }
    case "prompt": {
      const kept = retrieve(c.message, c.records).kept ?? [];
      const sections = promptSections({ message: c.message, history: c.history, focus: c.focus, hits: kept, today: c.today });
      return { in: "sources, conversation, question", out: `${sections.length} labelled sections → ${MODEL.id}` };
    }
    case "lookups":
      return { in: "model output", out: !r ? "no reply yet" : r.steps?.length ? r.steps.map((s) => s.label).join(" · ") : "no extra lookups" };
    case "answer":
      return { in: "model JSON", out: !r ? "no reply yet" : `${q(r.answer.slice(0, 90))}${r.answer.length > 90 ? "…" : ""} · ${r.citations?.length ?? 0} citations` };
    case "proposals":
      return {
        in: "suggested actions",
        out: !r ? "no reply yet" : r.proposals?.length ? r.proposals.map((p) => `${p.operation} “${p.after?.title ?? p.before?.title ?? p.record_id}”`).join(" · ") : "no changes suggested",
      };
    default:
      return null;
  }
}

export function summarize(id, ctx) {
  if (ctx.copilot) {
    const c = summarizeCopilot(id, ctx.copilot);
    if (c) return c;
  }
  return summarizeTrack(id, ctx);
}

function summarizeTrack(id, { trace, data, records, applied, generatedTokens }) {
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
  copilot: [
    { name: "Your message", steps: ["message"] },
    { name: "Search your planner (recomputed)", steps: ["searchwords", "hashvector", "retrieval"] },
    { name: "Build the prompt", steps: ["prompt"] },
    { name: "Inside a language model (illustration)", steps: ["bpe", "embedding", "position", "qk", "attention", "output", "residual", "feedforward", "logits", "decode"] },
    { name: "Answer and act (real)", steps: ["lookups", "answer", "proposals"] },
  ],
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
