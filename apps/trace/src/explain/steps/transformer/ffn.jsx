import { useState } from "react";
import { Expr, Matrix, Panel, fixed } from "../../kit.jsx";
import { B_1, D_FF, D_MODEL, GELU_C, W_1, W_2 } from "../../../engine/transformer.js";
import { DIMS, NormExprs, cells, labelsOf, list, mat, operand, paramsOf, quote, range, tunedSay, vec } from "./shared.jsx";

const HIDDEN = Array.from({ length: D_FF }, (_, k) => `k${k}`);
const HIDDEN_LABELS = Array.from({ length: D_FF }, (_, k) => `h${k}`);
// Stages of one row: 0 weights, 1 expand, 2 GELU, 3 project, 4 residual, 5 norm, 6 complete.
const COMPLETE = 6;

// GELU (tanh form), one operation at a time.
function geluParts(x) {
  const x3 = x ** 3;
  const inner = x + 0.044715 * x3;
  const u = GELU_C * inner;
  const t = Math.tanh(u);
  return { x3, inner, u, t, a: 0.5 * x * (1 + t) };
}
// One activation value, in words and as math terms, for GELU or ReLU.
function actLine(relu, h, k) {
  if (relu) {
    const a = Math.max(0, h);
    return {
      say: `ReLU of h[${k}] = ${fixed(h, 4)}: a[${k}] = max(0, ${fixed(h, 4)}) = ${fixed(a, 4)}.${h < 0 ? " A negative input is cut to exactly 0." : " A positive input passes through unchanged."}`,
      worked: `a[${k}] = max(0, ${fixed(h, 4)}) = ${fixed(a, 4)}`,
    };
  }
  const g = geluParts(h);
  return {
    say: `GELU of x = h[${k}] = ${fixed(h, 4)}: x³ = ${fixed(g.x3, 4)}; u = 0.7979 × (x + 0.044715·x³) = 0.7979 × ${operand(g.inner, 4)} = ${fixed(g.u, 4)}; tanh(u) = ${fixed(g.t, 4)}; a[${k}] = 0.5 × x × (1 + tanh(u)) = 0.5 × ${operand(h, 4)} × ${fixed(1 + g.t, 4)} = ${fixed(g.a, 4)}.`,
    worked: `a[${k}] = 0.5 × ${operand(h, 4)} × (1 + tanh(0.7979 × (${fixed(h, 4)} + 0.044715 × ${operand(g.x3, 4)}))) = 0.5 × ${operand(h, 4)} × ${fixed(1 + g.t, 4)} = ${fixed(g.a, 4)}`,
  };
}
const expandTerms = (x, k) => [fixed(B_1[k], 4), ...x.map((v, d) => `${fixed(v)}×${fixed(W_1[d][k])}`)];
const projectTerms = (a, d) => a.map((v, k) => `${fixed(v)}×${fixed(W_2[k][d])}`);

function rowOf(m, r, p) {
  return {
    relu: p?.activation === "relu",
    on: p?.residual ?? true,
    add: p?.residual === false ? Array(D_MODEL).fill(0) : m.norm1[r],
    x: m.norm1[r],
    h: m.hidden[r],
    a: m.activated[r],
    f: m.feedforward[r],
    res: m.residual2[r],
    ln: m.norm2Steps[r],
    out: m.norm2[r],
  };
}

export default {
  id: "feedforward",
  sourceLines: { 7: "const residual2 =", 8: "const norm2Steps =" },
  source: [
    ["transformer", "W_1"],
    ["transformer", "B_1"],
    ["transformer", "W_2"],
    ["transformer", "vecMat"],
    ["transformer", "gelu"],
    ["transformer", "layerNormSteps"],
  ],
  code: [
    "W_1[d][k] = sin((d + 1)(k + 1) · 0.79) · 0.4  // 4 × 8",
    "b_1[k] = sin(k) · 0.05  // 8",
    "W_2[k][d] = cos((k + 1)(d + 2) · 0.43) · 0.3  // 8 × 4",
    "for (const x of H1) {  // each row on its own",
    "  h = vecMat(x, W_1, b_1)  // h[k] = b_1[k] + Σ_d x[d]·W_1[d][k]  (4 → 8)",
    "  a = h.map(activate)  // gelu: 0.5·h·(1 + tanh(√(2/π)·(h + 0.044715·h³))); relu: max(0, h)",
    "  f = vecMat(a, W_2)  // f[d] = Σ_k a[k]·W_2[k][d]  (8 → 4)",
    "  r = f.map((v, d) => v + (residual ? x[d] : 0))  // residual",
    "  H2.push(layerNorm(r))  // mean 0, variance 1, as in Add & norm",
    "}",
  ],
  frames(ctx) {
    const m = ctx.data.transformer;
    const p = paramsOf(ctx);
    const n = m.tokens.length;
    const L = n - 1;
    const actName = p.activation === "relu" ? "ReLU" : "GELU";
    const frames = [];
    if (!n) {
      frames.push({
        phase: "Weights",
        line: [0, 1, 2],
        say: "There are no tokens, so no row goes through the feed-forward layer. The weights below are still fixed.",
        vars: { n },
        row: -1,
        stage: 0,
        k: -1,
      });
      frames.push({ phase: "Done", line: 9, say: "H₂ is empty: 0 × 4.", vars: { "H2.shape": "0 × 4" }, row: -1, stage: COMPLETE, k: -1 });
      return frames;
    }
    const R = rowOf(m, L, p);
    const t = quote(m.tokens[L]);
    frames.push({
      phase: "Weights",
      line: [0, 1, 2],
      say: `The feed-forward layer works on one row at a time; rows do not mix here. W₁ (4 × 8), b₁ (8 values) and W₂ (8 × 4) are fixed sin and cos formulas, not learned. The last row, ${L} ${t}, is worked through in full first.${tunedSay(p, ["activation", "residual", "merges", "context", "positional", "scaleScores", "causalMask"])}`,
      vars: { n, "x = H1[last]": R.x },
      row: L,
      stage: 0,
      k: -1,
    });
    for (let k = 0; k < D_FF; k++)
      frames.push({
        phase: "Expand 4 → 8",
        line: 4,
        say: `h[${k}] = b₁[${k}] + x0·W₁[0][${k}] + x1·W₁[1][${k}] + x2·W₁[2][${k}] + x3·W₁[3][${k}] = ${[operand(B_1[k], 4), ...R.x.map((v, d) => `${operand(v)}×${operand(W_1[d][k])}`)].join(" + ")} = ${fixed(R.h[k], 4)}.`,
        vars: { k, [`b_1[${k}]`]: B_1[k], [`h[${k}]`]: R.h[k] },
        row: L,
        stage: 1,
        k,
        hold: 0.75,
      });
    for (let k = 0; k < D_FF; k++) {
      const g = geluParts(R.h[k]);
      frames.push({
        phase: actName,
        line: 5,
        say: `${actLine(R.relu, R.h[k], k).say}${k === 0 ? (R.relu ? " ReLU keeps positive values and turns every negative one into 0." : " GELU leaves large positive values almost unchanged and pulls negative values toward 0.") : ""}`,
        vars: R.relu ? { k, [`h[${k}]`]: R.h[k], [`a[${k}]`]: R.a[k] } : { k, [`h[${k}]`]: R.h[k], u: g.u, "tanh(u)": g.t, [`a[${k}]`]: g.a },
        row: L,
        stage: 2,
        k,
        hold: 0.85,
      });
    }
    for (let d = 0; d < D_MODEL; d++)
      frames.push({
        phase: "Project 8 → 4",
        line: 6,
        say: `f[${d}] = Σ_k a[k]·W₂[k][${d}], eight products: ${R.a.map((v, j) => `${operand(v)}×${operand(W_2[j][d])}`).join(" + ")} = ${fixed(R.f[d], 4)}.`,
        vars: { d, [`f[${d}]`]: R.f[d] },
        row: L,
        stage: 3,
        k: d,
        hold: 0.8,
      });
    frames.push({
      phase: "Add & norm",
      line: 7,
      say: R.on
        ? `Residual again: r = f + x, one addition per column: ${R.f.map((v, d) => `${fixed(v)} + ${operand(R.x[d])} = ${fixed(R.res[d])}`).join("; ")}.`
        : `Residual connections are off, so x is not added back: r = f = [${list(R.res)}].`,
      vars: { f: R.f, x: R.x, r: R.res },
      row: L,
      stage: 4,
      k: 0,
    });
    const ln = R.ln;
    [
      `LayerNorm, as in Add & norm: μ = (${R.res.map((v, d) => (d ? operand(v, 4) : fixed(v, 4))).join(" + ")}) / 4 = ${fixed(ln.mean, 4)}.`,
      `Deviations r − μ = [${list(ln.deviations, 4)}].`,
      `σ² = (${ln.deviations.map((v) => fixed(v * v, 4)).join(" + ")}) / 4 = ${fixed(ln.variance, 4)}.`,
      `std = √(${fixed(ln.variance, 4)} + 0.00001) = ${fixed(ln.std, 4)}.`,
      `H₂[${L}] = deviations ÷ ${fixed(ln.std, 4)} = [${list(R.out)}].`,
    ].forEach((say, k) =>
      frames.push({
        phase: "Add & norm",
        line: 8,
        say,
        vars: [{ mean: ln.mean }, { dev: ln.deviations }, { variance: ln.variance }, { std: ln.std }, { [`H2[${L}]`]: R.out }][k],
        row: L,
        stage: 5,
        k,
        hold: 0.8,
      }),
    );
    for (let i = 0; i < n; i++) {
      const Ri = rowOf(m, i, p);
      frames.push({
        phase: "Every row",
        line: [3, 4, 5, 6, 7, 8],
        say: `Row ${i}, ${quote(m.tokens[i])}: x = [${list(Ri.x)}] → h = x·W₁ + b₁ (8 values) → a = ${actName}(h) → f = a·W₂ = [${list(Ri.f)}] → ${Ri.on ? "r = f + x" : "r = f"} → H₂[${i}] = [${list(Ri.out)}].`,
        vars: { i, [`H1[${i}]`]: Ri.x, [`H2[${i}]`]: Ri.out },
        row: i,
        stage: COMPLETE,
        k: -1,
        hold: 0.75,
      });
    }
    frames.push({
      phase: "Done",
      line: 9,
      say: `H₂ is ${n} × 4, the output of the block. Only its last row, [${list(R.out)}], is used to predict the next token. Click a row of H₁ or H₂ to see its full computation.`,
      vars: { "H2.shape": `${n} × 4`, [`H2[${L}]`]: R.out },
      row: L,
      stage: COMPLETE,
      k: -1,
    });
    return frames;
  },
  blocks(ctx) {
    const m = ctx.data.transformer;
    const p = paramsOf(ctx);
    const relu = p.activation === "relu";
    const actName = relu ? "ReLU" : "GELU";
    const labels = labelsOf(m.tokens);
    const tok = (r) => quote(m.tokens[r]);
    return [
      mat({
        id: "Hid",
        title: "h = H₁·W₁ + b₁  (4 → 8)",
        data: m.hidden,
        rowLabels: labels,
        colLabels: HIDDEN_LABELS,
        cellW: 1.15,
        explain: (r, c) =>
          m.hidden[r]?.[c] === undefined
            ? null
            : {
                meaning: `Hidden unit ${c} for ${tok(r)}: one of 8 mixes of its 4 numbers, before the bend.`,
                formula: "h[k] = b₁[k] + Σ_d x[d] × W₁[d][k]",
                worked: `h[${c}] = ${[operand(B_1[c], 4), ...m.norm1[r].map((v, d) => `${operand(v)}×${operand(W_1[d][c])}`)].join(" + ")} = ${fixed(m.hidden[r][c], 4)}`,
              },
      }),
      mat({
        id: "Act",
        title: `a = ${actName}(h)`,
        data: m.activated,
        colLabels: HIDDEN_LABELS,
        cellW: 1.15,
        beside: true,
        explain: (r, c) =>
          m.activated[r]?.[c] === undefined
            ? null
            : {
                meaning: `Hidden unit ${c} for ${tok(r)} after the ${actName} bend.`,
                formula: relu ? "a = max(0, h)" : "a = 0.5·h·(1 + tanh(√(2/π)·(h + 0.044715·h³)))",
                worked: actLine(relu, m.hidden[r][c], c).worked,
              },
      }),
      mat({
        id: "F",
        title: "f = a·W₂  (8 → 4)",
        data: m.feedforward,
        colLabels: DIMS,
        cellW: 1.3,
        beside: true,
        explain: (r, c) =>
          m.feedforward[r]?.[c] === undefined
            ? null
            : {
                meaning: `Dimension ${c} of what the feed-forward layer adds for ${tok(r)}: the 8 hidden units squeezed back to 4.`,
                formula: "f[d] = Σ_k a[k] × W₂[k][d]",
                worked: `f[${c}] = ${m.activated[r].map((v, k) => `${operand(v)}×${operand(W_2[k][c])}`).join(" + ")} = ${fixed(m.feedforward[r][c], 4)}`,
              },
      }),
      mat({
        id: "H2",
        title: p.residual ? "H₂ = LN(f + H₁)" : "H₂ = LN(f)  (residual off)",
        data: m.norm2,
        rowLabels: labels,
        colLabels: DIMS,
        beside: true,
        explain: (r, c) => {
          const ln = m.norm2Steps[r];
          if (!ln || ln.out[c] === undefined) return null;
          const res = m.residual2[r][c];
          return {
            meaning: `Dimension ${c} of ${tok(r)} at the end of the block${r === m.tokens.length - 1 ? "; this last row predicts the next token" : ""}.`,
            formula: p.residual ? "r = f + H₁; H₂ = (r − μ) / std" : "r = f (residual off); H₂ = (r − μ) / std",
            worked: `r[${c}] = ${fixed(m.feedforward[r][c], 4)}${p.residual ? ` + ${operand(m.norm1[r][c], 4)}` : ""} = ${fixed(res, 4)}; H₂[${r}][${c}] = (${fixed(res, 4)} − ${operand(ln.mean, 4)}) / ${fixed(ln.std, 4)} = ${fixed(ln.out[c])}`,
          };
        },
      }),
      mat({
        id: "W1",
        title: "W₁ (4 × 8) and b₁",
        data: [...W_1, B_1],
        rowLabels: [...DIMS, "b₁"],
        colLabels: HIDDEN_LABELS,
        cellW: 1.15,
        explain: (r, c) =>
          r > 4 || c >= D_FF
            ? null
            : r === 4
              ? { meaning: `The bias added to hidden unit ${c}, whatever the input. Fixed, not learned.`, formula: "b₁[k] = sin(k) × 0.05", worked: `b₁[${c}] = sin(${c}) × 0.05 = ${fixed(B_1[c], 4)}` }
              : {
                  meaning: `How much input dimension ${r} feeds hidden unit ${c}. Fixed, not learned.`,
                  formula: "W₁[d][k] = sin((d + 1)(k + 1) × 0.79) × 0.4",
                  worked: `W₁[${r}][${c}] = sin(${r + 1} × ${c + 1} × 0.79) × 0.4 = ${fixed(W_1[r][c], 4)}`,
                },
      }),
      mat({
        id: "W2",
        title: "W₂ (8 × 4)",
        data: W_2,
        rowLabels: HIDDEN_LABELS,
        colLabels: DIMS,
        cellW: 1.3,
        beside: true,
        explain: (r, c) =>
          W_2[r]?.[c] === undefined
            ? null
            : {
                meaning: `How much hidden unit ${r} feeds output dimension ${c}. Fixed, not learned.`,
                formula: "W₂[k][d] = cos((k + 1)(d + 2) × 0.43) × 0.3",
                worked: `W₂[${r}][${c}] = cos(${r + 1} × ${c + 2} × 0.43) × 0.3 = ${fixed(W_2[r][c], 4)}`,
              },
      }),
    ];
  },
  output: "H2",
  links: () => [
    { from: "Hid", to: "Act" },
    { from: "Act", to: "F" },
    { from: "F", to: "H2" },
  ],
  state(frame, { data }) {
    const n = data.transformer.tokens.length;
    const L = n - 1;
    const { stage, k } = frame;
    const r = frame.row;
    const live = r >= 0 && r < n;
    const full = range(0, 8);
    const filled = (st, ready) => (row, c) =>
      (row === L && (stage > st || (stage === st && ready(c)))) || (stage >= COMPLETE && row <= r);
    const at = (rows, cols) => (live ? cells(rows, cols) : []);
    const map = {
      0: { H1: at([r], DIMS.map((_, d) => d)) },
      1: { H1: at([r], [0, 1, 2, 3]), W1: at(range(0, 5), [k]), active: { Hid: at([r], [k]) } },
      2: { Hid: at([r], [k]), active: { Act: at([r], [k]) } },
      3: { Act: at([r], full), W2: at(full, [k]), active: { F: at([r], [k]) } },
      4: { H1: at([r], [0, 1, 2, 3]), F: at([r], [0, 1, 2, 3]) },
      5: { H1: at([r], [0, 1, 2, 3]), F: at([r], [0, 1, 2, 3]), active: k >= 4 ? { H2: at([r], [0, 1, 2, 3]) } : {} },
      6: {
        H1: at([r], [0, 1, 2, 3]),
        active: { Hid: at([r], full), Act: at([r], full), F: at([r], [0, 1, 2, 3]), H2: at([r], [0, 1, 2, 3]) },
      },
    }[stage] ?? {};
    const active = map.active ?? {};
    return {
      H1: { source: map.H1 ?? [] },
      W1: { source: map.W1 ?? [] },
      W2: { source: map.W2 ?? [] },
      Hid: { done: filled(1, (c) => c <= k), active: active.Hid ?? [], source: map.Hid ?? [] },
      Act: { done: filled(2, (c) => c <= k), active: active.Act ?? [], source: map.Act ?? [] },
      F: { done: filled(3, (c) => c <= k), active: active.F ?? [], source: map.F ?? [] },
      H2: { done: filled(5, () => k >= 4), active: active.H2 ?? [] },
    };
  },
  math(frame, ctx) {
    const m = ctx.data.transformer;
    const r = frame.row;
    if (r < 0 || r >= m.tokens.length) return [];
    const R = rowOf(m, r, paramsOf(ctx));
    const { stage, k } = frame;
    if (stage === 0) return [{ label: `x = H₁[${r}]`, terms: [vec(R.x)] }];
    if (stage === 1) return [{ label: `h[${k}]`, terms: expandTerms(R.x, k), result: fixed(R.h[k], 4) }];
    if (stage === 2 && R.relu) return [{ label: `a[${k}]`, terms: [`max(0, ${fixed(R.h[k], 4)})`], result: fixed(R.a[k], 4) }];
    if (stage === 2) {
      const g = geluParts(R.h[k]);
      return [
        { label: "x³", terms: [`${fixed(R.h[k], 4)}³`], result: fixed(g.x3, 4) },
        { label: "u", terms: ["0.7979", `(${fixed(R.h[k], 4)} + 0.044715×${fixed(g.x3, 4)})`], op: "×", result: fixed(g.u, 4) },
        { label: "tanh(u)", terms: [`tanh(${fixed(g.u, 4)})`], result: fixed(g.t, 4) },
        { label: `a[${k}]`, terms: ["0.5", fixed(R.h[k], 4), `(1 + ${fixed(g.t, 4)})`], op: "×", result: fixed(g.a, 4) },
      ];
    }
    if (stage === 3) return [{ label: `f[${k}]`, terms: projectTerms(R.a, k), result: fixed(R.f[k], 4) }];
    if (stage === 4)
      return DIMS.map((_, d) => ({ label: `r[${d}]`, terms: [fixed(R.f[d], 4), fixed(R.add[d], 4)], result: fixed(R.res[d], 4) }));
    const ln = R.ln;
    if (stage === 5)
      return [
        [{ label: "μ", terms: [`(${R.res.map((v) => fixed(v, 4)).join(" + ")})`, "4"], op: "÷", result: fixed(ln.mean, 4) }],
        [{ label: "r − μ", terms: [ln.deviations.map((v) => fixed(v, 4)).join(", ")] }],
        [{ label: "σ²", terms: [`(${ln.deviations.map((v) => fixed(v * v, 4)).join(" + ")})`, "4"], op: "÷", result: fixed(ln.variance, 4) }],
        [{ label: "std", terms: [`√(${fixed(ln.variance, 4)} + 0.00001)`], result: fixed(ln.std, 4) }],
        DIMS.map((_, d) => ({ label: `H₂[${r}][${d}]`, terms: [fixed(ln.deviations[d], 4), fixed(ln.std, 4)], op: "÷", result: fixed(R.out[d]) })),
      ][k] ?? [];
    return [
      { label: `x = H₁[${r}]`, terms: [vec(R.x)] },
      { label: "h = x·W₁ + b₁", terms: [vec(R.h)] },
      { label: R.relu ? "a = ReLU(h)" : "a = GELU(h)", terms: [vec(R.a)] },
      { label: "f = a·W₂", terms: [vec(R.f)] },
      { label: R.on ? "r = f + x" : "r = f", terms: [vec(R.res)] },
      { label: `H₂[${r}] = LN(r)`, terms: [vec(R.out)] },
    ];
  },
  Stage({ ctx, frame, frames, seek }) {
    const m = ctx.data.transformer;
    const n = m.tokens.length;
    const [picked, setPicked] = useState(null);
    const labels = labelsOf(m.tokens);
    const L = n - 1;
    const complete = frame.stage >= COMPLETE;
    const row =
      complete && picked !== null && picked < n && (picked <= frame.row || picked === L) ? picked : frame.row;
    const stage = row === frame.row ? frame.stage : COMPLETE;
    const k = row === frame.row ? frame.k : -1;
    const R = row >= 0 && row < n ? rowOf(m, row, paramsOf(ctx)) : null;
    const at = (st) => (c) => (stage > st ? "done" : stage < st ? "pending" : c < k ? "done" : c === k ? "active" : "pending");
    const whole = (st, ready = true) => () => (stage > st ? "done" : stage === st && ready ? "active" : "pending");
    const onCell = (r) => {
      setPicked(r);
      seek(frames.findIndex((f) => f.phase === "Every row" && f.row === r));
    };
    const h2State = (r) => {
      if (r === row) return stage >= COMPLETE || (stage === 5 && k >= 4) ? "active" : "pending";
      if (r === L && frame.stage >= COMPLETE) return "done";
      return frame.stage >= COMPLETE && r <= frame.row ? "done" : "pending";
    };
    const vector = (caption, values, cols, state) => (
      <Matrix className="t-vector" caption={caption} data={[values]} colLabels={cols} state={(_, c) => state(c)} />
    );
    return (
      <div className="x-stack">
        {R && (
          <>
            <div className="x-row-wrap">
              {vector(`x = H₁[${row}]`, R.x, DIMS, () => "done")}
              {vector("h = x·W₁ + b₁", R.h, HIDDEN, at(1))}
              {vector(R.relu ? "a = ReLU(h)" : "a = GELU(h)", R.a, HIDDEN, at(2))}
              {vector("f = a·W₂", R.f, DIMS, at(3))}
              {vector(R.on ? "r = f + x" : "r = f", R.res, DIMS, whole(4))}
              {vector(`H₂[${row}] = LN(r)`, R.out, DIMS, whole(5, stage > 5 || k >= 4))}
            </div>
            <Detail R={R} row={row} token={m.tokens[row]} stage={stage} k={k} />
          </>
        )}
        <div className="x-row-wrap">
          <Matrix
            caption="W₁ (4 × 8)"
            data={W_1}
            rowLabels={DIMS}
            colLabels={HIDDEN}
            state={(_, c) => (stage === 1 && c === k ? "active" : "done")}
          />
          <Matrix
            caption="b₁"
            data={[B_1]}
            colLabels={HIDDEN}
            state={(_, c) => (stage === 1 && c === k ? "active" : "done")}
          />
          <Matrix
            caption="W₂ (8 × 4)"
            data={W_2}
            rowLabels={HIDDEN}
            colLabels={DIMS}
            state={(_, c) => (stage === 3 && c === k ? "active" : "done")}
          />
        </div>
        <div className="x-row-wrap">
          <Matrix
            caption="H₁ (input). Click a row."
            data={m.norm1}
            rowLabels={labels}
            colLabels={DIMS}
            state={(r) => (r === row ? "active" : "done")}
            onCell={onCell}
          />
          <Matrix
            caption="H₂ (output). Click a row."
            data={m.norm2}
            rowLabels={labels}
            colLabels={DIMS}
            state={h2State}
            onCell={onCell}
          />
        </div>
      </div>
    );
  },
};

// The arithmetic for one row, up to the current stage (all of it when complete).
function Detail({ R, row, token, stage, k }) {
  // While stepping, only the current stage's lines; every line once complete.
  const upto = (st) => (stage >= COMPLETE ? Infinity : stage === st ? k : -1);
  const show = (st) => stage >= COMPLETE || stage === st;
  const g = stage === 2 && k >= 0 && !R.relu ? geluParts(R.h[k]) : null;
  if (stage === 0)
    return (
      <Panel title={`Row ${row}, ${quote(token)}`} note="Next: eight sums of four products plus a bias, one per hidden unit.">
        <Expr label="x" terms={[`[${list(R.x, 4)}]`]} />
      </Panel>
    );
  return (
    <Panel title={`Row ${row}, ${quote(token)}${stage >= COMPLETE ? ": every operation" : ""}`}>
      {R.h.map(
        (v, j) => j <= upto(1) && <Expr key={`h${j}`} label={`h[${j}]`} terms={expandTerms(R.x, j)} result={fixed(v, 4)} />,
      )}
      {g && (
        <>
          <Expr label="x³" terms={[`${fixed(R.h[k], 4)}³`]} result={fixed(g.x3, 4)} />
          <Expr label="x + 0.044715·x³" terms={[fixed(R.h[k], 4), `0.044715 × ${fixed(g.x3, 4)}`]} result={fixed(g.inner, 4)} />
          <Expr label="u = √(2/π) · …" terms={["0.7979", fixed(g.inner, 4)]} op="×" result={fixed(g.u, 4)} />
          <Expr label="tanh(u)" terms={[`tanh(${fixed(g.u, 4)})`]} result={fixed(g.t, 4)} />
        </>
      )}
      {R.a.map(
        (v, j) =>
          j <= upto(2) &&
          (R.relu ? (
            <Expr key={`a${j}`} label={`a[${j}]`} terms={[`max(0, ${fixed(R.h[j], 4)})`]} result={fixed(v, 4)} />
          ) : (
            <Expr
              key={`a${j}`}
              label={`a[${j}]`}
              op="×"
              terms={["0.5", fixed(R.h[j], 4), `(1 + ${fixed(geluParts(R.h[j]).t, 4)})`]}
              result={fixed(v, 4)}
            />
          )),
      )}
      {R.f.map(
        (v, d) => d <= upto(3) && <Expr key={`f${d}`} label={`f[${d}]`} terms={projectTerms(R.a, d)} result={fixed(v, 4)} />,
      )}
      {show(4) &&
        R.res.map((v, d) => (
          <Expr key={`r${d}`} label={`r[${d}]`} terms={[fixed(R.f[d], 4), fixed(R.add[d], 4)]} result={fixed(v, 4)} />
        ))}
      {show(5) && <NormExprs input={R.res} steps={R.ln} upto={stage > 5 ? 4 : k} inName="r" outName="H₂" />}
    </Panel>
  );
}
