import { Panel, Table, Tag, fixed } from "../../kit.jsx";
import { tableBlock } from "../../../map/blocks.js";
import { Chips, isDefault, paramsOf, quote, range, tunedSay } from "./shared.jsx";

const CHUNK = 8; // vocabulary entries compared per scan frame
const pct = (p) => `${fixed(p * 100, 2)}%`;

// The argmax scan, one comparison at a time: [{ t, before, after }].
function scan(p) {
  const steps = [];
  let best = 0;
  for (let t = 1; t < p.length; t++) {
    const before = best;
    if (p[t] > p[best]) best = t;
    steps.push({ t, before, after: best });
  }
  return steps;
}

export default {
  id: "decode",
  source: [
    ["transformer", "attention"],
    ["transformer", "TRANSFORMER_DEFAULTS"],
  ],
  code: [
    "let best = 0",
    "for (let t = 1; t < p.length; t++)",
    "  if (p[t] > p[best]) best = t  // a tie keeps the earlier token",
    "next = vocabulary[best]",
    "sequence = [...window, next]",
    "window = sequence.slice(-context)  // keep the last context tokens (default 16)",
    "// then run every step again on the new window",
  ],
  frames(ctx) {
    const { data, generatedTokens = [] } = ctx;
    const p = paramsOf(ctx);
    const CONTEXT = p.context;
    const m = data.transformer;
    const probs = m.probabilities;
    const V = probs.length;
    const vocab = m.vocabulary;
    const total = probs.reduce((a, b) => a + b, 0);
    const steps = scan(probs);
    const frames = [
      {
        phase: "Setup",
        line: 0,
        say: `p has ${V} entries, one per vocabulary token, adding up to ${fixed(total, 6)}. Greedy decoding scans them once and keeps the index of the largest. It starts with best = 0 (${quote(vocab[0])}, p = ${fixed(probs[0], 4)}).${
          isDefault(p, "temperature") ? "" : ` Temperature ${p.temperature} changes how sure the model looks, not which token is largest, so greedy decoding picks the same token.`
        }${tunedSay(p, ["context", "merges"])}`,
        vars: { "p.length": V, best: 0, "probs[best]": probs[0] },
        to: 0,
        from: 1,
      },
    ];
    for (let from = 1; from < V; from += CHUNK) {
      const to = Math.min(V - 1, from + CHUNK - 1);
      const part = steps.slice(from - 1, to);
      const changes = part.filter((s) => s.after !== s.before);
      const best = part.at(-1).after;
      frames.push({
        phase: "Scan",
        line: [1, 2],
        say: changes.length
          ? `t = ${from} to ${to}: ${changes.map((c) => `probs[${c.t}] = ${fixed(probs[c.t], 4)} (${quote(vocab[c.t])}) beats ${fixed(probs[c.before], 4)}`).join("; ")}. best = ${best}.`
          : `t = ${from} to ${to}: none of these beats probs[${best}] = ${fixed(probs[best], 4)} (${quote(vocab[best])}), so best stays ${best}.`,
        vars: { t: to, best, "probs[best]": probs[best], token: vocab[best] },
        from,
        to,
        hold: 0.7,
      });
    }
    const best = steps.length ? steps.at(-1).after : 0;
    const next = m.nextToken ?? vocab[best];
    const second = m.ranked[1];
    frames.push({
      phase: "Choose",
      line: 3,
      say: `The scan is over. best = ${best}, so the next token is ${quote(next)} with p = ${fixed(probs[best], 4)} (${pct(probs[best])}).${second ? ` The runner-up, ${quote(second.token)}, has ${fixed(second.probability, 4)}.` : ""}`,
      vars: { best, next, "probs[best]": probs[best] },
      to: V - 1,
      from: V,
      chosen: true,
    });
    const win = m.tokens;
    const seq = [...win, next];
    const dropped = seq.length > CONTEXT ? seq[0] : null;
    frames.push({
      phase: "Window",
      line: [4, 5],
      say: win.length
        ? `Appending ${quote(next)} to the ${win.length}-token window gives ${seq.length} tokens. ${dropped !== null ? `That is more than ${CONTEXT}, so slice(-${CONTEXT}) drops ${quote(dropped)} from the front and every other token moves one position earlier.` : `That is within ${CONTEXT}, so nothing is dropped.`}`
        : `The window is empty, so appending gives the single token ${quote(next)}.`,
      vars: { "window.length": win.length, "sequence.length": seq.length, dropped: dropped ?? "none" },
      to: V - 1,
      from: V,
      chosen: true,
      window: true,
    });
    const limit = generatedTokens.length >= CONTEXT;
    frames.push({
      phase: "Run again",
      line: 6,
      say: `${generatedTokens.length ? `Appended so far: ${generatedTokens.map(quote).join(" ")}. ` : ""}${
        limit
          ? `The app stops appending after ${CONTEXT} tokens.`
          : `Clicking “Append and run again” above adds ${quote(next)} and reruns every step on the new window: new positions, scores, weights and logits.`
      } The weights are untrained, so this prediction is the result of real arithmetic but carries no meaning.`,
      vars: { next, "generated.length": generatedTokens.length },
      to: V - 1,
      from: V,
      chosen: true,
      window: true,
    });
    return frames;
  },
  blocks(ctx) {
    const CONTEXT = paramsOf(ctx).context;
    const m = ctx.data.transformer;
    const win = m.tokens;
    const next = m.nextToken;
    const after = [...win, next].slice(-CONTEXT);
    const drop = win.length + 1 > CONTEXT;
    const best = m.ranked[0];
    return [
      tableBlock({
        id: "next",
        title: "next = argmax p",
        head: ["#", "token", "p"],
        widths: [0.45, 1.3, 0.85],
        rows: [[{ text: String(best.index), dim: true }, { text: next, tone: "good" }, fixed(best.probability, 4)]],
        explain: (r, c) =>
          r || c > 2
            ? null
            : {
                meaning: `The token greedy decoding picks: the single most probable one, ${quote(next)}.`,
                formula: "next = argmax p; a tie keeps the earlier token",
                worked: `p[${best.index}] = ${fixed(best.probability, 4)}${m.ranked[1] ? ` beats the runner-up ${quote(m.ranked[1].token)} at ${fixed(m.ranked[1].probability, 4)}` : ""}`,
              },
      }),
      tableBlock({
        id: "window",
        title: `[...window, next].slice(-${CONTEXT})`,
        head: ["before", "after"],
        widths: [1.3, 1.3],
        rowLabels: after.map((_, p) => String(p)),
        rows: after.map((t, p) => [
          win[p] === undefined ? null : { text: win[p], tone: drop && p === 0 ? "warn" : undefined, full: drop && p === 0 ? "dropped" : undefined },
          { text: t, tone: p === after.length - 1 ? "good" : undefined },
        ]),
        beside: true,
        explain: (r, c) => {
          if (c > 1 || after[r] === undefined || (c === 0 && win[r] === undefined)) return null;
          if (c === 0)
            return {
              meaning: `The token at position ${r} of the current window${drop && r === 0 ? "; it falls out when the new token is appended" : ""}.`,
              formula: `window = the last ${CONTEXT} tokens`,
              worked: `window[${r}] = ${quote(win[r])}`,
            };
          return {
            meaning: `Position ${r} of the next window, the input of the next run.`,
            formula: `[...window, next].slice(-${CONTEXT})`,
            worked: drop
              ? `${win.length} + 1 = ${win.length + 1} tokens, more than ${CONTEXT}, so everything moves up one: ${quote(after[r])}`
              : `${win.length} + 1 = ${win.length + 1} tokens fit in ${CONTEXT}: ${quote(after[r])}`,
          };
        },
      }),
    ];
  },
  output: "window",
  links: () => [{ from: "next", to: "window" }],
  state(frame, ctx) {
    const CONTEXT = paramsOf(ctx).context;
    const m = ctx.data.transformer;
    const V = m.vocabulary.length;
    const shown = Math.min(15, V);
    const rankOf = new Map(m.ranked.map((r, i) => [r.index, i]));
    const pCell = (t) => {
      const r = rankOf.get(t);
      return r < shown ? [r, 7] : [shown, 7];
    };
    const scanned = frame.chosen ? [] : range(frame.from, frame.to + 1);
    const read = frame.to === 0 && !frame.chosen ? [[rankOf.get(0) < shown ? rankOf.get(0) : shown, 7]] : scanned.map(pCell);
    const unique = [...new Map(read.map((c) => [c.join(","), c])).values()].filter(([r]) => r < shown + (V > shown ? 1 : 0));
    const rows = Math.min(m.tokens.length + 1, CONTEXT);
    return {
      logits: { source: frame.chosen && !frame.window ? [[0, 7]] : frame.chosen ? [] : unique },
      next: { done: () => Boolean(frame.chosen), active: frame.chosen && !frame.window ? [[0, 0], [0, 1], [0, 2]] : [], source: frame.window ? [[0, 1]] : [] },
      window: {
        done: () => Boolean(frame.window),
        active: frame.window ? [[rows - 1, 1]] : [],
      },
    };
  },
  math(frame, ctx) {
    const CONTEXT = paramsOf(ctx).context;
    const m = ctx.data.transformer;
    const p = m.probabilities;
    const vocab = m.vocabulary;
    const steps = scan(p);
    if (!frame.chosen) {
      if (frame.to === 0) return [{ label: "best = 0", terms: [`p[0] ${quote(vocab[0])}`], result: fixed(p[0], 4) }];
      return steps.slice(frame.from - 1, frame.to).map((s) => ({
        label: `t = ${s.t} ${quote(vocab[s.t])}`,
        terms: [fixed(p[s.t], 4), fixed(p[s.before], 4)],
        op: ">",
        result: s.after !== s.before ? `yes, best = ${s.t}` : "no",
      }));
    }
    const best = steps.length ? steps.at(-1).after : 0;
    const next = m.nextToken;
    if (!frame.window) return [{ label: "argmax", terms: [`p[${best}] = ${fixed(p[best], 4)}`], result: quote(next) }];
    const win = m.tokens;
    const lines = [{ label: "sequence", terms: [`${win.length} tokens`, quote(next)], result: `${win.length + 1} tokens` }];
    if (win.length + 1 > CONTEXT) lines.push({ label: `slice(-${CONTEXT})`, terms: [`drop ${quote(win[0])}`], result: `${CONTEXT} tokens` });
    return frame.phase === "Run again" ? [] : lines;
  },
  Stage({ ctx, frame }) {
    const CONTEXT = paramsOf(ctx).context;
    const m = ctx.data.transformer;
    const generated = ctx.generatedTokens ?? [];
    const p = m.probabilities;
    const vocab = m.vocabulary;
    const steps = scan(p);
    const best = frame.to > 0 ? steps[frame.to - 1].after : 0;
    const inChunk = (t) => !frame.chosen && t >= frame.from && t <= frame.to;
    const chunk = steps.slice(frame.from - 1, frame.to);
    const next = m.nextToken ?? vocab[best];
    const win = m.tokens;
    const seq = [...win, next];
    const drop = Math.max(0, seq.length - CONTEXT);
    return (
      <div className="x-stack">
        <Panel
          title={`p over the vocabulary (${vocab.length} tokens, in vocabulary order)`}
          note="Green: the best so far. Outlined: compared in this frame. Faded: not compared yet."
        >
          <Chips
            items={vocab}
            sub={(t) => pct(p[t])}
            cls={(t) => (t === best ? "is-best" : inChunk(t) ? "is-scan" : t > frame.to ? "is-pending" : "")}
          />
        </Panel>
        {!frame.chosen && chunk.length > 0 && (
          <Panel title={`Comparisons t = ${frame.from} to ${frame.to}`}>
            <Table
              head={["t", "token", "p[t]", "p[best] before", "p[t] > p[best]?", "best after"]}
              rows={chunk.map((s) => [
                s.t,
                <code key="t">{vocab[s.t]}</code>,
                fixed(p[s.t], 4),
                `${fixed(p[s.before], 4)} (#${s.before})`,
                s.after !== s.before ? <Tag key="y" kind="pass">yes</Tag> : <Tag key="n" kind="skip">no</Tag>,
                s.after,
              ])}
            />
          </Panel>
        )}
        {frame.chosen && (
          <Panel title="Chosen token">
            <div className="t-facts">
              <span>
                best = <b>{best}</b>
              </span>
              <span>
                next = <b>{quote(next)}</b>
              </span>
              <span>
                p = <b>{fixed(p[best], 4)}</b> ({pct(p[best])})
              </span>
            </div>
          </Panel>
        )}
        {frame.window && (
          <Panel
            title={`[...window, next].slice(-${CONTEXT})`}
            note={drop ? "Crossed out: falls out of the window. Green border: the new token." : "Green border: the new token."}
          >
            <Chips
              items={seq}
              sub={(i) => (i < drop ? "out" : i - drop)}
              cls={(i) => (i < drop ? "is-drop" : i === seq.length - 1 ? "is-gen" : "is-done")}
            />
          </Panel>
        )}
        {frame.chosen && (
          <Panel title={`Appended so far (${generated.length})`}>
            {generated.length ? <Chips items={generated} sub={(i) => i} cls={() => "is-gen"} /> : <p className="x-note">None yet.</p>}
          </Panel>
        )}
      </div>
    );
  },
};
