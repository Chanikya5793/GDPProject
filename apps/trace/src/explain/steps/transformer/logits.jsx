import { useState } from "react";
import { Bars, Expr, Matrix, Panel, Table, fixed } from "../../kit.jsx";
import { D_MODEL, VOCABULARY, tokenCode } from "../../../engine/transformer.js";
import { tableBlock } from "../../../map/blocks.js";
import { DIMS, cells, charTerms, list, operand, quote, range } from "./shared.jsx";

const FULL = 10; // tokens shown in full, in order of their final rank
const BARS = 15;
const angle = (code, d) => (code + 1) * (d + 1) * 0.013;
const hLast = (m) => m.norm2.at(-1) || Array(D_MODEL).fill(0);
// Map table: the top SHOWN tokens by p, then one "… more" row.
const SHOWN = 15;
const P_COL = 7;
const n0 = (m) => m.tokens.length === 0;
const tableRows = (V) => Math.min(SHOWN, V) + (V > SHOWN ? 1 : 0);

export default {
  id: "logits",
  source: [
    ["transformer", "unembedRow"],
    ["transformer", "tokenCode"],
    ["transformer", "softmaxSteps"],
    ["transformer", "attention"],
  ],
  code: [
    "h = H2[n - 1]  // the last position's row",
    "for (const t of VOCABULARY) {  // every token the model can output",
    "  code = tokenCode(t)",
    "  U_t = [0, 1, 2, 3].map(d => Math.sin((code + 1) * (d + 1) * 0.013) * 0.5)",
    "  logit[t] = dot(h, U_t)  // h0·U0 + h1·U1 + h2·U2 + h3·U3",
    "}",
    "max = Math.max(...logits)",
    "exps = logits.map(z => Math.exp(z - max))",
    "sum = exps.reduce((a, b) => a + b, 0)",
    "p = exps.map(e => e / sum)  // probabilities, sum to 1",
  ],
  frames({ data }) {
    const m = data.transformer;
    const n = m.tokens.length;
    const V = m.vocabulary.length;
    const h = hLast(m);
    const s = m.vocabSoftmax;
    const ranked = m.ranked;
    const full = Math.min(FULL, V);
    const frames = [
      {
        phase: "Setup",
        line: 0,
        say: n
          ? `Only the last position predicts the next token. Its row of H₂ is h = [${list(h)}] (position ${n - 1}, ${quote(m.tokens[n - 1])}). Each of the ${V} vocabulary tokens gets a score: logit = h · U_t.`
          : `There are no tokens, so the engine uses h = [0, 0, 0, 0]. Every logit will be 0 and every token will get the same probability, 1/${V}.`,
        vars: { h, "VOCABULARY.length": V },
        tok: -1,
        done: 0,
        sub: -1,
      },
    ];
    const seen = new Map(); // code → first token shown with that code
    ranked.slice(0, full).forEach((r, i) => {
      const code = tokenCode(r.token);
      const u = m.unembedding[r.index];
      const twin = seen.get(code);
      if (twin === undefined) seen.set(code, r.token);
      frames.push({
        phase: "In full",
        line: [2, 3, 4],
        say: `${i === 0 ? `The engine scores all ${V} tokens in vocabulary order; the ${full} that end up highest are shown first. ` : ""}${quote(r.token)} (vocabulary #${r.index}): code = ${code}, U = [${list(u)}], logit = ${h.map((v, d) => `${operand(v)}×${operand(u[d])}`).join(" + ")} = ${fixed(r.logit, 4)}.${twin !== undefined ? ` Its code equals that of ${quote(twin)}, so its U row and logit are the same.` : ""}`,
        vars: { t: r.token, code, U_t: u, logit: r.logit },
        tok: r.index,
        done: i + 1,
        sub: -1,
        hold: i === 0 ? 1.3 : 0.9,
      });
    });
    const lo = ranked.at(-1);
    if (V > full)
      frames.push({
        phase: "Every token",
        line: [1, 2, 3, 4, 5],
        say: `The other ${V - full} tokens go through the same three lines. All ${V} logits lie between ${fixed(lo.logit, 4)} (${quote(lo.token)}) and ${fixed(ranked[0].logit, 4)} (${quote(ranked[0].token)}).`,
        vars: { "logits.length": V, min: lo.logit, max: ranked[0].logit },
        tok: -1,
        done: V,
        sub: -1,
      });
    const top = ranked[0];
    frames.push(
      {
        phase: "Softmax",
        line: 6,
        say: `The largest logit is ${fixed(s.max, 4)} (${quote(top.token)}). Subtracting it from every logit makes the largest 0 and the rest negative, so exp cannot overflow.`,
        vars: { max: s.max },
        tok: -1,
        done: V,
        sub: 0,
      },
      {
        phase: "Softmax",
        line: 7,
        say: `exp of each shifted logit: ${quote(top.token)} gets exp(0) = 1 and the lowest, ${quote(lo.token)}, gets exp(${fixed(s.shifted[lo.index], 4)}) = ${fixed(s.exps[lo.index], 4)}.`,
        vars: { "exps[top]": s.exps[top.index], "exps[lowest]": s.exps[lo.index] },
        tok: -1,
        done: V,
        sub: 1,
      },
      {
        phase: "Softmax",
        line: 8,
        say: `Adding all ${V} exps: sum = ${fixed(s.sum, 4)}.`,
        vars: { sum: s.sum },
        tok: -1,
        done: V,
        sub: 2,
      },
      {
        phase: "Softmax",
        line: 9,
        say: `Divide each exp by ${fixed(s.sum, 4)}. ${quote(top.token)} gets p = ${fixed(top.probability, 4)} (${fixed(top.probability * 100, 2)}%); a uniform guess over ${V} tokens would give ${fixed(1 / V, 4)} each.`,
        vars: { sum: s.sum, [`p[${quote(top.token)}]`]: top.probability },
        tok: -1,
        done: V,
        sub: 3,
      },
    );
    const total = m.probabilities.reduce((a, b) => a + b, 0);
    frames.push({
      phase: "Done",
      line: 9,
      say: `The ${V} probabilities add up to ${fixed(total, 6)}. The ${Math.min(BARS, V)} largest are drawn below; the next step picks the single largest. Click a token for its arithmetic.`,
      vars: { "p.length": V, "Σ p": total, top: top.token },
      tok: -1,
      done: V,
      sub: 4,
    });
    return frames;
  },
  blocks({ data }) {
    const m = data.transformer;
    const V = m.vocabulary.length;
    const top = m.ranked.slice(0, SHOWN);
    const rows = top.map((r, i) => [
      { text: String(r.index), dim: true },
      { text: r.token, align: "left", tone: i === 0 ? "good" : undefined },
      ...m.unembedding[r.index].map((u) => ({ text: fixed(u, 2), value: u })),
      { text: fixed(r.logit, 3), value: r.logit, bold: true },
      { text: fixed(r.probability, 4), tone: i === 0 ? "good" : undefined },
    ]);
    if (V > SHOWN)
      rows.push([
        { text: "…", dim: true },
        { text: `${V - SHOWN} more`, align: "left", tone: "muted" },
        ...range(0, 4).map(() => ({ text: "…", dim: true })),
        { text: `≥ ${fixed(m.ranked.at(-1).logit, 2)}`, dim: true },
        { text: `≤ ${fixed(m.ranked[SHOWN].probability, 4)}`, dim: true },
      ]);
    return [
      {
        ...tableBlock({
          id: "logits",
          title: `logit = h·U_t, p = softmax   (top ${Math.min(SHOWN, V)} of ${V} by p)`,
          head: ["#", "token", "U0", "U1", "U2", "U3", "logit", "p"],
          widths: [0.45, 1.25, 0.72, 0.72, 0.72, 0.72, 0.85, 0.95],
          rows,
        }),
        heat: "diverging",
      },
    ];
  },
  output: "logits",
  state(frame, { data }) {
    const m = data.transformer;
    const n = m.tokens.length;
    const V = m.vocabulary.length;
    const rows = tableRows(V);
    const shownDone = frame.done >= V ? rows : Math.min(frame.done, SHOWN);
    const h = n ? cells([n - 1], [0, 1, 2, 3]) : [];
    const inFull = frame.tok >= 0;
    const rank = inFull ? m.ranked.findIndex((r) => r.index === frame.tok) : -1;
    const batch = frame.phase === "Every token";
    return {
      H2: { source: inFull || batch || frame.phase === "Setup" ? h : [] },
      logits: {
        done: (r, c) => (c < P_COL ? r < shownDone : frame.sub >= 3),
        active: inFull && rank < SHOWN ? cells([rank], range(0, P_COL)) : batch ? cells(range(SHOWN, rows), range(2, P_COL)) : frame.sub === 3 ? cells(range(0, rows), [P_COL]) : frame.sub >= 4 ? [[0, P_COL]] : [],
        source: frame.sub === 0 ? [[0, 6]] : frame.sub === 1 || frame.sub === 2 ? cells(range(0, rows), [6]) : [],
      },
    };
  },
  math(frame, { data }) {
    const m = data.transformer;
    const V = m.vocabulary.length;
    const h = hLast(m);
    const s = m.vocabSoftmax;
    const dotLine = (index) => ({
      label: `logit ${quote(m.vocabulary[index])}`,
      terms: h.map((v, d) => `${fixed(v)}×${fixed(m.unembedding[index][d])}`),
      result: fixed(m.logits[index], 4),
    });
    if (frame.tok >= 0) {
      const t = m.vocabulary[frame.tok];
      const code = tokenCode(t);
      return [
        { label: "code", terms: charTerms(t).map((c) => `${c.cp}×${c.mult}`), result: code },
        ...m.unembedding[frame.tok].map((u, d) => ({
          label: `U[${d}]`,
          terms: [`sin(${code + 1}×${d + 1}×0.013)×0.5`],
          result: fixed(u, 4),
        })),
        dotLine(frame.tok),
      ];
    }
    if (frame.phase === "Every token") return m.ranked.slice(FULL, FULL + 5).map((r) => dotLine(r.index));
    const top = m.ranked[0];
    const lo = m.ranked.at(-1);
    if (frame.sub === 0) return [{ label: "max", terms: [`max of ${V} logits`], result: `${fixed(s.max, 4)} (${quote(top.token)})` }];
    if (frame.sub === 1)
      return [top, m.ranked[1], lo].filter(Boolean).map((r) => ({
        label: `exp ${quote(r.token)}`,
        terms: [`exp(${fixed(r.logit, 4)} − ${fixed(s.max, 4)})`],
        result: fixed(s.exps[r.index], 4),
      }));
    if (frame.sub === 2)
      return [{ label: "Σ exp", terms: [...m.ranked.slice(0, 4).map((r) => fixed(s.exps[r.index], 4)), `… (${V} terms)`], result: fixed(s.sum, 4) }];
    if (frame.sub === 3)
      return m.ranked.slice(0, 3).map((r) => ({
        label: `p ${quote(r.token)}`,
        terms: [fixed(s.exps[r.index], 4), fixed(s.sum, 4)],
        op: "÷",
        result: fixed(r.probability, 4),
      }));
    if (frame.sub >= 4)
      return [{ label: "Σ p", terms: [`${V} probabilities`], result: fixed(m.probabilities.reduce((a, b) => a + b, 0), 6) }];
    return n0(m) ? [{ label: "h", terms: ["no tokens"], result: "[0, 0, 0, 0]" }] : [{ label: `h = H₂[${m.tokens.length - 1}]`, terms: [`[${list(h)}]`] }];
  },
  Stage({ ctx, frame, frames, seek }) {
    const m = ctx.data.transformer;
    const V = m.vocabulary.length;
    const [picked, setPicked] = useState(null);
    const h = hLast(m);
    const s = m.vocabSoftmax;
    const rankOf = new Map(m.ranked.map((r, i) => [r.index, i]));
    const computed = (index) => rankOf.get(index) < frame.done;
    const tok = picked !== null && computed(picked) ? picked : frame.tok >= 0 ? frame.tok : frame.sub >= 4 ? m.ranked[0]?.index ?? null : null;
    const pick = (index) => {
      setPicked(index);
      const exact = frames.findIndex((f) => f.tok === index);
      if (exact >= 0 && frame.sub < 0) seek(exact);
    };
    return (
      <div className="x-stack">
        <div className="x-row-wrap">
          <Matrix
            className="t-vector"
            caption={m.tokens.length ? `h = H₂[${m.tokens.length - 1}], the last position` : "h (no tokens, so zeros)"}
            data={[h]}
            colLabels={DIMS}
          />
        </div>
        {tok !== null && <TokenDetail m={m} h={h} index={tok} sub={frame.sub} />}
        {frame.sub >= 4 && (
          <Panel title={`The ${Math.min(BARS, V)} most probable tokens`} note="Click a bar to see that token's arithmetic.">
            <Bars
              digits={2}
              unit="%"
              items={m.ranked.slice(0, BARS).map((r, i) => ({
                key: r.index,
                label: r.token,
                value: r.probability * 100,
                active: r.index === tok,
                onClick: () => setPicked(r.index),
                note: i === 0 ? "argmax" : undefined,
              }))}
            />
          </Panel>
        )}
        <Panel
          title={`Vocabulary (${V} tokens), sorted by final rank`}
          note={frame.done < V ? "Rows marked · are not computed yet." : "Click a row to see its arithmetic."}
        >
          <Table
            className="t-scroll"
            head={["rank", "#", "token", "code", "U_t", "logit", "z − max", "exp", "p"]}
            active={tok === null ? undefined : rankOf.get(tok)}
            onRow={(r) => pick(m.ranked[r].index)}
            rows={m.ranked.map((r, i) => {
              const on = i < frame.done;
              const dot = "·";
              return {
                cls: on ? "" : "is-pending",
                cells: [
                  i + 1,
                  r.index,
                  <code key="t">{r.token}</code>,
                  tokenCode(r.token),
                  on ? `[${list(m.unembedding[r.index], 2)}]` : dot,
                  on ? fixed(r.logit, 4) : dot,
                  frame.sub >= 0 ? fixed(s.shifted[r.index], 4) : dot,
                  frame.sub >= 1 ? fixed(s.exps[r.index], 4) : dot,
                  frame.sub >= 3 ? fixed(r.probability, 4) : dot,
                ],
              };
            })}
          />
          {frame.sub >= 2 && (
            <Expr
              label="sum"
              terms={[...m.ranked.slice(0, 4).map((r) => fixed(s.exps[r.index], 4)), `… (${V} terms)`]}
              result={fixed(s.sum, 4)}
            />
          )}
        </Panel>
      </div>
    );
  },
};

function TokenDetail({ m, h, index, sub }) {
  const t = VOCABULARY[index] ?? m.vocabulary[index];
  const chars = charTerms(t);
  const code = tokenCode(t);
  const u = m.unembedding[index];
  const s = m.vocabSoftmax;
  return (
    <Panel title={`${quote(t)} (vocabulary #${index})`}>
      <Expr label="code" terms={chars.map((c) => `${c.cp}×${c.mult}`)} result={code} />
      {u.map((v, d) => (
        <Expr
          key={d}
          label={`U[${d}]`}
          op="="
          terms={[`sin((${code} + 1) × ${d + 1} × 0.013) × 0.5`, `sin(${fixed(angle(code, d))}) × 0.5`]}
          result={fixed(v, 4)}
        />
      ))}
      <Expr label="logit = h · U" terms={h.map((v, d) => `${fixed(v)}×${fixed(u[d])}`)} result={fixed(m.logits[index], 4)} />
      {sub >= 3 && (
        <Expr
          label="p"
          op="="
          terms={[
            `exp(${fixed(m.logits[index], 4)} − ${fixed(s.max, 4)}) ÷ ${fixed(s.sum, 4)}`,
            `${fixed(s.exps[index], 4)} ÷ ${fixed(s.sum, 4)}`,
          ]}
          result={fixed(s.probs[index], 4)}
        />
      )}
    </Panel>
  );
}
