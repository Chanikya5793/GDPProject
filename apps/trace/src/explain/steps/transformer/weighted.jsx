import { useState } from "react";
import { Bars, Expr, Matrix, Panel, fixed } from "../../kit.jsx";
import { D_MODEL } from "../../../engine/transformer.js";
import { DIMS, cells, labelsOf, list, mat, operand, quote, range } from "./shared.jsx";

const DETAIL = 3; // rows 0..DETAIL-1 get one frame per output column

// The products w_ij · v_j[d] that are not zero (masked weights are exactly 0).
// In sentences (`paren`), negative values get parentheses: 0.157×(−0.610).
const terms = (m, i, d, paren = false) =>
  m.weights[i]
    .map((w, j) => (w ? `${fixed(w)}×${paren ? operand(m.value[j][d]) : fixed(m.value[j][d])}` : null))
    .filter(Boolean);
const short = (m, i, d) => {
  const t = terms(m, i, d, true);
  return t.length > 3 ? `${t.slice(0, 3).join(" + ")} + … (${t.length} terms)` : t.join(" + ");
};
const argmax = (values) => values.reduce((best, v, j) => (v > values[best] ? j : best), 0);

export default {
  id: "output",
  source: [
    ["transformer", "W_V"],
    ["transformer", "attention"],
  ],
  code: [
    "V = X.map(x => vecMat(x, W_V))  // W_V is the identity, so V = X",
    "for (let i = 0; i < n; i++)  // output row",
    "  for (let d = 0; d < 4; d++)  // output column",
    "    O[i][d] = Σ_j W[i][j] · V[j][d]  // masked weights are 0, so only j ≤ i count",
  ],
  frames({ data }) {
    const m = data.transformer;
    const n = m.tokens.length;
    const frames = [
      {
        phase: "Setup",
        line: 0,
        say: n
          ? "W_V is the 4 × 4 identity matrix, so each value vector v_j = x_j · W_V is just x_j, and V equals X. Row i of the output is a weighted average of the value rows 0 to i, using row i of W."
          : "There are no tokens, so there is nothing to average.",
        vars: { n, "V.shape": `${n} × 4` },
        i: -1,
        d: -1,
      },
    ];
    for (let i = 0; i < n; i++) {
      const top = argmax(m.weights[i]);
      if (i < DETAIL)
        for (let d = 0; d < D_MODEL; d++)
          frames.push({
            phase: "Step by step",
            line: [2, 3],
            say:
              i === 0
                ? `O[0][${d}] = 1 × ${operand(m.value[0][d])} = ${fixed(m.output[0][d])}.${d === 0 ? " Row 0 sees only itself, with weight 1, so its output is its own value row." : ""}`
                : `O[${i}][${d}] = ${terms(m, i, d, true).join(" + ")} = ${fixed(m.output[i][d])}.`,
            vars: { i, d, [`W[${i}]`]: m.weights[i].slice(0, i + 1), [`O[${i}][${d}]`]: m.output[i][d] },
            i,
            d,
            hold: 0.75,
          });
      else
        frames.push({
          phase: "Every row",
          line: [1, 2, 3],
          say: `Row ${i}, ${quote(m.tokens[i])}: ${i + 1} value rows, the heaviest is ${quote(m.tokens[top])} (weight ${fixed(m.weights[i][top])}). O[${i}][0] = ${short(m, i, 0)} = ${fixed(m.output[i][0])}; O[${i}] = [${list(m.output[i])}].`,
          vars: { i, [`O[${i}]`]: m.output[i] },
          i,
          d: 3,
          hold: 0.8,
        });
    }
    frames.push({
      phase: "Done",
      line: 3,
      say: n
        ? `O is ${n} × 4. The weights in each row are non-negative and add up to 1, so every O[i][d] lies between the smallest and the largest V[j][d] for j ≤ i.`
        : "O is empty: 0 × 4.",
      vars: { "O.shape": `${n} × 4` },
      i: n,
      d: -1,
    });
    return frames;
  },
  blocks({ data }) {
    const m = data.transformer;
    return [
      mat({
        id: "O",
        title: "O[i] = Σⱼ W[i][j] · X[j]   (V = X)",
        data: m.output,
        rowLabels: labelsOf(m.tokens),
        colLabels: DIMS,
      }),
    ];
  },
  output: "O",
  state(frame, { data }) {
    const n = data.transformer.tokens.length;
    const i = frame.i;
    const live = i >= 0 && i < n;
    const seen = live ? range(0, i + 1) : [];
    const cols = !live ? [] : frame.phase === "Every row" ? [0, 1, 2, 3] : [frame.d];
    return {
      W: { source: cells([i], seen) },
      X: { source: cells(seen, cols) },
      O: {
        done: (r, c) => r < i || i >= n || (r === i && c <= frame.d),
        active: cells(live ? [i] : [], cols),
      },
    };
  },
  math(frame, { data }) {
    const m = data.transformer;
    const i = frame.i;
    if (i < 0 || i >= m.tokens.length) return [];
    const cols = frame.phase === "Every row" ? [0, 1, 2, 3] : [frame.d];
    return cols.map((d) => ({ label: `O[${i}][${d}]`, terms: terms(m, i, d), result: fixed(m.output[i][d]) }));
  },
  Stage({ ctx, frame, frames, seek }) {
    const m = ctx.data.transformer;
    const n = m.tokens.length;
    const [picked, setPicked] = useState(null);
    const labels = labelsOf(m.tokens);
    const finished = (r) => r < frame.i || (r === frame.i && frame.d >= 3);
    const row =
      picked !== null && picked < n && finished(picked)
        ? picked
        : frame.i >= 0 && frame.i < n
          ? frame.i
          : frame.i >= n && n
            ? n - 1
            : null;
    const live = row === frame.i;
    const dUpTo = live ? frame.d : 3;
    const top = row === null ? -1 : argmax(m.weights[row]);
    const vState = (r, c) =>
      row === null ? "done" : r > row ? "dim" : live && dUpTo >= 0 && c === dUpTo && frame.i < DETAIL ? "active" : "done";
    const oState = (r, c) => {
      if (r === row && !live) return "active";
      if (r < frame.i) return "done";
      if (r > frame.i) return "pending";
      return c < frame.d ? "done" : c === frame.d ? "active" : "pending";
    };
    const onCell = (r) => {
      setPicked(r);
      seek(frames.findLastIndex((f) => f.i === r));
    };
    return (
      <div className="x-stack">
        {row !== null && dUpTo >= 0 && (
          <Panel
            title={`o_${row} = Σ_j W[${row}][j] · v_j`}
            note="Each term is weight × value. Masked weights are 0 and are left out."
          >
            {DIMS.map(
              (_, d) =>
                d <= dUpTo && (
                  <Expr key={d} label={`O[${row}][${d}]`} terms={terms(m, row, d)} result={fixed(m.output[row][d])} />
                ),
            )}
          </Panel>
        )}
        {row !== null && (
          <Panel title={`W[${row}]: how much ${quote(m.tokens[row])} takes from each visible token`}>
            <Bars
              max={1}
              items={m.weights[row].slice(0, row + 1).map((w, j) => ({
                key: j,
                label: `${j} ${m.tokens[j]}`,
                value: w,
                active: j === top,
              }))}
            />
          </Panel>
        )}
        <div className="x-row-wrap">
          <Matrix
            caption={row === null ? "V = X" : `V = X (rows 0 to ${row} are visible to row ${row})`}
            data={m.value}
            rowLabels={labels}
            colLabels={DIMS}
            state={vState}
          />
          <Matrix
            caption="O = W · V. Click a row."
            data={m.output}
            rowLabels={labels}
            colLabels={DIMS}
            state={oState}
            onCell={onCell}
          />
        </div>
      </div>
    );
  },
};
