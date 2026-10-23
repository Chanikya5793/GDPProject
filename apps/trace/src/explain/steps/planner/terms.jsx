import { Chars, Panel, Table, Tag } from "../../kit.jsx";
import { ALIASES, DAYS, MONTHS, STOP_WORDS, normalize, termSteps, tokenize } from "../../../engine/pipeline.js";
import { indexed, plural, revealState, slotRow } from "./util.js";
import { tableBlock } from "../../../map/blocks.js";

const REASON_LINE = { "stop word": 2, number: 3, punctuation: 4, "month name": 5, "weekday name": 6 };
const CHECK = {
  "stop word": "STOP_WORDS.has(token)",
  number: "starts with a digit",
  punctuation: "starts with neither a letter nor a digit",
  "month name": "MONTHS.includes(token)",
  "weekday name": "DAYS.includes(token)",
};

function reasonSay(s) {
  switch (s.reason) {
    case "stop word":
      return `“${s.token}” is in STOP_WORDS, so the tokenizer already marked it as context. Dropped: it carries no topic.`;
    case "number":
      return `“${s.token}” starts with a digit, so its kind is number. Dropped: numbers in a title are not matched.`;
    case "punctuation":
      return `“${s.token}” starts with neither a letter nor a digit, so its kind is punctuation. Dropped.`;
    case "month name":
      return `“${s.token}” is a keyword, but MONTHS includes it. Dropped: dates were already read in Extract.`;
    case "weekday name":
      return `“${s.token}” is a keyword, but DAYS includes it. Dropped: dates were already read in Extract.`;
    default:
      return `“${s.token}”: kind is keyword (starts with a letter, not in STOP_WORDS), not in MONTHS, not in DAYS, so it is kept. ${
        s.aliased ? `ALIASES maps “${s.token}” → “${s.term}”, so term = “${s.term}”.` : `ALIASES has no entry for it, so term = “${s.term}”.`
      }`;
  }
}

const mod = {
  id: "filter",
  source: [
    ["pipeline", "STOP_WORDS"],
    ["pipeline", "ALIASES"],
    ["pipeline", "termSteps"],
    ["pipeline", "terms"],
  ],
  code: [
    "function termSteps(title) {",
    "  return tokenize(normalize(title)).map(t => {",
    '    if (t.kind === "context") reason = "stop word"        // STOP_WORDS.has(t.normalized)',
    '    else if (t.kind === "number") reason = "number"',
    '    else if (t.kind === "punctuation") reason = "punctuation"',
    '    else if (MONTHS.includes(t.normalized)) reason = "month name"',
    '    else if (DAYS.includes(t.normalized)) reason = "weekday name"',
    "    else reason = null                                     // a keyword: keep it",
    "    const term = reason ? null : ALIASES[t.normalized] || t.normalized",
    "    return { token: t.normalized, kept: !reason, reason, term }",
    "  })",
    "}",
    "const terms = termSteps(title).filter(s => s.kept).map(s => s.term)",
  ],
  frames({ trace }) {
    const title = trace.entities.title ?? "";
    const steps = termSteps(title);
    const traceTokens = trace.tokens.map((t) => t.normalized);
    if (!steps.length)
      return [
        {
          phase: "Done",
          line: [1, 12],
          say: title
            ? `The title “${title}” has no tokens, so terms = []. Decide’s title rule will ask what the reminder is about.`
            : "The title is empty, so tokenize returns no tokens and terms = []. Decide’s title rule will ask what the reminder is about.",
          vars: { title, "terms.length": 0 },
          at: 0,
          traceTokens,
        },
      ];
    const frames = [
      {
        phase: "Setup",
        line: [0, 1],
        say: `The title from Extract is “${title}”. tokenize(normalize(title)) splits it into ${plural(steps.length, "token")}: ${steps.map((s) => `“${s.token}”`).join(", ")}. Each one is checked in the order of the if/else chain.`,
        vars: { title, "tokens.length": steps.length, terms: [] },
        at: -1,
        traceTokens,
      },
    ];
    const terms = [];
    steps.forEach((s, i) => {
      if (s.kept) terms.push(s.term);
      frames.push({
        phase: "Filter",
        line: s.kept ? [7, 8, 9] : [REASON_LINE[s.reason], 9],
        say: `Token ${i}: ${reasonSay(s)}`,
        vars: {
          token: s.token,
          kind: s.kind,
          reason: s.reason,
          kept: s.kept,
          term: s.term,
          terms: [...terms],
        },
        at: i,
        token: s.token,
        hold: steps.length > 8 ? 0.8 : 1,
      });
    });
    const k = trace.entities.keywords;
    const dropped = steps.length - k.length;
    frames.push({
      phase: "Done",
      line: 12,
      say: `terms = [${k.join(", ")}]: ${plural(k.length, "term")} kept, ${dropped} dropped. These are entities.keywords, the query terms for TF–IDF.${
        new Set(k).size < k.length ? " A repeated term stays repeated, so its tf in the query is above 1." : ""
      }`,
      vars: { "terms.length": k.length, terms: k },
      at: steps.length,
    });
    return frames;
  },
  Stage({ ctx, frame, frames, seek }) {
    const title = ctx.trace.entities.title ?? "";
    const text = normalize(title);
    const steps = termSteps(title);
    const toks = tokenize(text);
    const done = (i) => i < frame.at || (i === frame.at && frame.phase !== "Filter") || frame.phase === "Done";
    const spans = toks
      .map((t, i) => ({
        start: t.start,
        end: t.end,
        cls: i === frame.at && frame.phase === "Filter" ? "active" : steps[i]?.kept ? "keyword" : "removed",
        show: done(i) || i === frame.at,
      }))
      .filter((s) => s.show);
    const cur = frame.phase === "Filter" ? steps[frame.at] : null;
    const terms = steps.filter((s, i) => s.kept && (done(i) || i === frame.at)).map((s) => s.term);
    const goTo = (i) => seek(frames.findIndex((f) => f.phase === "Filter" && f.at === i));
    return (
      <div className="x-stack">
        <Panel title="title" note="Tinted runs are kept, struck-out runs are dropped. Click a token to jump to it.">
          {text ? (
            <Chars
              text={text}
              spans={spans}
              onChar={(o) => {
                const i = toks.findIndex((t) => o >= t.start && o < t.end);
                if (i >= 0) goTo(i);
              }}
            />
          ) : (
            <p className="p-empty">(empty title)</p>
          )}
        </Panel>
        {steps.length > 0 && (
          <Panel title={`Tokens (${Math.min(steps.length, Math.max(0, frame.at + 1))} of ${steps.length} checked)`}>
            <Table className="p-table"
              head={["#", "token", "kind", "deciding check", "result", "term"]}
              active={frame.phase === "Filter" ? frame.at : undefined}
              onRow={goTo}
              rows={steps.map((s, i) =>
                done(i) || i === frame.at
                  ? [
                      i,
                      <code key="t">{s.token}</code>,
                      <Tag key="k" kind={s.kind}>{s.kind}</Tag>,
                      s.kept ? "none of the five" : <code key="c">{CHECK[s.reason]}</code>,
                      s.kept ? <Tag key="r" kind="kept">kept</Tag> : <Tag key="r" kind="dropped">{s.reason}</Tag>,
                      s.kept ? (
                        <code key="m">
                          {s.aliased ? `${s.token} → ${s.term}` : s.term}
                        </code>
                      ) : (
                        "—"
                      ),
                    ]
                  : { cls: "is-pending", cells: [i, <code key="t">{s.token}</code>, "", "", "", ""] },
              )}
            />
          </Panel>
        )}
        <Panel title="Lookup lists" note="The current token is highlighted wherever it appears.">
          <div className="p-lists">
            <div>
              <span>STOP_WORDS ({STOP_WORDS.size})</span>
              <div className="p-chips">
                {[...STOP_WORDS].map((w) => (
                  <span key={w} className={`p-chip ${cur?.token === w ? "is-hit" : "is-dim"}`}>
                    {w}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <span>MONTHS</span>
              <div className="p-chips">
                {MONTHS.map((w) => (
                  <span key={w} className={`p-chip ${cur?.token === w ? "is-hit" : "is-dim"}`}>
                    {w}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <span>DAYS</span>
              <div className="p-chips">
                {DAYS.map((w) => (
                  <span key={w} className={`p-chip ${cur?.token === w ? "is-hit" : "is-dim"}`}>
                    {w}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <span>ALIASES</span>
              <div className="p-chips">
                {Object.entries(ALIASES).map(([from, to]) => (
                  <span key={from} className={`p-chip ${cur?.token === from ? "is-hit" : "is-dim"}`}>
                    {from} → {to}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Panel>
        <Panel title={`terms (${terms.length})`}>
          {terms.length ? (
            <div className="p-chips">
              {terms.map((t, i) => (
                <span key={i} className="p-chip is-kept">
                  <small>{i}</small>
                  {t}
                </span>
              ))}
            </div>
          ) : (
            <p className="p-empty">[]</p>
          )}
        </Panel>
      </div>
    );
  },
};

// ---- Map layer ----

const SHORT_CHECK = {
  "stop word": "in STOP_WORDS",
  number: "starts with a digit",
  punctuation: "not a letter or digit",
  "month name": "in MONTHS",
  "weekday name": "in DAYS",
};
// Index of each kept step among the terms.
const keptIndex = (steps) => {
  let k = 0;
  return steps.map((x) => (x.kept ? k++ : -1));
};

function cellsOf(frame, { trace }) {
  const steps = termSteps(trace.entities.title ?? "");
  const kept = keptIndex(steps);
  const titleSlot = [[slotRow("title"), 1]];
  if (frame.phase === "Setup") return { slots: { source: titleSlot }, titletokens: { active: steps.map((_, i) => [i, 0]) } };
  if (frame.phase === "Filter") {
    const i = frame.at;
    return {
      titletokens: { source: [[i, 0]], active: [[i, 1], [i, 2], [i, 3]] },
      ...(kept[i] >= 0 ? { terms: { active: [[kept[i], 0], [kept[i], 1]] } } : {}),
    };
  }
  if (!steps.length) return { slots: { source: titleSlot }, terms: { active: [[0, 1]] } };
  return {
    titletokens: { source: steps.map((x, i) => (x.kept ? [i, 3] : null)).filter(Boolean) },
    terms: { active: trace.entities.keywords.map((_, k) => [k, 1]) },
  };
}

Object.assign(mod, {
  blocks({ trace }) {
    const steps = termSteps(trace.entities.title ?? "");
    const k = trace.entities.keywords;
    return [
      tableBlock({
        id: "titletokens",
        title: "title tokens · keep or drop",
        head: ["token", "kind", "deciding check", "result"],
        widths: [1.5, 1.15, 2.3, 1.5],
        rows: steps.length
          ? steps.map((x) => [
              { text: x.token, tone: x.kind },
              { text: x.kind, tone: x.kind },
              x.kept ? { text: "none of the five", tone: "muted" } : { text: SHORT_CHECK[x.reason], align: "left" },
              x.kept ? { text: "kept", tone: "good", bold: true } : { text: x.reason, tone: "warn" },
            ])
          : [[{ text: "(no tokens)", tone: "muted" }, "", "", ""]],
      }),
      tableBlock({
        id: "terms",
        title: "terms (query)",
        head: ["#", "term"],
        widths: [0.45, 2],
        rows: k.length
          ? k.map((t, i) => {
              const step = steps.filter((x) => x.kept)[i];
              return [{ text: String(i), dim: true }, { text: t, tone: "keyword", bold: true, sub: step?.aliased ? `← ${step.token}` : undefined }];
            })
          : [[{ text: "", dim: true }, { text: "[]", tone: "muted" }]],
        beside: true,
      }),
    ];
  },
  output: "terms",
  state(frame, ctx) {
    return revealState(mod, frame, ctx, cellsOf, { titletokens: () => false, terms: () => false });
  },
  math(frame, { trace }) {
    const title = trace.entities.title ?? "";
    const steps = termSteps(title);
    if (frame.phase === "Setup") return [{ label: "tokenize", terms: [`“${title}”`], result: `${steps.length} token${steps.length === 1 ? "" : "s"}` }];
    if (frame.phase === "Filter") {
      const x = steps[frame.at];
      const checks = [
        ["kind = context", x.kind === "context", "stop word"],
        ["kind = number", x.kind === "number", "number"],
        ["kind = punctuation", x.kind === "punctuation", "punctuation"],
        ["MONTHS.includes", MONTHS.includes(x.token), "month name"],
        ["DAYS.includes", DAYS.includes(x.token), "weekday name"],
      ];
      const lines = [];
      for (const [label, hit] of checks) {
        lines.push({ label, terms: [`“${x.token}”`], result: String(hit) });
        if (hit) return lines;
      }
      lines.push({ label: "term", terms: [`ALIASES[“${x.token}”] || “${x.token}”`], result: `“${x.term}”` });
      return lines;
    }
    const k = trace.entities.keywords;
    return [{ label: "terms", terms: k.length ? k.map((t) => `“${t}”`) : ["[]"], op: ",", result: `${k.length} kept of ${steps.length}` }];
  },
});

const rawFrames = mod.frames;
mod.frames = (ctx) => indexed(rawFrames.call(mod, ctx));

export default mod;
