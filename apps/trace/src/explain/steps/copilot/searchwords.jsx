import { Panel, Table, Tag } from "../../kit.jsx";
import { tokenSteps } from "../../../engine/copilot.js";
import { row, tableBlock } from "../../../map/blocks.js";
import { messageOf, paramsOf, plural, tunedKeys, whatIfNote } from "./util.js";

// The query's words with the stop list in force. `stop` answers per word.
const words = (ctx) => {
  const p = paramsOf(ctx);
  const s = tokenSteps(messageOf(ctx).query, p);
  const set = new Set(p.stopwords);
  return { ...s, stop: (w) => set.has(w), count: set.size, custom: tunedKeys(ctx).includes("stopwords") };
};
const listName = (s) => (s.custom ? `your ${plural(s.count, "stopword")}` : `the server's ${s.count} stopwords`);

export default {
  id: "searchwords",
  source: [["copilot", "casefold"], ["copilot", "tokenSteps"]],
  code: [
    "const folded = casefold(query)",
    "const words = folded.match(/[a-z0-9]+/g) ?? []",
    "for (const w of words)",
    "  if (p.stopwords.has(w)) dropped.push(w)",
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
        line: s.stop(w) ? [2, 3] : [2, 4],
        say: s.stop(w)
          ? `“${w}” is one of ${listName(s)}, so it is dropped.`
          : `“${w}” is not in ${listName(s)}, so it is kept as a search word.`,
        vars: { w, stopword: s.stop(w) },
        at: i,
        hold: 0.7,
      }),
    );
    frames.push({
      phase: "Done",
      line: 5,
      say: (s.kept.length
        ? `${s.kept.length} search word${s.kept.length === 1 ? "" : "s"}: ${s.kept.join(", ")}. ${s.dropped.length} filler word${s.dropped.length === 1 ? "" : "s"} dropped.`
        : "Every word was a stopword, so the search is skipped entirely.") + whatIfNote(ctx, "searchwords"),
      vars: { kept: s.kept, "stopwords.size": s.count },
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
          { text: w, tone: s.stop(w) ? "context" : "keyword" },
          s.stop(w) ? "yes" : "no",
          { text: s.stop(w) ? "drop" : "keep", tone: s.stop(w) ? "muted" : "good" },
        ]),
        explain: (r, c) => {
          const w = s.words[r];
          if (w === undefined) return null;
          const stop = s.stop(w);
          return [
            { meaning: `Word ${r} of the query, counting from 0.`, formula: "words = casefold(query).match(/[a-z0-9]+/g)", worked: `words[${r}] = “${w}”` },
            { meaning: "A run of letters a–z and digits 0–9, after lowercasing. Anything else separates words.", formula: "/[a-z0-9]+/g", worked: `“${w}” matched` },
            { meaning: `Whether the word is in ${listName(s)}.`, formula: "stopwords.has(word)", worked: `stopwords.has(“${w}”) = ${stop}` },
            { meaning: stop ? "Filler words are dropped before hashing." : "Words that are not filler become search words.", formula: "stopword ? drop : keep", worked: `${stop} → ${stop ? "drop" : "keep"}` },
          ][c];
        },
      }),
      tableBlock({
        id: "ctokens",
        title: "search words",
        head: ["#", "word"],
        widths: [0.5, 1.8],
        rows: s.kept.map((w, i) => [{ text: String(i), dim: true }, { text: w, tone: "keyword" }]),
        beside: true,
        explain: (r) => {
          const w = s.kept[r];
          if (w === undefined) return null;
          return {
            meaning: "A search word: what the next step hashes into the vector.",
            formula: "kept = words.filter((w) => !stopwords.has(w))",
            worked: `kept[${r}] = “${w}” (word ${s.words.indexOf(w)} of the query)`,
          };
        },
      }),
    ];
  },
  output: "ctokens",
  state(frame, ctx) {
    const s = words(ctx);
    const keptBefore = s.words.slice(0, frame.at + 1).filter((w) => !s.stop(w)).length;
    const current = s.words[frame.at];
    return {
      cwords: { done: (r) => r <= frame.at, active: current !== undefined ? row(frame.at, 4) : [] },
      ctokens: {
        done: (r) => r < keptBefore,
        active: current !== undefined && !s.stop(current) ? row(keptBefore - 1, 2) : [],
      },
    };
  },
  math(frame, ctx) {
    const s = words(ctx);
    const w = s.words[frame.at];
    if (w === undefined) return [];
    return [{ label: "stopwords.has", terms: [`“${w}”`], op: "", result: `${s.stop(w)} → ${s.stop(w) ? "drop" : "keep"}` }];
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
              ? [i, <code key="w">{w}</code>, <Tag key="t" kind={s.stop(w) ? "dropped" : "kept"}>{s.stop(w) ? "dropped" : "kept"}</Tag>]
              : { cls: "is-pending", cells: [i, "", ""] },
          )}
        />
      </Panel>
    );
  },
};
