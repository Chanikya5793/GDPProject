import { Chars, Panel, Table, Tag } from "../../kit.jsx";
import { PLANNER_DEFAULTS, TOKEN_PATTERNS } from "../../../engine/pipeline.js";
import { charGrid, row, tableBlock } from "../../../map/blocks.js";
import { isDefault, paramsOf } from "./util.js";

const KIND_LINE = { number: 5, context: 6, keyword: 6, punctuation: 7 };
const RULE_NOTE = {
  clock: "two digits, a colon, two digits",
  word: "letters (and combining marks), optionally with an apostrophe part",
  number: "one or more digits",
  symbol: "any single character that is not whitespace",
};

function reason(t, p) {
  if (t.kind === "number") return "it starts with a digit → number";
  if (t.kind === "punctuation") return "it starts with neither a digit nor a letter → punctuation";
  const list = isDefault(p, "stopWords") ? "the stop-word list" : "your stop-word list";
  return t.kind === "context"
    ? `it starts with a letter and “${t.normalized}” is in ${list} → context`
    : `it starts with a letter and “${t.normalized}” is not in ${list} → keyword`;
}

// One sentence on how the stop-word setting differs from the default, or "".
function stopSay(p) {
  if (isDefault(p, "stopWords")) return "";
  const def = new Set(PLANNER_DEFAULTS.stopWords);
  const added = p.stopWords.filter((w) => !def.has(w));
  return ` Your stop-word list has ${p.stopWords.length} words${
    added.length ? `, including ${added.slice(0, 4).map((w) => `“${w}”`).join(", ")}` : ""
  } (the default has ${def.size}).`;
}

// ---- Explain a cell ----

function explainPattern(trace, r) {
  const x = TOKEN_PATTERNS[r];
  if (!x) return null;
  const used = trace.tokens.filter((t) => t.rule === x.name);
  return {
    meaning: `Alternative ${r + 1}, “${x.name}”: ${RULE_NOTE[x.name]}. It is tried only where the alternatives above it did not match.`,
    formula: `/${x.source}/`,
    worked: used.length
      ? `matched ${used.length} time${used.length === 1 ? "" : "s"}: ${used.slice(0, 6).map((t) => `“${t.text}”`).join(", ")}${used.length > 6 ? ", …" : ""}`
      : "matched nothing in this request",
  };
}

function explainToken(t, p, c) {
  if (!t) return null;
  switch (c) {
    case 0:
      return { meaning: `Token number ${t.id}, counting from 0 in the order the scan found them.` };
    case 1:
      return {
        meaning: "The exact characters the regular expression matched in what you typed.",
        formula: "text = original.slice(start, end)",
        worked: `original.slice(${t.start}, ${t.end}) = “${t.text}”`,
      };
    case 2:
      return {
        meaning: "Where the token sits in the original text, counted in UTF-16 code units. The end is not included.",
        formula: "end = start + text.length",
        worked: `${t.start} + ${t.text.length} = ${t.end}`,
      };
    case 3:
      return {
        meaning:
          t.kind === "context"
            ? `“${t.normalized}” is filler: a stop word that says nothing about the topic.`
            : t.kind === "keyword"
              ? `“${t.normalized}” is a keyword: a word that may say what the reminder is about.`
              : `“${t.normalized}” is ${t.kind === "number" ? "a number" : "punctuation"}.`,
        formula: "digit first → number; letter first → context if a stop word, else keyword; otherwise punctuation",
        worked: reason(t, p),
      };
    case 4:
      return {
        meaning: `The alternative of the token regular expression that matched: ${RULE_NOTE[t.rule]}.`,
        formula: "first alternative that matches wins: clock | word | number | symbol",
        worked: `at offset ${t.start}, “${t.rule}” matched “${t.text}”`,
      };
    default:
      return null;
  }
}

export default {
  id: "tokenize",
  source: [
    ["pipeline", "TOKEN_PATTERNS"],
    ["pipeline", "tokenize"],
  ],
  code: [
    "const TOKEN_RE = /(clock)|(word)|(number)|(symbol)/gu",
    "for (const m of text.matchAll(TOKEN_RE)) {   // whitespace matches nothing, so it is skipped",
    "  const start = m.index, end = start + m[0].length",
    "  const normalized = normalize(m[0])",
    "  let kind",
    "  if (/^\\d/.test(normalized)) kind = \"number\"",
    "  else if (/^\\p{L}/u.test(normalized)) kind = stopWords.has(normalized) ? \"context\" : \"keyword\"   // a setting",
    "  else kind = \"punctuation\"",
    "  tokens.push({ id, text: m[0], normalized, start, end, kind })",
    "}",
  ],
  frames(ctx) {
    const { trace } = ctx;
    const p = paramsOf(ctx);
    const text = trace.original;
    const frames = [
      {
        phase: "Setup",
        line: 0,
        say: `The tokenizer is one regular expression with four alternatives. At each position the engine tries them left to right and keeps the first that matches. The input has ${text.length} UTF-16 code units.${stopSay(p)}`,
        vars: { text, "text.length": text.length },
        tok: -1,
        offset: 0,
      },
    ];
    let previousEnd = 0;
    trace.tokens.forEach((t, i) => {
      const gap = t.start - previousEnd;
      frames.push({
        phase: "Scan",
        line: [1, 2],
        say: `${gap ? `Skip ${gap} whitespace character${gap > 1 ? "s" : ""} (no alternative matches a space). ` : ""}At offset ${t.start} the ${t.rule} alternative matches “${t.text}”, so start = ${t.start} and end = ${t.end}.`,
        vars: { "m.index": t.start, alternative: t.rule, "m[0]": t.text, start: t.start, end: t.end },
        tok: i,
        emitted: false,
        offset: t.start,
        rule: t.rule,
      });
      frames.push({
        phase: "Scan",
        line: [3, KIND_LINE[t.kind], 8],
        say: `normalize(“${t.text}”) = “${t.normalized}”. ${reason(t, p)[0].toUpperCase()}${reason(t, p).slice(1)}. Push token ${i}.`,
        vars: {
          "m[0]": t.text,
          normalized: t.normalized,
          kind: t.kind,
          "tokens.length": i + 1,
        },
        tok: i,
        emitted: true,
        offset: t.start,
        rule: t.rule,
      });
      previousEnd = t.end;
    });
    const count = (k) => trace.tokens.filter((t) => t.kind === k).length;
    frames.push({
      phase: "Done",
      line: 9,
      say: `The scan reached the end. ${trace.tokens.length} tokens: ${count("keyword")} keywords, ${count("context")} stop words, ${count("number")} numbers, ${count("punctuation")} punctuation. Every token's text equals original.slice(start, end).`,
      vars: { "tokens.length": trace.tokens.length },
      tok: trace.tokens.length,
      emitted: true,
      offset: text.length,
    });
    return frames;
  },
  blocks(ctx) {
    const { trace } = ctx;
    const p = paramsOf(ctx);
    return [
      tableBlock({
        id: "patterns",
        title: "TOKEN_RE alternatives, tried in order",
        head: ["name", "pattern"],
        widths: [1, 3.4],
        rows: TOKEN_PATTERNS.map((x) => [x.name, { text: x.source, align: "left" }]),
        explain: (r) => explainPattern(trace, r),
      }),
      tableBlock({
        id: "tokens",
        title: "tokens",
        head: ["#", "text", "[start, end)", "kind", "alternative"],
        widths: [0.5, 1.5, 1.25, 1.25, 1.05],
        rows: trace.tokens.map((t) => [
          { text: String(t.id), dim: true },
          { text: t.text, tone: t.kind },
          `[${t.start}, ${t.end})`,
          { text: t.kind, tone: t.kind },
          t.rule,
        ]),
        explain: (r, c) => explainToken(trace.tokens[r], p, c),
      }),
    ];
  },
  output: "tokens",
  state(frame, { trace }) {
    const t = trace.tokens[frame.tok];
    const done = (r) => r < frame.tok || (r === frame.tok && frame.emitted);
    return {
      patterns: {
        active: t && !frame.emitted ? row(TOKEN_PATTERNS.findIndex((p) => p.name === t.rule), 2) : [],
      },
      tokens: { done, active: t ? row(frame.tok, 5) : [] },
      original: { source: t ? charGrid(trace.original).span(t.start, t.end) : [] },
    };
  },
  math(frame, { trace }) {
    const t = trace.tokens[frame.tok];
    if (!t) return [];
    const lines = [
      { label: "m.index", terms: [`${t.start}`], result: `end = ${t.start} + ${t.text.length} = ${t.end}` },
      { label: "m[0]", terms: [`original.slice(${t.start}, ${t.end})`], result: `“${t.text}”` },
    ];
    if (frame.emitted)
      lines.push(
        { label: "normalize", terms: [`“${t.text}”`], op: "→", result: `“${t.normalized}”` },
        t.kind === "number"
          ? { label: "kind", terms: [`/^\\d/.test(“${t.normalized}”)`], result: "true → number" }
          : t.kind === "punctuation"
            ? { label: "kind", terms: ["starts with a digit or a letter?"], result: "no → punctuation" }
            : {
                label: "kind",
                terms: [`stopWords.has(“${t.normalized}”)`],
                result: `${t.kind === "context"} → ${t.kind}`,
              },
      );
    return lines;
  },
  Stage({ ctx, frame, frames, seek }) {
    const { trace } = ctx;
    const done = (i) => i < frame.tok || (i === frame.tok && frame.emitted);
    const spans = trace.tokens
      .filter((t, i) => done(i) || i === frame.tok)
      .map((t) => ({
        start: t.start,
        end: t.end,
        cls: t.id === frame.tok ? "active" : t.kind,
      }));
    const used = (name) =>
      trace.tokens.filter((t, i) => done(i) && t.rule === name).length;
    const goTo = (i) => seek(frames.findIndex((f) => f.tok === i && f.emitted));
    return (
      <div className="x-stack">
        <Panel title="Original text" note="Each box is one UTF-16 code unit with its offset. Colored runs are tokens found so far.">
          <Chars
            text={trace.original}
            spans={spans}
            cursor={frame.offset}
            onChar={(o) => {
              const i = trace.tokens.findIndex((t) => o >= t.start && o < t.end);
              if (i >= 0) goTo(i);
            }}
          />
        </Panel>
        <Panel title="The four alternatives, in order">
          <Table
            head={["Alternative", "Pattern", "Matches", "Used"]}
            rows={TOKEN_PATTERNS.map((p) => ({
              cls: frame.rule === p.name && !frame.emitted ? "is-active" : "",
              cells: [
                <strong key="n">{p.name}</strong>,
                <code key="p">{p.source}</code>,
                RULE_NOTE[p.name],
                used(p.name),
              ],
            }))}
          />
        </Panel>
        <Panel title={`Tokens (${trace.tokens.filter((_, i) => done(i)).length} of ${trace.tokens.length})`}>
          <Table
            head={["#", "text", "[start, end)", "normalized", "kind", "alternative"]}
            active={frame.tok}
            onRow={goTo}
            rows={trace.tokens.map((t, i) =>
              done(i) || i === frame.tok
                ? [
                    i,
                    <code key="t">{t.text}</code>,
                    <code key="r">
                      [{t.start}, {t.end})
                    </code>,
                    done(i) ? <code key="n">{t.normalized}</code> : "…",
                    done(i) ? <Tag key="k" kind={t.kind}>{t.kind}</Tag> : "…",
                    t.rule,
                  ]
                : { cls: "is-pending", cells: [i, "", "", "", "", ""] },
            )}
          />
        </Panel>
      </div>
    );
  },
};
