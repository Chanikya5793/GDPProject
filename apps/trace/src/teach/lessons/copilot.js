// Lessons for the copilot track, keyed by step id. See ./index.js for the shape.
import { MODEL, vectorize } from "../../engine/copilot.js";
import { isWhatIf, messageOf, num, paramsOf, plural, retrievalOf, short } from "../../explain/steps/copilot/util.js";
import transformer from "./transformer.js";

const f3 = (v) => Number(v).toFixed(3);
const has = (ctx) => !!ctx?.copilot;
// "with your settings" when tuned, so an example never passes a what-if off as real.
const yours = (ctx) => (isWhatIf(ctx) ? " (what-if: your settings)" : "");

const copilot = {
  message: {
    what: "Your message is trimmed and checked: it must be 1 to 8,000 characters. The first part of it becomes the search query.",
    why: "Limits keep one request from flooding the server. Searching only the start of a long message keeps the search fast and focused.",
    example(ctx) {
      if (!has(ctx)) return "";
      const m = messageOf(ctx);
      const n = paramsOf(ctx).queryChars;
      return `Your message has ${num(m.trimmed.length)} characters after trimming. The query is the first ${num(n)}: “${short(m.query, 80)}”.`;
    },
    try: [
      {
        setting: "copilot.queryChars",
        value: 20,
        watch: "The query is cut to “When is my GDP repor”. “repor” no longer matches “report”, so fewer records share a word and the kept list shrinks.",
      },
    ],
  },
  searchwords: {
    what: "The query is lowercased and split into words made of letters and digits. Common filler words (stopwords) are removed.",
    why: "Words like “the” and “my” appear in almost every record, so they would make everything look similar. Dropping them leaves the words that say what you want.",
    example(ctx) {
      if (!has(ctx)) return "";
      const r = retrievalOf(ctx);
      const kept = [...new Set(vectorize(messageOf(ctx).query, "", paramsOf(ctx)).rows.map((x) => x.token))];
      return kept.length
        ? `The search words are ${kept.join(", ")}${yours(ctx)}.`
        : `Every word is a stopword, so ${r.skipped ? "the search is skipped" : "nothing is searched"}${yours(ctx)}.`;
    },
    try: [
      { setting: "copilot.stopwords", value: [], watch: "With no stopwords, “when”, “is” and “my” become search words too. Every distance changes, and records start to match on filler." },
      { setting: "copilot.queryChars", value: 20, watch: "Only “when is my gdp repor” is searched, so “report”, “due” and “friday” disappear from the search words." },
    ],
  },
  hashvector: {
    what: "Each search word is fingerprinted with SHA-256, and the fingerprint picks one numbered box. The box gets a weight; repeated words weigh a bit more.",
    why: "A record and a query can be compared only if both are lists of numbers of the same length. Hashing gives every possible word a box without keeping a dictionary.",
    example(ctx) {
      if (!has(ctx)) return "";
      const p = paramsOf(ctx);
      const rows = vectorize(messageOf(ctx).query, "", p).rows;
      if (!rows.length) return "There are no search words, so the vector is all zeros.";
      const x = rows[0];
      return `sha256(“${x.token}”) starts with ${x.digest.slice(0, 8)}, which is ${num(x.first)}. ${num(x.first)} mod ${num(p.dimensions)} = ${x.slot}, so “${x.token}” goes in box ${x.slot} with weight ${f3(x.weight)}${yours(ctx)}.`;
    },
    try: [
      {
        setting: "copilot.dimensions",
        value: 16,
        watch: "With only 16 boxes, “move” and “friday” land in the same box. In Retrieval, “Call advisor” and “Meet professor” now look close through collisions and are dropped by the shared-word filter.",
      },
      { setting: "copilot.logWeight", value: false, watch: "Weights become plain counts. Titles count +2 at full strength, so “Submit GDP report” gets closer." },
    ],
  },
  retrieval: {
    what: "Your query vector is compared with every record you allowed the copilot to read. The nearest records that pass the filters become sources.",
    why: "The LLM can only use what is in its prompt. Retrieval picks the few records most likely to answer you, so the prompt stays short and on topic.",
    example(ctx) {
      if (!has(ctx)) return "";
      const r = retrievalOf(ctx);
      if (r.skipped) return "Every word is a stopword, so no records are compared.";
      if (!r.readable.length) return "There are no readable records in this browser to compare with.";
      const s = r.candidates[0];
      const top = `The nearest is “${short(s.record.title, 40)}”: distance = 1 − ${f3(s.dot)} / (${f3(s.na)} × ${f3(s.nb)}) = ${f3(s.distance)}.`;
      const searches = ctx.copilot.response?.retrieval?.searches ?? [];
      const server = searches[0]
        ? ` The server, on its default settings, kept ${plural(searches[0].candidates.filter((c) => c.outcome === "kept").length, "record")}.`
        : "";
      return `${top} ${plural(r.kept.length, "record")} kept of ${r.candidates.length} candidates${yours(ctx)}.${server}`;
    },
    try: [
      { setting: "copilot.maxDistance", value: 0.8, watch: "“Advisor meeting” (0.804) and “Pay housing bill” (0.923) are now too far. Only two records are kept." },
      { setting: "copilot.limit", value: 1, watch: "Only “Submit GDP report” is kept. The other close records are dropped with “limit of 1 reached”." },
    ],
  },
  memory: {
    what: "Earlier turns, sources cited earlier, and any record you attached are sent again with your new message.",
    why: "The LLM keeps nothing between messages. Without this, a follow-up like “move it” would have nothing to point at.",
    example(ctx) {
      if (!has(ctx)) return "";
      const c = ctx.copilot;
      const turns = (c.history ?? []).length;
      const earlier = c.earlier ?? [];
      if (!turns && !earlier.length && !c.focus) return "This is the first message, so nothing earlier is sent.";
      return `${plural(turns, "earlier turn")} and ${plural(earlier.length, "earlier source")}${earlier.length ? ` (${earlier.map((e) => e.citation_id).join(", ")})` : ""} travel with this message${c.focus ? `, plus the attached “${c.focus.title}”` : ""}.`;
    },
    try: [],
  },
  prompt: {
    what: "Everything the LLM will read is packed into labelled sections in a fixed order: today's date, a briefing, search sources, the conversation and your question.",
    why: "A fixed order lets the provider reuse the unchanged start of the prompt. Marking sources as untrusted stops text inside a record from acting as instructions.",
    example(ctx) {
      if (!has(ctx)) return "";
      const hits = retrievalOf(ctx).kept;
      const m = messageOf(ctx);
      return `${plural(hits.length, "search source")}${yours(ctx)}, ${plural(m.history.length, "earlier turn")} and your ${num(m.trimmed.length)}-character question go into the prompt.`;
    },
    try: [{ setting: "copilot.limit", value: 1, watch: "The UNTRUSTED_SOURCES section shrinks to one source, and its estimated size drops." }],
  },
  lookups: {
    what: "Before answering, the LLM may ask for more information, such as another search. The server runs it and the LLM writes again.",
    why: `One search may miss things. Lookups let the LLM fill gaps, within limits (${MODEL.maxToolCalls} lookups, ${MODEL.maxRounds} rounds, ${MODEL.deadlineSeconds} seconds) so a reply cannot run forever.`,
    example(ctx) {
      const r = ctx?.copilot?.response;
      if (!r) return "There is no reply yet, so no lookups ran.";
      const steps = r.steps ?? [];
      return steps.length ? `${plural(steps.length, "lookup")} ran: ${steps.map((s) => s.label).join("; ")}.` : "No lookups ran: the LLM answered from the first prompt.";
    },
    try: [],
  },
  answer: {
    what: "The LLM must reply in a fixed JSON shape: the answer text, the sources it used, and any changes it suggests.",
    why: "A fixed shape can be checked by code. An answer that cites sources it was never given is thrown away instead of shown to you.",
    example(ctx) {
      const r = ctx?.copilot?.response;
      if (!r) return "There is no reply yet, so nothing was generated.";
      const cites = r.citations ?? [];
      return `The answer has ${num((r.answer ?? "").length)} characters and cites ${cites.length ? cites.map((c) => `${c.citation_id} “${c.title}”`).join(", ") : "no sources"}.`;
    },
    try: [],
  },
  proposals: {
    what: "Each suggested change becomes a proposal with before and after values. Nothing is written until you confirm.",
    why: "The LLM can be wrong. Confirming keeps you in control, and the revision check stops a change from overwriting an edit made in the meantime.",
    example(ctx) {
      const r = ctx?.copilot?.response;
      if (!r) return "There is no reply yet, so no changes were suggested.";
      const p = (r.proposals ?? [])[0];
      if (!p) return "No changes were suggested.";
      return `Proposal: ${p.operation} “${p.after?.title ?? p.before?.title ?? p.record_id}”. It is written only if the record is still at revision ${p.base_revision}.`;
    },
    try: [],
  },
};

// The illustration steps share their ids with the transformer track. Their
// copilot lessons say plainly that they show how an LLM works in general.
const ILLUSTRATION = {
  bpe: "splits your words into common chunks of letters (tokens)",
  embedding: "turns each token into a list of numbers",
  position: "adds a pattern to each token's numbers so word order is visible",
  qk: "scores how relevant each token is to each other token",
  attention: "turns those scores into percentages, looking only backwards",
  output: "blends each token with the tokens it attends to",
  residual: "adds the input back and rescales the numbers",
  feedforward: "passes each token through a small neural network",
  logits: "scores every known token as the possible next one",
  decode: "picks the next token and repeats",
};

export const COPILOT_MODEL_LESSONS = Object.fromEntries(
  Object.entries(ILLUSTRATION).map(([id, does]) => {
    const t = transformer[id] ?? {};
    return [
      id,
      {
        what: `An illustration of how an LLM works in general: this step ${does}. It runs on your words with small untrained weights, not inside the copilot's real LLM.`,
        why: t.why ?? "Every LLM repeats steps like this one for each token it writes. Seeing the arithmetic on a tiny model shows the idea.",
        example(ctx) {
          try {
            return t.example ? t.example(ctx) : "";
          } catch {
            return "";
          }
        },
        try: t.try ?? [],
      },
    ];
  }),
);

export default copilot;
