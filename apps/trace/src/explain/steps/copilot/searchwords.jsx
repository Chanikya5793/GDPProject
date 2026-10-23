import { Panel, Table, Tag } from "../../kit.jsx";
import { QUERY_CHARS, STOPWORDS, tokenSteps } from "../../../engine/copilot.js";
import { row, tableBlock } from "../../../map/blocks.js";

const words = (ctx) => tokenSteps(ctx.copilot.message.trim().slice(0, QUERY_CHARS));

export default {
  id: "searchwords",
  source: [["copilot", "casefold"], ["copilot", "tokenSteps"]],
  code: [
    "const folded = casefold(query)",
    "const words = folded.match(/[a-z0-9]+/g) ?? []",
    "for (const w of words)",
    "  if (STOPWORDS.has(w)) dropped.push(w)",
    "  else kept.push(w)",
    "return kept",
  ],
  frames(ctx) {
    const s = words(ctx);
    const frames = [
      {
        phase: "Fold",
        line: 0,
        say: `Lowercase the query (Python's casefold): “${s.folded.slice(0, 80)}${s.folded.length > 80 ? "…" : ""}”.`,
        vars: { "query.length": s.folded.length },
        at: -1,
      },
      {
        phase: "Split",
        line: 1,
        say: `Keep every run of letters a–z and digits 0–9. Everything else, including accents and punctuation, separates words. That gives ${s.words.length} word${s.words.length === 1 ? "" : "s"}.`,
        vars: { "words.length": s.words.length },
        at: -1,
      },
    ];
    s.words.forEach((w, i) =>
      frames.push({
        phase: "Filter",
        line: STOPWORDS.has(w) ? [2, 3] : [2, 4],
        say: STOPWORDS.has(w)
          ? `“${w}” is one of the 32 stopwords, so it is dropped.`
          : `“${w}” is not a stopword, so it is kept as a search word.`,
        vars: { w, stopword: STOPWORDS.has(w) },
        at: i,
        hold: 0.7,
      }),
    );
    frames.push({
      phase: "Done",
      line: 5,
      say: s.kept.length
        ? `${s.kept.length} search word${s.kept.length === 1 ? "" : "s"}: ${s.kept.join(", ")}. ${s.dropped.length} filler word${s.dropped.length === 1 ? "" : "s"} dropped.`
        : "Every word was a stopword, so the server skips the search entirely.",
      vars: { kept: s.kept },
      at: s.words.length,
    });
    return frames;
  },
  blocks(ctx) {
    const s = words(ctx);
    return [
      tableBlock({
        id: "cwords",
        title: "words = casefold(query).match(/[a-z0-9]+/g)",
        head: ["#", "word", "stopword?", "result"],
        widths: [0.5, 1.6, 1.1, 1],
        rows: s.words.map((w, i) => [
          { text: String(i), dim: true },
          { text: w, tone: STOPWORDS.has(w) ? "context" : "keyword" },
          STOPWORDS.has(w) ? "yes" : "no",
          { text: STOPWORDS.has(w) ? "drop" : "keep", tone: STOPWORDS.has(w) ? "muted" : "good" },
        ]),
      }),
      tableBlock({
        id: "ctokens",
        title: "search words",
        head: ["#", "word"],
        widths: [0.5, 1.8],
        rows: s.kept.map((w, i) => [{ text: String(i), dim: true }, { text: w, tone: "keyword" }]),
        beside: true,
      }),
    ];
  },
  output: "ctokens",
  state(frame, ctx) {
    const s = words(ctx);
    const keptBefore = s.words.slice(0, frame.at + 1).filter((w) => !STOPWORDS.has(w)).length;
    const current = s.words[frame.at];
    return {
      cwords: { done: (r) => r <= frame.at, active: current !== undefined ? row(frame.at, 4) : [] },
      ctokens: {
        done: (r) => r < keptBefore,
        active: current !== undefined && !STOPWORDS.has(current) ? row(keptBefore - 1, 2) : [],
      },
    };
  },
  math(frame, ctx) {
    const w = words(ctx).words[frame.at];
    if (w === undefined) return [];
    return [{ label: "STOPWORDS.has", terms: [`“${w}”`], op: "", result: `${STOPWORDS.has(w)} → ${STOPWORDS.has(w) ? "drop" : "keep"}` }];
  },
  Stage({ ctx, frame }) {
    const s = words(ctx);
    return (
      <Panel title="Words">
        <Table
          head={["#", "word", "result"]}
          active={frame.at}
          rows={s.words.map((w, i) =>
            i <= frame.at
              ? [i, <code key="w">{w}</code>, <Tag key="t" kind={STOPWORDS.has(w) ? "dropped" : "kept"}>{STOPWORDS.has(w) ? "dropped" : "kept"}</Tag>]
              : { cls: "is-pending", cells: [i, "", ""] },
          )}
        />
      </Panel>
    );
  },
};
