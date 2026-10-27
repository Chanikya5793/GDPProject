import { useState } from "react";
import { Expr, Matrix, Panel, Table, fixed } from "../../kit.jsx";
import { cells, labelsOf, list, mat, quote, range } from "./shared.jsx";

const DETAIL = 3; // rows 0..DETAIL-1 get one frame per sub-step
// Sub-steps of one row: 0 mask, 1 max, 2 shift, 3 exp, 4 sum, 5 divide.
const SUB_LINE = [2, 3, 4, 5, 6, 7];

const argmax = (values) => values.reduce((best, v, j) => (v > values[best] ? j : best), 0);

export default {
  id: "attention",
  source: [
    ["transformer", "softmaxSteps"],
    ["transformer", "attention"],
  ],
  code: [
    "// S: the n × n scores from the previous step",
    "for (let i = 0; i < n; i++) {",
    "  row = S[i].map((s, j) => (j > i ? -Infinity : s))  // causal mask",
    "  max = Math.max(...row)",
    "  shifted = row.map(s => s - max)  // largest becomes 0",
    "  exps = shifted.map(Math.exp)  // exp(−∞) = 0",
    "  sum = exps.reduce((a, b) => a + b, 0)",
    "  W[i] = exps.map(e => e / sum)  // the row sums to 1",
    "}",
  ],
  frames({ data }) {
    const m = data.transformer;
    const n = m.tokens.length;
    const frames = [
      {
        phase: "Setup",
        line: 0,
        say: n
          ? `S is ${n} × ${n}. Token i may only use tokens 0 to i, so in row i every score with j > i is replaced by −∞. Softmax then turns each row into weights between 0 and 1 that add up to 1.`
          : "There are no tokens, so S is empty and there is nothing to mask.",
        vars: { n },
        i: -1,
        sub: -1,
      },
    ];
    for (let i = 0; i < n; i++) {
      const s = m.softmaxRows[i];
      const t = quote(m.tokens[i]);
      const top = argmax(s.probs);
      const visible = s.exps.slice(0, i + 1);
      if (i < DETAIL) {
        const hidden = n - i - 1;
        const say = [
          `Row ${i}, ${t}: keep the ${i + 1} score${i ? "s" : ""} with j ≤ ${i}${hidden ? `; the ${hidden} with j > ${i} become −∞` : "; nothing comes after it"}.`,
          `The largest visible score is ${fixed(s.max, 4)}, in column ${argmax(s.shifted)} (${quote(m.tokens[argmax(s.shifted)])}).`,
          i === 0
            ? `Subtract ${fixed(s.max, 4)} from each entry, so the largest becomes 0 and exp cannot overflow. −∞ minus anything is still −∞.`
            : `Subtract ${fixed(s.max, 4)} from each visible score: [${list(s.shifted.slice(0, i + 1), 4)}]. The largest is now 0 and the rest are negative.`,
          `Take exp of each: ${visible.map((e, j) => `exp(${fixed(s.shifted[j], 4)}) = ${fixed(e, 4)}`).join(", ")}${hidden ? ", and exp(−∞) = 0 for the masked ones" : ""}.`,
          visible.length === 1
            ? `There is only one term, so sum = ${fixed(s.sum, 4)}.`
            : `Add them up: sum = ${visible.map((e) => fixed(e, 4)).join(" + ")} = ${fixed(s.sum, 4)}.`,
          `Divide each by ${fixed(s.sum, 4)}: W[${i}] = [${list(s.probs.slice(0, i + 1))}${hidden ? ", 0, …" : ""}]. The weights add up to 1.`,
        ];
        say.forEach((text, sub) =>
          frames.push({
            phase: "Step by step",
            line: SUB_LINE[sub],
            say: text,
            vars: [
              { i, "visible j": `0..${i}`, masked: hidden },
              { i, max: s.max },
              { i, max: s.max, shifted: s.shifted.slice(0, i + 1) },
              { i, exps: s.exps.slice(0, i + 1) },
              { i, sum: s.sum },
              { i, sum: s.sum, [`W[${i}]`]: s.probs.slice(0, i + 1) },
            ][sub],
            i,
            sub,
            hold: 0.8,
          }),
        );
      } else
        frames.push({
          phase: "Every row",
          line: [2, 3, 4, 5, 6, 7],
          say: `Row ${i}, ${t}: ${i + 1} visible scores, max = ${fixed(s.max, 3)}, sum of exps = ${fixed(s.sum, 3)}. The largest weight, ${fixed(s.probs[top])}, goes to ${quote(m.tokens[top])} (column ${top}).`,
          vars: { i, max: s.max, sum: s.sum, [`W[${i}]`]: s.probs.slice(0, i + 1) },
          i,
          sub: 5,
          hold: 0.8,
        });
    }
    frames.push({
      phase: "Done",
      line: 8,
      say: n
        ? `W is ${n} × ${n}. Everything above the diagonal is 0 and every row adds up to 1 (row ${n - 1}: ${fixed(m.weights[n - 1].reduce((a, b) => a + b, 0), 6)}). Click any cell to see its arithmetic.`
        : "W is empty.",
      vars: { "W.shape": `${n} × ${n}` },
      i: n,
      sub: 5,
    });
    return frames;
  },
  blocks({ data }) {
    const m = data.transformer;
    return [
      mat({
        id: "W",
        title: "W[i] = softmax(S[i], with j > i masked)",
        data: m.weights,
        rowLabels: labelsOf(m.tokens),
        colLabels: m.tokens.map((_, j) => String(j)),
        heat: "sequential",
        scale: 1,
        cellW: 1.2,
        masked: (r, c) => c > r,
      }),
      mat({
        id: "Wstats",
        title: "per row",
        data: m.softmaxRows.map((s) => [s.max, s.sum]),
        colLabels: ["max", "Σ exp"],
        heat: null,
        digits: 3,
        cellW: 1.25,
        beside: true,
      }),
    ];
  },
  output: "W",
  links: () => [{ from: "Wstats", to: "W" }],
  state(frame, { data }) {
    const n = data.transformer.tokens.length;
    const i = frame.i;
    const sub = frame.sub;
    const live = i >= 0 && i < n;
    const visible = live ? range(0, i + 1) : [];
    const every = frame.phase === "Every row";
    return {
      S: {
        source: !live ? [] : sub === 0 ? cells([i], range(0, n)) : sub === 4 ? [] : cells([i], visible),
      },
      W: {
        done: (r, c) => r < i || i >= n || (r === i && (c > i ? sub >= 0 : sub >= 5)),
        active: live && sub >= 5 ? cells([i], visible) : [],
      },
      Wstats: {
        done: (r, c) => r < i || i >= n || (r === i && sub >= (c === 0 ? 1 : 4)),
        active: !live ? [] : every ? [[i, 0], [i, 1]] : sub === 1 ? [[i, 0]] : sub === 4 ? [[i, 1]] : [],
        source: live && !every && (sub === 2 || sub === 3) ? [[i, 0]] : live && !every && sub === 5 ? [[i, 1]] : [],
      },
    };
  },
  math(frame, { data }) {
    const m = data.transformer;
    const i = frame.i;
    if (i < 0 || i >= m.tokens.length) return [];
    const s = m.softmaxRows[i];
    const seen = range(0, i + 1);
    const hidden = m.tokens.length - i - 1;
    const scores = seen.map((j) => fixed(m.scores[i][j]));
    const weight = (j) => ({ label: `W[${i}][${j}]`, terms: [fixed(s.exps[j], 4), fixed(s.sum, 4)], op: "÷", result: fixed(s.probs[j], 4) });
    if (frame.phase === "Every row") {
      const top = s.probs.reduce((b, v, j) => (v > s.probs[b] ? j : b), 0);
      return [
        { label: "max", terms: [`max(${scores.join(", ")})`], result: fixed(s.max) },
        { label: "Σ exp(s − max)", terms: seen.map((j) => fixed(s.exps[j])), result: fixed(s.sum) },
        weight(top),
      ];
    }
    return [
      [{ label: `S[${i}] masked`, terms: [[...scores, ...(hidden ? [`−∞ × ${hidden}`] : [])].join(", ")] }],
      [{ label: "max", terms: [`max(${scores.join(", ")})`], result: fixed(s.max, 4) }],
      [{ label: "s − max", terms: [seen.map((j) => fixed(s.shifted[j], 4)).join(", ")] }],
      [{ label: "exp(s − max)", terms: [seen.map((j) => fixed(s.exps[j], 4)).join(", ")] }],
      [{ label: "Σ exp", terms: seen.map((j) => fixed(s.exps[j], 4)), result: fixed(s.sum, 4) }],
      seen.slice(0, 8).map(weight),
    ][frame.sub] ?? [];
  },
  Stage({ ctx, frame, frames, seek }) {
    const m = ctx.data.transformer;
    const n = m.tokens.length;
    const [picked, setPicked] = useState(null);
    const labels = labelsOf(m.tokens);
    const rowDone = (r) => r < frame.i || (r === frame.i && frame.sub >= 5);
    const pickedOk = picked && picked[0] < n && rowDone(picked[0]);
    const row = pickedOk ? picked[0] : frame.i >= 0 && frame.i < n ? frame.i : frame.i >= n && n ? n - 1 : null;
    const sub = row === frame.i ? frame.sub : 5;
    const col = pickedOk ? picked[1] : row !== null && sub >= 5 ? argmax(m.weights[row]) : null;
    const s = row !== null ? m.softmaxRows[row] : null;
    const masked = (r) => r < frame.i || (r === frame.i && frame.sub >= 0) || frame.i >= n;
    const sState = (r, c) => {
      if (!masked(r)) return frame.i < 0 ? "done" : "dim";
      if (c > r) return "masked";
      return r === row ? "active" : "done";
    };
    const wState = (r, c) => {
      if (!rowDone(r)) return "pending";
      if (c > r) return "masked";
      return r === row && c === col ? "active" : "done";
    };
    const dot = "·";
    return (
      <div className="x-stack">
        <Matrix
          className="is-square"
          caption="S with the causal mask (rows: query token i, columns: key token j)"
          data={m.scores}
          rowLabels={labels}
          colLabels={m.tokens.map((_, j) => j)}
          state={sState}
        />
        {s && (
          <Panel title={`Row ${row}, ${quote(m.tokens[row])}: softmax step by step`}>
            <Table
              head={["j", "token", "s_ij", "masked", "− max", "exp", "w_ij"]}
              active={col ?? undefined}
              rows={m.tokens.map((t, j) => {
                const hidden = j > row;
                return {
                  cls: hidden && sub >= 0 ? "is-pending" : "",
                  cells: [
                    j,
                    <code key="t">{t}</code>,
                    fixed(m.scores[row][j], 4),
                    sub >= 0 ? fixed(m.masked[row][j], 4) : dot,
                    sub >= 2 ? fixed(s.shifted[j], 4) : dot,
                    sub >= 3 ? fixed(s.exps[j], 4) : dot,
                    sub >= 5 ? fixed(s.probs[j], 4) : dot,
                  ],
                };
              })}
            />
            {sub >= 1 && (
              <Expr
                label="max"
                terms={[`max(${m.scores[row].slice(0, row + 1).map((v) => fixed(v, 4)).join(", ")})`]}
                result={fixed(s.max, 4)}
              />
            )}
            {sub >= 4 && <Expr label="sum" terms={s.exps.slice(0, row + 1).map((e) => fixed(e, 4))} result={fixed(s.sum, 4)} />}
          </Panel>
        )}
        <Matrix
          className="is-square"
          caption="W = softmax of each masked row. Hatched cells had score −∞, so their weight is exactly 0. Click a cell."
          data={m.weights}
          rowLabels={labels}
          colLabels={m.tokens.map((_, j) => j)}
          heatKind="sequential"
          scale={1}
          state={wState}
          onCell={(r, c) => {
            setPicked([r, c]);
            seek(frames.findLastIndex((f) => f.i === r));
          }}
        />
        {s && col !== null && (
          <Panel title={`W[${row}][${col}]: ${quote(m.tokens[row])} → ${quote(m.tokens[col])}`}>
            {col > row ? (
              <Expr label="masked" terms={["exp(−∞)", fixed(s.sum, 4)]} op="÷" result="0" />
            ) : (
              <>
                <Expr
                  label="exp(s − max)"
                  op="="
                  terms={[`exp(${fixed(m.scores[row][col], 4)} − ${fixed(s.max, 4)})`, `exp(${fixed(s.shifted[col], 4)})`]}
                  result={fixed(s.exps[col], 4)}
                />
                <Expr label="÷ sum" terms={[fixed(s.exps[col], 4), fixed(s.sum, 4)]} op="÷" result={fixed(s.probs[col], 4)} />
              </>
            )}
          </Panel>
        )}
      </div>
    );
  },
};
