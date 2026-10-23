import { useState } from "react";
import { Expr, Matrix, Panel, fixed } from "../../kit.jsx";
import { DIMS, NormExprs, cells, labelsOf, list, mat, moments, operand, quote } from "./shared.jsx";

const DETAIL = 2; // rows 0..DETAIL-1 get one frame per sub-step
// Sub-steps of one row: 0 add, 1 mean, 2 deviations, 3 variance, 4 std, 5 divide.
const SUB_LINE = [1, 2, 3, 4, 5, 6];

export default {
  id: "residual",
  source: [
    ["transformer", "layerNormSteps"],
    ["transformer", "EPSILON"],
    ["transformer", "attention"],
  ],
  code: [
    "for (let i = 0; i < n; i++) {",
    "  r = O[i].map((v, d) => v + X[i][d])  // residual: add the input back",
    "  mean = (r[0] + r[1] + r[2] + r[3]) / 4",
    "  dev = r.map(v => v - mean)",
    "  variance = (dev[0]² + dev[1]² + dev[2]² + dev[3]²) / 4",
    "  std = Math.sqrt(variance + 0.00001)  // EPSILON = 0.00001",
    "  H1[i] = dev.map(v => v / std)",
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
          ? "Two things happen to every row. First the block's input X is added back to the attention output O (a residual connection), so the token's own information is kept. Then the row is normalized: shifted to mean 0 and scaled to variance 1."
          : "There are no tokens, so there are no rows to add or normalize.",
        vars: { n },
        i: -1,
        sub: -1,
      },
    ];
    for (let i = 0; i < n; i++) {
      const o = m.output[i];
      const x = m.positions[i];
      const r = m.residual[i];
      const s = m.norm1Steps[i];
      const t = quote(m.tokens[i]);
      const check = moments(s.out);
      const adds = o.map((v, d) => `${fixed(v)} + ${operand(x[d])} = ${fixed(r[d])}`).join("; ");
      if (i < DETAIL) {
        const say = [
          `Row ${i}, ${t}: R[${i}] = O[${i}] + X[${i}], one addition per column: ${adds}.${i === 0 ? " Row 0 attends only to itself, so O[0] = X[0] and R[0] is twice X[0]." : ""}`,
          `The mean of the row: μ = (${r.map((v, d) => (d ? operand(v, 4) : fixed(v, 4))).join(" + ")}) / 4 = ${fixed(s.mean, 4)}.`,
          `Subtract μ from each entry: deviations [${list(s.deviations, 4)}]. They always add up to 0.`,
          `The variance is the mean of the squared deviations: σ² = (${s.deviations.map((v) => fixed(v * v, 4)).join(" + ")}) / 4 = ${fixed(s.variance, 4)}.`,
          `std = √(${fixed(s.variance, 4)} + 0.00001) = ${fixed(s.std, 4)}.${i === 0 ? " The 0.00001 keeps the division safe when all four entries are equal." : ""}`,
          `Divide each deviation by ${fixed(s.std, 4)}: H₁[${i}] = [${list(s.out)}]. This row has mean ${fixed(check.mean)} and variance ${fixed(check.variance, 6)}.`,
        ];
        say.forEach((text, sub) =>
          frames.push({
            phase: "Step by step",
            line: SUB_LINE[sub],
            say: text,
            vars: [
              { i, [`R[${i}]`]: r },
              { i, mean: s.mean },
              { i, mean: s.mean, dev: s.deviations },
              { i, variance: s.variance },
              { i, variance: s.variance, std: s.std },
              { i, std: s.std, [`H1[${i}]`]: s.out },
            ][sub],
            i,
            sub,
            hold: 0.85,
          }),
        );
      } else {
        frames.push({
          phase: "Every row",
          line: 1,
          say: `Row ${i}, ${t}: R[${i}] = O[${i}] + X[${i}] = [${list(r)}].`,
          vars: { i, [`R[${i}]`]: r },
          i,
          sub: 0,
          hold: 0.7,
        });
        frames.push({
          phase: "Every row",
          line: [2, 3, 4, 5, 6],
          say: `μ = ${fixed(s.mean, 4)}, σ² = ${fixed(s.variance, 4)}, std = ${fixed(s.std, 4)}, so H₁[${i}] = [${list(s.out)}].`,
          vars: { i, mean: s.mean, variance: s.variance, std: s.std, [`H1[${i}]`]: s.out },
          i,
          sub: 5,
          hold: 0.75,
        });
      }
    }
    const lastCheck = n ? moments(m.norm1[n - 1]) : null;
    frames.push({
      phase: "Done",
      line: 7,
      say: n
        ? `H₁ is ${n} × 4. Every row has mean 0 and variance about 1 (row ${n - 1}: mean ${fixed(lastCheck.mean)}, variance ${fixed(lastCheck.variance, 6)}; a little under 1 because of the 0.00001). There is no learned scale or shift here.`
        : "H₁ is empty: 0 × 4.",
      vars: { "H1.shape": `${n} × 4` },
      i: n,
      sub: 5,
    });
    return frames;
  },
  blocks({ data }) {
    const m = data.transformer;
    const labels = labelsOf(m.tokens);
    return [
      mat({ id: "R", title: "R = O + X", data: m.residual, rowLabels: labels, colLabels: DIMS }),
      mat({
        id: "LN1",
        title: "row stats",
        data: m.norm1Steps.map((s) => [s.mean, s.variance, s.std]),
        colLabels: ["μ", "σ²", "std"],
        heat: null,
        digits: 3,
        cellW: 1.25,
        beside: true,
      }),
      mat({ id: "H1", title: "H₁ = (R − μ) / std", data: m.norm1, rowLabels: labels, colLabels: DIMS, beside: true }),
    ];
  },
  output: "H1",
  links: () => [
    { from: "R", to: "LN1" },
    { from: "LN1", to: "H1" },
  ],
  state(frame, { data }) {
    const n = data.transformer.tokens.length;
    const i = frame.i;
    const sub = frame.sub;
    const live = i >= 0 && i < n;
    const every = frame.phase === "Every row";
    const at = (cols) => (live ? cells([i], cols) : []);
    const statDone = [1, 3, 4]; // sub-step that writes μ, σ², std
    const reads = {
      0: { O: at([0, 1, 2, 3]), X: at([0, 1, 2, 3]) },
      1: { R: at([0, 1, 2, 3]) },
      2: { R: at([0, 1, 2, 3]), LN1: at([0]) },
      3: { LN1: at([0]) },
      4: { LN1: at([1]) },
      5: every ? { R: at([0, 1, 2, 3]) } : { R: at([0, 1, 2, 3]), LN1: at([0, 2]) },
    }[sub] ?? {};
    const writes = {
      0: { R: at([0, 1, 2, 3]) },
      1: { LN1: at([0]) },
      3: { LN1: at([1]) },
      4: { LN1: at([2]) },
      5: every ? { LN1: at([0, 1, 2]), H1: at([0, 1, 2, 3]) } : { H1: at([0, 1, 2, 3]) },
    }[sub] ?? {};
    const done = (from) => (r, c) => r < i || i >= n || (r === i && sub >= from(c));
    return {
      O: { source: reads.O ?? [] },
      X: { source: reads.X ?? [] },
      R: { done: done(() => 0), active: writes.R ?? [], source: reads.R ?? [] },
      LN1: { done: done((c) => (every ? 5 : statDone[c])), active: writes.LN1 ?? [], source: reads.LN1 ?? [] },
      H1: { done: done(() => 5), active: writes.H1 ?? [] },
    };
  },
  math(frame, { data }) {
    const m = data.transformer;
    const i = frame.i;
    if (i < 0 || i >= m.tokens.length) return [];
    const r = m.residual[i];
    const s = m.norm1Steps[i];
    const adds = DIMS.map((_, d) => ({ label: `R[${i}][${d}]`, terms: [fixed(m.output[i][d]), fixed(m.positions[i][d])], result: fixed(r[d]) }));
    const mean = { label: "μ", terms: [`(${r.map((v) => fixed(v)).join(" + ")})`, "4"], op: "÷", result: fixed(s.mean, 4) };
    const devs = { label: "R − μ", terms: [s.deviations.map((v) => fixed(v, 4)).join(", ")] };
    const variance = { label: "σ²", terms: [`(${s.deviations.map((v) => fixed(v * v, 4)).join(" + ")})`, "4"], op: "÷", result: fixed(s.variance, 4) };
    const std = { label: "std", terms: [`√(${fixed(s.variance, 4)} + 0.00001)`], result: fixed(s.std, 4) };
    const outs = DIMS.map((_, d) => ({ label: `H₁[${i}][${d}]`, terms: [fixed(s.deviations[d], 4), fixed(s.std, 4)], op: "÷", result: fixed(s.out[d]) }));
    if (frame.phase === "Every row") return frame.sub === 0 ? adds : [mean, variance, std, ...outs];
    return [adds, [mean], [mean, devs], [variance], [std], outs][frame.sub] ?? [];
  },
  Stage({ ctx, frame, frames, seek }) {
    const m = ctx.data.transformer;
    const n = m.tokens.length;
    const [picked, setPicked] = useState(null);
    const labels = labelsOf(m.tokens);
    const finished = (r) => r < frame.i || (r === frame.i && frame.sub >= 5);
    const row =
      picked !== null && picked < n && finished(picked)
        ? picked
        : frame.i >= 0 && frame.i < n
          ? frame.i
          : frame.i >= n && n
            ? n - 1
            : null;
    const live = row === frame.i;
    const sub = live ? frame.sub : 5;
    const rowState = (r, from) => {
      if (r === row && !live) return "active";
      if (r < frame.i) return "done";
      if (r === frame.i && frame.sub >= from) return "active";
      return "pending";
    };
    const inState = (r) => (r === row ? "active" : "done");
    const onCell = (r) => {
      setPicked(r);
      seek(frames.findLastIndex((f) => f.i === r));
    };
    const check = row !== null ? moments(m.norm1[row]) : null;
    return (
      <div className="x-stack">
        {row !== null && (
          <Panel
            title={`Row ${row}, ${quote(m.tokens[row])}`}
            note={sub >= 5 ? `Check: the output has mean ${fixed(check.mean, 4)} and variance ${fixed(check.variance, 6)}.` : undefined}
          >
            {m.output[row].map((v, d) => (
              <Expr
                key={d}
                label={`R[${row}][${d}]`}
                terms={[fixed(v, 4), fixed(m.positions[row][d], 4)]}
                result={fixed(m.residual[row][d], 4)}
              />
            ))}
            {sub >= 1 && <NormExprs input={m.residual[row]} steps={m.norm1Steps[row]} upto={sub - 1} inName="R" outName="H₁" />}
          </Panel>
        )}
        <div className="x-row-wrap">
          <Matrix caption="O (attention output)" data={m.output} rowLabels={labels} colLabels={DIMS} state={inState} onCell={onCell} />
          <Matrix caption="X (block input)" data={m.positions} rowLabels={labels} colLabels={DIMS} state={inState} onCell={onCell} />
          <Matrix caption="R = O + X" data={m.residual} rowLabels={labels} colLabels={DIMS} state={(r) => rowState(r, 0)} onCell={onCell} />
          <Matrix caption="H₁ = LayerNorm(R). Click a row." data={m.norm1} rowLabels={labels} colLabels={DIMS} state={(r) => rowState(r, 5)} onCell={onCell} />
        </div>
      </div>
    );
  },
};
