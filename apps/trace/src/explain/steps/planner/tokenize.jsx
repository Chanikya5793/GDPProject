import { Chars, Panel, Table, Tag } from "../../kit.jsx";
import { TOKEN_PATTERNS } from "../../../engine/pipeline.js";
import { charGrid, row, tableBlock } from "../../../map/blocks.js";

const KIND_LINE = { number: 5, context: 6, keyword: 6, punctuation: 7 };
const RULE_NOTE = {
  clock: "two digits, a colon, two digits",
  word: "letters (and combining marks), optionally with an apostrophe part",
  number: "one or more digits",
  symbol: "any single character that is not whitespace",
};

function reason(t) {
  if (t.kind === "number") return "it starts with a digit → number";
  if (t.kind === "punctuation") return "it starts with neither a digit nor a letter → punctuation";
  return t.kind === "context"
    ? `it starts with a letter and “${t.normalized}” is in the stop-word list → context`
    : `it starts with a letter and “${t.normalized}” is not a stop word → keyword`;
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
    "  else if (/^\\p{L}/u.test(normalized)) kind = STOP_WORDS.has(normalized) ? \"context\" : \"keyword\"",
    "  else kind = \"punctuation\"",
    "  tokens.push({ id, text: m[0], normalized, start, end, kind })",
    "}",
  ],
  frames({ trace }) {
    const text = trace.original;
    const frames = [
      {
        phase: "Setup",
        line: 0,
        say: `The tokenizer is one regular expression with four alternatives. At each position the engine tries them left to right and keeps the first that matches. The input has ${text.length} UTF-16 code units.`,
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
        say: `normalize(“${t.text}”) = “${t.normalized}”. ${reason(t)[0].toUpperCase()}${reason(t).slice(1)}. Push token ${i}.`,
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
  blocks({ trace }) {
    return [
      tableBlock({
        id: "patterns",
        title: "TOKEN_RE alternatives, tried in order",
        head: ["name", "pattern"],
        widths: [1, 3.4],
        rows: TOKEN_PATTERNS.map((p) => [p.name, { text: p.source, align: "left" }]),
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
                terms: [`STOP_WORDS.has(“${t.normalized}”)`],
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
