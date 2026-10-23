import { useState } from "react";
import { Expr, Matrix, Panel, Table, fixed } from "../../kit.jsx";
import { D_MODEL } from "../../../engine/transformer.js";
import { row } from "../../../map/blocks.js";
import { DIMS, labelsOf, list, mat, operand, quote } from "./shared.jsx";

const DETAIL = 3; // positions 0..DETAIL-1 get one frame per dimension

// The pieces of positionRow(p) for one dimension d.
function parts(p, d) {
  const k = Math.floor(d / 2);
  const denom = 10000 ** ((2 * k) / D_MODEL);
  const angle = p / denom;
  const fn = d % 2 ? "cos" : "sin";
  return { k, denom, angle, fn, value: fn === "cos" ? Math.cos(angle) : Math.sin(angle) };
}

export default {
  id: "position",
  source: [
    ["transformer", "positionRow"],
    ["transformer", "attention"],
  ],
  code: [
    "const positionRow = (p) => [0, 1, 2, 3].map(d => {",
    "  const k = Math.floor(d / 2)  // d0, d1 → 0; d2, d3 → 1",
    "  const angle = p / 10000 ** (2 * k / 4)  // k = 0: p / 1; k = 1: p / 100",
    "  return d % 2 ? Math.cos(angle) : Math.sin(angle)",
    "})",
    "PE = tokens.map((_, p) => positionRow(p))",
    "X = E.map((e, p) => e.map((v, d) => v + PE[p][d]))",
  ],
  frames({ data, generatedTokens = [] }) {
    const m = data.transformer;
    const n = m.tokens.length;
    const frames = [
      {
        phase: "Setup",
        line: 5,
        say: n
          ? `Attention compares rows with dot products, and those ignore order: shuffle the rows and every score moves with them. So each row gets an extra vector that depends only on its position p, from 0 to ${n - 1}. With 4 dimensions there are two speeds: d0 and d1 turn by p radians, d2 and d3 by p / 100.${generatedTokens.length ? " Positions count from the start of the current window." : ""}`
          : "There are no tokens, so there are no positions to encode.",
        vars: { n, d_model: D_MODEL },
        p: -1,
        d: -1,
        x: false,
      },
    ];
    for (let p = 0; p < n; p++) {
      const pe = m.positional[p];
      const e = m.embeddings[p];
      const x = m.positions[p];
      if (p < DETAIL)
        for (let d = 0; d < D_MODEL; d++) {
          const q = parts(p, d);
          frames.push({
            phase: "Step by step",
            line: [1, 2, 3],
            say: `PE[${p}][${d}]: k = ⌊${d} / 2⌋ = ${q.k}, angle = ${p} / 10000^(${2 * q.k}/4) = ${p} / ${q.denom} = ${fixed(q.angle, 4)}, and d is ${d % 2 ? "odd, so cos" : "even, so sin"}(${fixed(q.angle, 4)}) = ${fixed(q.value)}.`,
            vars: { p, d, k: q.k, angle: q.angle, [`PE[${p}][${d}]`]: q.value },
            p,
            d,
            x: false,
            hold: 0.7,
          });
        }
      else
        frames.push({
          phase: "Every position",
          line: [0, 1, 2, 3, 4],
          say: `PE[${p}] = [sin(${p}), cos(${p}), sin(${fixed(p / 100, 2)}), cos(${fixed(p / 100, 2)})] = [${list(pe)}].`,
          vars: { p, [`PE[${p}]`]: pe },
          p,
          d: 3,
          x: false,
          hold: 0.75,
        });
      frames.push({
        phase: p < DETAIL ? "Step by step" : "Every position",
        line: 6,
        say: `X[${p}] = E[${p}] + PE[${p}], one addition per column: ${e.map((v, d) => `${fixed(v)} + ${operand(pe[d])} = ${fixed(x[d])}`).join("; ")}.`,
        vars: { p, [`E[${p}]`]: e, [`PE[${p}]`]: pe, [`X[${p}]`]: x },
        p,
        d: 3,
        x: true,
        hold: p < DETAIL ? 0.9 : 0.75,
      });
    }
    // A pair of rows that had identical E rows (same token, or same tokenCode).
    let twin = null;
    for (let a = 0; a < n && !twin; a++)
      for (let b = a + 1; b < n && !twin; b++)
        if (m.embeddings[a].every((v, d) => v === m.embeddings[b][d])) twin = [a, b];
    frames.push({
      phase: "Done",
      line: 6,
      say: n
        ? `X is ${n} × 4 and is the input to attention. ${
            twin
              ? `Rows ${twin[0]} (${quote(m.tokens[twin[0]])}) and ${twin[1]} (${quote(m.tokens[twin[1]])}) had identical E rows; their X rows now differ because their positions differ.`
              : "Two tokens with identical E rows would now differ, because their positions differ."
          }`
        : "X is empty: 0 × 4.",
      vars: { "X.shape": `${n} × 4` },
      p: n,
      d: -1,
      x: true,
    });
    return frames;
  },
  blocks({ data }) {
    const m = data.transformer;
    const labels = labelsOf(m.tokens);
    return [
      mat({ id: "PE", title: "PE: sin / cos (p / 10000^(2k/4))", data: m.positional, rowLabels: labels, colLabels: DIMS }),
      mat({ id: "X", title: "X = E + PE", data: m.positions, rowLabels: labels, colLabels: DIMS, beside: true }),
    ];
  },
  output: "X",
  links: () => [{ from: "PE", to: "X" }],
  state(frame, { data }) {
    const n = data.transformer.tokens.length;
    const p = frame.p;
    const live = p >= 0 && p < n;
    const writingPE = live && !frame.x;
    return {
      E: { source: live && frame.x ? row(p, 4) : [] },
      PE: {
        done: (r, c) => r < p || (r === p && (frame.x || c <= frame.d)) || p >= n,
        active: writingPE ? (frame.phase === "Every position" ? row(p, 4) : [[p, frame.d]]) : [],
        source: live && frame.x ? row(p, 4) : [],
      },
      X: {
        done: (r) => r < p || (r === p && frame.x) || p >= n,
        active: live && frame.x ? row(p, 4) : [],
      },
    };
  },
  math(frame, { data }) {
    const m = data.transformer;
    const p = frame.p;
    if (p < 0 || p >= m.tokens.length) return [];
    if (frame.x)
      return DIMS.map((_, d) => ({
        label: `X[${p}][${d}]`,
        terms: [fixed(m.embeddings[p][d]), fixed(m.positional[p][d])],
        result: fixed(m.positions[p][d]),
      }));
    const dims = frame.phase === "Every position" ? [0, 1, 2, 3] : [frame.d];
    return dims.map((d) => {
      const q = parts(p, d);
      return {
        label: `PE[${p}][${d}]`,
        terms: [`${q.fn}(${p} / ${q.denom})`, `${q.fn}(${fixed(q.angle, 4)})`],
        op: "=",
        result: fixed(q.value),
      };
    });
  },
  Stage({ ctx, frame, frames, seek }) {
    const m = ctx.data.transformer;
    const n = m.tokens.length;
    const [picked, setPicked] = useState(null);
    const labels = labelsOf(m.tokens);
    const finished = (r) => r < frame.p || (r === frame.p && frame.x);
    const row =
      picked !== null && picked < n && finished(picked)
        ? picked
        : frame.p >= 0 && frame.p < n
          ? frame.p
          : frame.p >= n && n
            ? n - 1
            : null;
    const live = row === frame.p;
    const dUpTo = live ? frame.d : 3;
    const showX = live ? frame.x : true;
    const peState = (r, c) => {
      if (r === row && !live) return "active";
      if (r < frame.p) return "done";
      if (r > frame.p) return "pending";
      if (frame.x) return "done";
      return c < frame.d ? "done" : c === frame.d ? "active" : "pending";
    };
    const xState = (r) =>
      r === row && !live ? "active" : r < frame.p ? "done" : r === frame.p && frame.x ? "active" : "pending";
    const eState = (r) => (r === row ? "active" : "done");
    const onCell = (r) => {
      setPicked(r);
      seek(frames.findLastIndex((f) => f.p === r));
    };
    return (
      <div className="x-stack">
        {row !== null && (
          <div className="x-row-wrap">
            <Panel title={`PE[${row}] = positionRow(${row})`} note="10000^(2k/4) is 1 for k = 0 and 100 for k = 1.">
              <Table
                head={["d", "k = ⌊d/2⌋", "10000^(2k/4)", "angle = p / that", "function", `PE[${row}][d]`]}
                active={live && !frame.x ? frame.d : undefined}
                rows={DIMS.map((_, d) => {
                  const q = parts(row, d);
                  return d <= dUpTo
                    ? [d, q.k, q.denom, fixed(q.angle, 4), `${q.fn}(${fixed(q.angle, 4)})`, fixed(q.value)]
                    : { cls: "is-pending", cells: [d, "·", "·", "·", "·", "·"] };
                })}
              />
            </Panel>
            {showX && (
              <Panel title={`X[${row}] = E[${row}] + PE[${row}]`}>
                {m.embeddings[row].map((v, d) => (
                  <Expr
                    key={d}
                    label={`X[${row}][${d}]`}
                    terms={[fixed(v), fixed(m.positional[row][d])]}
                    result={fixed(m.positions[row][d])}
                  />
                ))}
              </Panel>
            )}
          </div>
        )}
        <div className="x-row-wrap">
          <Matrix caption="E (embedding)" data={m.embeddings} rowLabels={labels} colLabels={DIMS} state={eState} onCell={onCell} />
          <Matrix caption="PE (position)" data={m.positional} rowLabels={labels} colLabels={DIMS} state={peState} onCell={onCell} />
          <Matrix caption="X = E + PE. Click a row." data={m.positions} rowLabels={labels} colLabels={DIMS} state={xState} onCell={onCell} />
        </div>
      </div>
    );
  },
};
