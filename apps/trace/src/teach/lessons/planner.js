// Lessons for the planner track, keyed by step id. See ./index.js for the shape.
import { PLANNER_DEFAULTS } from "../../engine/pipeline.js";

const STOP = PLANNER_DEFAULTS.stopWords;
const n3 = (x) => (typeof x === "number" && Number.isFinite(x) ? x.toFixed(3) : String(x));
const quote = (s) => `“${s}”`;
const list = (xs) => (xs.length ? xs.map(quote).join(", ") : "nothing");
const paramsOf = (ctx) => ctx?.trace?.params ?? ctx?.params?.planner ?? PLANNER_DEFAULTS;
const empty = (ctx) => !ctx?.trace?.normalized;
const EMPTY = "Type a request to see this step worked on your own words.";

export default {
  signal: {
    what: "The planner keeps what you typed and makes a tidy copy: lowercase, standard Unicode letters, single spaces, nothing at the ends.",
    why: "Rules can then match “Move” and “move  ” the same way. The original is kept so every token can point back to the exact place you typed it.",
    example(ctx) {
      if (empty(ctx)) return EMPTY;
      const { original, normalized } = ctx.trace;
      return original === normalized
        ? `${quote(original)} was already tidy, so the copy is the same ${normalized.length} characters.`
        : `${quote(original)} becomes ${quote(normalized)}: ${original.length} code units in, ${normalized.length} out.`;
    },
    try: [],
  },
  tokenize: {
    what: "One regular expression cuts the text into tokens: clock times, words, numbers and single symbols. Each word is then labeled a keyword or a stop word.",
    why: "Later steps work on whole words, not letters. Marking filler words like “my” and “to” early keeps them out of the search.",
    example(ctx) {
      const tokens = ctx?.trace?.tokens ?? [];
      if (!tokens.length) return EMPTY;
      const keywords = tokens.filter((t) => t.kind === "keyword").map((t) => t.normalized);
      const stops = tokens.filter((t) => t.kind === "context").map((t) => t.normalized);
      return `Your request has ${tokens.length} tokens. Keywords: ${list(keywords)}. Stop words: ${list(stops)}.`;
    },
    try: [
      {
        setting: "planner.stopWords",
        value: [...STOP, "call"],
        watch: "“call” turns from a keyword into a stop word here, then drops out of the title terms.",
      },
      {
        setting: "planner.stopWords",
        value: STOP.filter((w) => w !== "my"),
        watch: "“my” is no longer filler, so its token becomes a keyword.",
      },
    ],
  },
  parse: {
    what: "Fixed rules read the tidy copy: the first verb gives the intent, patterns find a date and a time, and what is left becomes the title.",
    why: "A reminder needs separate fields. Anything the rules do not recognize stays empty instead of being guessed.",
    example(ctx) {
      const e = ctx?.trace?.entities;
      if (!e || empty(ctx)) return EMPTY;
      const issue = e.issues?.length ? ` It also found a problem: ${e.issues[0]}` : "";
      return `intent = ${e.intent}, date = ${e.date ?? "none"}, time = ${e.time ?? "none"}, title = ${quote(e.title ?? "")}.${issue}`;
    },
    try: [],
  },
  filter: {
    what: "The title is reduced to search terms: stop words, numbers and (by default) month and weekday names are dropped, and aliases map spellings to one term.",
    why: "Only words about the topic should decide which saved reminder you mean. Without the filter, “to” or “friday” would count as evidence.",
    example(ctx) {
      const e = ctx?.trace?.entities;
      if (!e || empty(ctx)) return EMPTY;
      return e.keywords.length
        ? `The title ${quote(e.title)} leaves the terms ${list(e.keywords)}.`
        : `The title ${quote(e.title ?? "")} leaves no search terms, so the planner will ask what the reminder is about.`;
    },
    try: [
      {
        setting: "planner.stopWords",
        value: [...STOP, "advisor"],
        watch: "“advisor” is dropped from the terms, so a call advisor request now searches for “call” alone.",
      },
      {
        setting: "planner.aliases",
        value: { ...PLANNER_DEFAULTS.aliases, professor: "advisor" },
        watch: "Record E “Meet professor” gets the term “advisor”, so it starts scoring for advisor requests in Cosine.",
      },
    ],
  },
  vectorize: {
    what: "Each title becomes a list of numbers, one per distinct term. A term's number is how often it appears (tf) times how rare it is across the saved titles (idf).",
    why: "Rare words say more about which reminder you mean than common ones. The numbers let the next step measure how alike two titles are.",
    example(ctx) {
      const v = ctx?.trace?.vectors;
      if (!v?.dimensions?.length) return "No terms reached this step, so every vector is empty.";
      const p = paramsOf(ctx);
      const N = v.documents.length;
      const d = [...v.dimensions].sort((a, b) => b.idf - a.idf || a.term.localeCompare(b.term))[0];
      const rule = !p.useIdf
        ? "IDF is off, so idf = 1"
        : p.smoothIdf
          ? `idf = ln((${N} + 1) / (${d.df} + 1)) + 1 = ${n3(d.idf)}`
          : `idf = ln(${N} / ${Math.max(d.df, 1)}) + 1 = ${n3(d.idf)}`;
      return `${v.dimensions.length} terms give ${v.dimensions.length} columns. The rarest, ${quote(d.term)}, is in ${d.df} of ${N} titles: ${rule}.`;
    },
    try: [
      {
        setting: "planner.useIdf",
        value: false,
        watch: "Every idf becomes 1, so common and rare terms weigh the same and the scores in Cosine shift.",
      },
      {
        setting: "planner.smoothIdf",
        value: false,
        watch: "idf switches to ln(N / df) + 1: a term found in every title drops to exactly 1, rare terms rise.",
      },
    ],
  },
  retrieve: {
    what: "Your request's numbers are compared with each saved reminder's numbers. The score is the cosine of the angle between them: 1 is the same direction, 0 means no shared term.",
    why: "It ranks records by meaning overlap without caring how long a title is. Records above the match threshold become candidates.",
    example(ctx) {
      const t = ctx?.trace;
      const top = t?.vectors?.results?.[0];
      if (!top) return "There are no saved records to compare with.";
      const p = paramsOf(ctx);
      const c = t.candidates ?? [];
      return `Best match: ${top.record.id} ${quote(top.record.title)} at ${n3(top.score)}. ${
        c.length ? `${c.length} record${c.length === 1 ? " scores" : "s score"} above ${p.matchThreshold}: ${c.join(", ")}.` : `No record scores above ${p.matchThreshold}.`
      }`;
    },
    try: [
      {
        setting: "planner.matchThreshold",
        value: 0.9,
        watch: "Records scoring 0.9 or less lose their candidate mark; a search for “GDP report” (0.816) then finds nothing.",
      },
      {
        setting: "planner.matchThreshold",
        value: 0,
        watch: "Any record that shares one term with your request becomes a candidate.",
      },
    ],
  },
  decide: {
    what: "A checklist runs top to bottom. The first rule that is true decides: ask you a question, answer a search, or prepare a change.",
    why: "The order matters: a missing title is reported before a tie, and nothing is ever written in this step.",
    example(ctx) {
      const t = ctx?.trace;
      if (!t?.decision) return EMPTY;
      const fired = t.rules.findIndex((r) => r.hit);
      const gap = t.gap === null || t.gap === undefined ? "" : ` The gap between the top two scores is ${n3(t.gap)} (tie gap ${paramsOf(ctx).tieGap}).`;
      return `Rule ${fired + 1}, ${t.rules[fired]?.id}, fires: ${t.decision.message}${gap}`;
    },
    try: [
      {
        setting: "planner.tieGap",
        value: 0,
        watch: "Two exactly equal scores no longer count as a tie, so “Move my call advisor reminder…” stops asking and picks A.",
      },
      {
        setting: "planner.matchThreshold",
        value: 1,
        watch: "No score can be above 1, so a move or delete hits the no-match rule and asks again.",
      },
    ],
  },
  respond: {
    what: "A proposal is written only after you confirm it, and only if the record still has the revision you previewed.",
    why: "If someone else changed the reminder in between, writing would overwrite their change. The revision check refuses instead.",
    example(ctx) {
      const t = ctx?.trace;
      const p = t?.decision?.proposal;
      if (!p) return `Decide returned ${t?.decision?.status ?? "no decision"}, not a proposal, so nothing is written.`;
      if (p.intent === "create") return `Confirming adds ${p.dates.length} new record${p.dates.length === 1 ? "" : "s"} titled ${quote(p.title)}.`;
      return `Confirming ${p.intent === "delete" ? "deletes" : "updates"} ${p.targetId}, but only if its revision is still ${p.expectedRevision}.`;
    },
    try: [],
  },
};
