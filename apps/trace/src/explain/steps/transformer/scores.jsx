import { useState } from "react";
import { Expr, Matrix, Panel, fixed } from "../../kit.jsx";
import { W_K, W_Q, SCALE } from "../../../engine/transformer.js";
import { all, matrixBlock, row } from "../../../map/blocks.js";
import { operand, paramsOf, quote, tunedSay } from "./shared.jsx";

const DIMS = ["d0", "d1", "d2", "d3"];
const CELL_ROWS = 2; // rows 0..CELL_ROWS-1 get one frame per cell
// The divisor in force: √4 = 2, or 1 when scaling is off.
const scaleOf = (ctx) => (paramsOf(ctx).scaleScores ? SCALE : 1);
const dotTerms = (m, i, j, digits = 3) => m.query[i].map((v, d) => `${operand(v, digits)}×${operand(m.key[j][d], digits)}`);

// q[j] = Σ_d x[d]·W[d][j]; zero weights are left out of the printed sum.
function projection(x, W, j, name) {
  const terms = x
    .map((v, d) => (W[d][j] ? `${fixed(v)}×${fixed(W[d][j], 1)}` : null))
    .filter(Boolean);
  return { label: `${name}[${j}]`, terms };
}

export default {
  id: "qk",
  source: [
    ["transformer", "W_Q"],
    ["transformer", "W_K"],
    ["transformer", "vecMat"],
    ["transformer", "attention"],
  ],
  code: [
    "// X: one row per token (embedding + position), n × 4",
    "Q = X.map(x => vecMat(x, W_Q))        // q[j] = Σ_d x[d] · W_Q[d][j]",
    "K = X.map(x => vecMat(x, W_K))",
    "for (let i = 0; i < n; i++)            // query token",
    "  for (let j = 0; j < n; j++)          // key token",
    "    S[i][j] = dot(Q[i], K[j]) / scale  // scale = scaleScores ? √4 = 2 : 1",
  ],
  frames(ctx) {
    const m = ctx.data.transformer;
    const n = m.tokens.length;
    const p = paramsOf(ctx);
    const scale = scaleOf(ctx);
    const frames = [
      {
        phase: "Setup",
        line: 0,
        say: `X has ${n} rows (one per token) and 4 columns. W_Q and W_K are fixed 4 × 4 matrices: each output column mixes two input columns.${
          p.scaleScores ? "" : " Scaling is off, so each score is the raw dot product, not divided by √4 = 2."
        }${tunedSay(p, ["merges", "context", "positional"])}`,
        vars: { n, d: 4 },
        proj: -1,
        i: -1,
        j: -1,
      },
    ];
    m.tokens.forEach((t, i) =>
      frames.push({
        phase: "Project",
        line: [1, 2],
        say: `Row ${i} (“${t}”): multiply x by W_Q to get its query q and by W_K to get its key k. Each entry is a sum of input × weight.`,
        vars: { i, token: t, x: m.positions[i].map((v) => +v.toFixed(3)), q: m.query[i].map((v) => +v.toFixed(3)), k: m.key[i].map((v) => +v.toFixed(3)) },
        proj: i,
        i: -1,
        j: -1,
        hold: 0.9,
      }),
    );
    for (let i = 0; i < n; i++) {
      if (i < CELL_ROWS)
        for (let j = 0; j < n; j++) {
          const raw = m.scores[i][j] * scale;
          frames.push({
            phase: "Score",
            line: [3, 4, 5],
            say: `S[${i}][${j}]: dot the query of “${m.tokens[i]}” with the key of “${m.tokens[j]}” (four products, summed) = ${fixed(raw)}${p.scaleScores ? `, then ÷ 2 = ${fixed(m.scores[i][j])}` : `. Scaling is off, so S[${i}][${j}] = ${fixed(m.scores[i][j])}`}.`,
            vars: { i, j, "dot(Q[i], K[j])": +raw.toFixed(4), "S[i][j]": +m.scores[i][j].toFixed(4) },
            proj: n,
            i,
            j,
            hold: 0.75,
          });
        }
      else
        frames.push({
          phase: "Score",
          line: [3, 4, 5],
          say: `Row ${i} (“${m.tokens[i]}”): the same ${n} dot products against every key. Click any cell to see its four products.`,
          vars: { i, "S[i]": m.scores[i].map((v) => +v.toFixed(3)) },
          proj: n,
          i,
          j: n - 1,
          hold: 0.8,
        });
    }
    frames.push({
      phase: "Done",
      line: 5,
      say: `S is ${n} × ${n}. Row i holds how strongly token i's query lines up with every key. Scores to later tokens exist here; ${p.causalMask ? "the next step masks them" : "the causal mask is off, so the next step keeps them"}.`,
      vars: { "S.shape": `${n} × ${n}` },
      proj: n,
      i: n,
      j: -1,
    });
    return frames;
  },
  blocks(ctx) {
    const m = ctx.data.transformer;
    const on = paramsOf(ctx).scaleScores;
    const scale = scaleOf(ctx);
    const labels = m.tokens.map((t, i) => `${i} ${t}`);
    const q = ["0", "1", "2", "3"];
    const weight = (W, name, what) => (r, c) =>
      W[r]?.[c] === undefined
        ? null
        : {
            meaning: `How much input dimension ${r} feeds column ${c} of each token's ${what}. Fixed, not learned.`,
            formula: `${what === "query" ? "q" : "k"}[j] = Σ_d x[d] × ${name}[d][j]`,
            worked: `${name}[${r}][${c}] = ${fixed(W[r][c], 1)}${W[r][c] ? "" : ", so x" + r + " does not reach this column"}`,
          };
    const projected = (M, W, name, what) => (r, c) => {
      if (M[r]?.[c] === undefined) return null;
      const x = m.positions[r];
      const terms = x.map((v, d) => (W[d][c] ? `${operand(v)}×${operand(W[d][c], 1)}` : null)).filter(Boolean);
      return {
        meaning: `Column ${c} of the ${what} of ${quote(m.tokens[r])}: ${what === "query" ? "what this token is looking for" : "what this token offers to others"}.`,
        formula: `${name}[j] = Σ_d x[d] × W_${name.toUpperCase()}[d][j]`,
        worked: `${name}[${c}] = ${terms.join(" + ")} = ${fixed(M[r][c])}`,
      };
    };
    return [
      matrixBlock({ id: "WQ", title: "W_Q (4 × 4)", data: W_Q, rowLabels: DIMS, colLabels: q, digits: 1, explain: weight(W_Q, "W_Q", "query") }),
      matrixBlock({ id: "WK", title: "W_K (4 × 4)", data: W_K, rowLabels: DIMS, colLabels: q, digits: 1, beside: true, explain: weight(W_K, "W_K", "key") }),
      matrixBlock({ id: "Q", title: "Q = X · W_Q", data: m.query, rowLabels: labels, colLabels: DIMS, explain: projected(m.query, W_Q, "q", "query") }),
      matrixBlock({ id: "K", title: "K = X · W_K", data: m.key, rowLabels: labels, colLabels: DIMS, beside: true, explain: projected(m.key, W_K, "k", "key") }),
      matrixBlock({
        id: "S",
        title: on ? "S = Q · Kᵀ / √4   (row: query token, column: key token)" : "S = Q · Kᵀ, unscaled   (row: query token, column: key token)",
        data: m.scores,
        rowLabels: labels,
        colLabels: m.tokens.map((_, i) => String(i)),
        cellW: 1.2,
        explain: (r, c) => {
          if (m.scores[r]?.[c] === undefined) return null;
          const raw = m.scores[r][c] * scale;
          return {
            meaning: `How strongly ${quote(m.tokens[r])} (query, row ${r}) lines up with ${quote(m.tokens[c])} (key, column ${c}), before softmax.`,
            formula: on ? "score = q · k / √4" : "score = q · k (scaling off)",
            worked: on
              ? `S[${r}][${c}] = (${dotTerms(m, r, c, 2).join(" + ")}) / 2 = ${fixed(raw, 4)} / 2 = ${fixed(m.scores[r][c], 4)}`
              : `S[${r}][${c}] = ${dotTerms(m, r, c, 2).join(" + ")} = ${fixed(m.scores[r][c], 4)}`,
          };
        },
      }),
    ];
  },
  output: "S",
  state(frame, { data }) {
    const m = data.transformer;
    const n = m.tokens.length;
    const p = frame.proj >= 0 && frame.proj < n ? frame.proj : null;
    const projected = (r) => frame.proj >= n || (frame.proj >= 0 && r <= frame.proj);
    const scoring = frame.proj >= n && frame.i >= 0 && frame.i < n;
    const perCell = scoring && frame.i < CELL_ROWS;
    return {
      X: { source: p !== null ? row(p, 4) : [] },
      WQ: { source: p !== null ? all(4, 4) : [] },
      WK: { source: p !== null ? all(4, 4) : [] },
      Q: {
        done: projected,
        active: p !== null ? row(p, 4) : [],
        source: scoring ? row(frame.i, 4) : [],
      },
      K: {
        done: projected,
        active: p !== null ? row(p, 4) : [],
        source: perCell ? row(frame.j, 4) : scoring ? all(n, 4) : [],
      },
      S: {
        done: (r, c) => frame.proj >= n && (r < frame.i || (r === frame.i && c <= frame.j)),
        active: perCell ? [[frame.i, frame.j]] : scoring ? row(frame.i, n) : [],
      },
    };
  },
  math(frame, ctx) {
    const m = ctx.data.transformer;
    const n = m.tokens.length;
    const scale = scaleOf(ctx);
    if (frame.proj >= 0 && frame.proj < n) {
      const x = m.positions[frame.proj];
      return [0, 1, 2, 3].flatMap((j) => {
        const q = projection(x, W_Q, j, "q");
        const k = projection(x, W_K, j, "k");
        return [
          { label: q.label, terms: q.terms, result: fixed(m.query[frame.proj][j]) },
          { label: k.label, terms: k.terms, result: fixed(m.key[frame.proj][j]) },
        ];
      });
    }
    if (frame.i < 0 || frame.i >= n) return [];
    const j = frame.i < CELL_ROWS ? frame.j : frame.i;
    const raw = m.scores[frame.i][j] * scale;
    return [
      {
        label: `Q[${frame.i}]·K[${j}]`,
        terms: m.query[frame.i].map((v, d) => `${fixed(v, 2)}×${fixed(m.key[j][d], 2)}`),
        result: fixed(raw, 4),
      },
      scale === 1
        ? { label: `S[${frame.i}][${j}] (not scaled)`, terms: [fixed(raw, 4)], result: fixed(m.scores[frame.i][j], 4) }
        : { label: `S[${frame.i}][${j}]`, terms: [fixed(raw, 4), "2"], op: "÷", result: fixed(m.scores[frame.i][j], 4) },
    ];
  },
  Stage({ ctx, frame, frames, seek }) {
    const m = ctx.data.transformer;
    const n = m.tokens.length;
    const scale = scaleOf(ctx);
    const [picked, setPicked] = useState(null);
    const labels = m.tokens.map((t, i) => `${i} ${t}`);
    const p = frame.proj >= 0 && frame.proj < n ? frame.proj : null;
    const computed = (r, c) => r < frame.i || (r === frame.i && c <= frame.j);
    const cell =
      picked && computed(...picked)
        ? picked
        : frame.i >= 0 && frame.i < n
          ? [frame.i, frame.i < CELL_ROWS ? frame.j : frame.i]
          : null;
    const projState = (r) =>
      frame.proj < 0 ? "pending" : p === null ? "done" : r < p ? "done" : r === p ? "active" : "pending";
    const pick = (row) => (r) => {
      const s = projState(r);
      return s === "done" && cell && r === cell[row] ? "active" : s;
    };
    return (
      <div className="x-stack">
        <div className="x-row-wrap">
          <Matrix
            caption="X (embedding + position)"
            data={m.positions}
            rowLabels={labels}
            colLabels={DIMS}
            state={(r) => (r === p ? "active" : "done")}
          />
          <Matrix caption="W_Q" data={W_Q} rowLabels={DIMS} colLabels={["q0", "q1", "q2", "q3"]} digits={1} />
          <Matrix caption="W_K" data={W_K} rowLabels={DIMS} colLabels={["k0", "k1", "k2", "k3"]} digits={1} />
        </div>
        {p !== null && (
          <Panel title={`Row ${p}: q = x · W_Q and k = x · W_K`} note="Terms with a zero weight are left out of each sum.">
            {[0, 1, 2, 3].map((j) => {
              const e = projection(m.positions[p], W_Q, j, "q");
              return <Expr key={`q${j}`} label={e.label} terms={e.terms} result={fixed(m.query[p][j])} />;
            })}
            {[0, 1, 2, 3].map((j) => {
              const e = projection(m.positions[p], W_K, j, "k");
              return <Expr key={`k${j}`} label={e.label} terms={e.terms} result={fixed(m.key[p][j])} />;
            })}
          </Panel>
        )}
        <div className="x-row-wrap">
          <Matrix
            caption="Q = X · W_Q"
            data={m.query}
            rowLabels={labels}
            colLabels={DIMS}
            state={pick(0)}
          />
          <Matrix
            caption="K = X · W_K"
            data={m.key}
            rowLabels={labels}
            colLabels={DIMS}
            state={pick(1)}
          />
        </div>
        {frame.proj >= n && (
          <>
            <Matrix
              className="is-square"
              caption={`S = Q · Kᵀ${scale === 1 ? ", unscaled" : " / √4"} (rows: query token, columns: key token). Click a cell.`}
              data={m.scores}
              rowLabels={labels}
              colLabels={m.tokens.map((_, i) => i)}
              state={(r, c) =>
                cell && r === cell[0] && c === cell[1] ? "active" : computed(r, c) ? "done" : "pending"
              }
              onCell={(r, c) => {
                setPicked([r, c]);
                const exact = frames.findIndex((f) => f.i === r && f.j === c);
                seek(exact >= 0 ? exact : frames.findIndex((f) => f.i === r));
              }}
            />
            {cell && (
              <Panel title={`S[${cell[0]}][${cell[1]}]: “${m.tokens[cell[0]]}” → “${m.tokens[cell[1]]}”`}>
                <Expr
                  label="Q[i] · K[j]"
                  terms={m.query[cell[0]].map((q, d) => `${fixed(q)}×${fixed(m.key[cell[1]][d])}`)}
                  result={fixed(m.scores[cell[0]][cell[1]] * scale, 4)}
                />
                {scale !== 1 && (
                  <Expr label="÷ √4" terms={[fixed(m.scores[cell[0]][cell[1]] * scale, 4), "2"]} op="÷" result={fixed(m.scores[cell[0]][cell[1]], 4)} />
                )}
              </Panel>
            )}
          </>
        )}
      </div>
    );
  },
};
