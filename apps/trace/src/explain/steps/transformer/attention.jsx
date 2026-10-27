import { useState } from "react";
import { Expr, Matrix, Panel, Table, fixed } from "../../kit.jsx";
import { cells, labelsOf, list, mat, paramsOf, quote, range, tunedSay } from "./shared.jsx";

const DETAIL = 3; // rows 0..DETAIL-1 get one frame per sub-step
// Sub-steps of one row: 0 mask, 1 max, 2 shift, 3 exp, 4 sum, 5 divide.
const SUB_LINE = [2, 3, 4, 5, 6, 7];

const argmax = (values) => values.reduce((best, v, j) => (v > values[best] ? j : best), 0);
// How many columns row i may use: 0..i with the causal mask, all n without.
const seenOf = (mask, n) => (i) => (mask ? i + 1 : n);

export default {
  id: "attention",
  source: [
    ["transformer", "softmaxSteps"],
    ["transformer", "attention"],
  ],
  code: [
    "// S: the n × n scores from the previous step",
    "for (let i = 0; i < n; i++) {",
    "  row = S[i].map((s, j) => (causalMask && j > i ? -Infinity : s))  // causal mask",
    "  max = Math.max(...row)",
    "  shifted = row.map(s => s - max)  // largest becomes 0",
    "  exps = shifted.map(Math.exp)  // exp(−∞) = 0",
    "  sum = exps.reduce((a, b) => a + b, 0)",
    "  W[i] = exps.map(e => e / sum)  // the row sums to 1",
    "}",
  ],
  frames(ctx) {
    const m = ctx.data.transformer;
    const n = m.tokens.length;
    const p = paramsOf(ctx);
    const mask = p.causalMask;
    const seen = seenOf(mask, n);
    const frames = [
      {
        phase: "Setup",
        line: 0,
        say: `${
          !n
            ? "There are no tokens, so S is empty and there is nothing to mask."
            : mask
              ? `S is ${n} × ${n}. Token i may only use tokens 0 to i, so in row i every score with j > i is replaced by −∞. Softmax then turns each row into weights between 0 and 1 that add up to 1.`
              : `S is ${n} × ${n}. The causal mask is off, so no score is replaced by −∞: every token may use every other token, even ones after it. Softmax turns each full row into weights between 0 and 1 that add up to 1.`
        }${tunedSay(p, ["merges", "context", "positional", "scaleScores"])}`,
        vars: { n, causalMask: mask },
        i: -1,
        sub: -1,
      },
    ];
    for (let i = 0; i < n; i++) {
      const s = m.softmaxRows[i];
      const t = quote(m.tokens[i]);
      const top = argmax(s.probs);
      const k = seen(i);
      const visible = s.exps.slice(0, k);
      if (i < DETAIL) {
        const hidden = n - k;
        const say = [
          mask
            ? `Row ${i}, ${t}: keep the ${i + 1} score${i ? "s" : ""} with j ≤ ${i}${hidden ? `; the ${hidden} with j > ${i} become −∞` : "; nothing comes after it"}.`
            : `Row ${i}, ${t}: the mask is off, so all ${n} score${n === 1 ? "" : "s"} stay${n - i - 1 ? `, including the ${n - i - 1} for tokens after it` : ""}.`,
          `The largest ${mask ? "visible " : ""}score is ${fixed(s.max, 4)}, in column ${argmax(s.shifted)} (${quote(m.tokens[argmax(s.shifted)])}).`,
          i === 0 && hidden
            ? `Subtract ${fixed(s.max, 4)} from each entry, so the largest becomes 0 and exp cannot overflow. −∞ minus anything is still −∞.`
            : `Subtract ${fixed(s.max, 4)} from each ${mask ? "visible " : ""}score: [${list(s.shifted.slice(0, k), 4)}]. The largest is now 0 and the rest are negative or 0.`,
          `Take exp of each: ${visible.map((e, j) => `exp(${fixed(s.shifted[j], 4)}) = ${fixed(e, 4)}`).join(", ")}${hidden ? ", and exp(−∞) = 0 for the masked ones" : ""}.`,
          visible.length === 1
            ? `There is only one term, so sum = ${fixed(s.sum, 4)}.`
            : `Add them up: sum = ${visible.map((e) => fixed(e, 4)).join(" + ")} = ${fixed(s.sum, 4)}.`,
          `Divide each by ${fixed(s.sum, 4)}: W[${i}] = [${list(s.probs.slice(0, k))}${hidden ? ", 0, …" : ""}]. The weights add up to 1.`,
        ];
        say.forEach((text, sub) =>
          frames.push({
            phase: "Step by step",
            line: SUB_LINE[sub],
            say: text,
            vars: [
              { i, "visible j": `0..${k - 1}`, masked: hidden },
              { i, max: s.max },
              { i, max: s.max, shifted: s.shifted.slice(0, k) },
              { i, exps: s.exps.slice(0, k) },
              { i, sum: s.sum },
              { i, sum: s.sum, [`W[${i}]`]: s.probs.slice(0, k) },
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
          say: `Row ${i}, ${t}: ${k} ${mask ? "visible " : ""}scores, max = ${fixed(s.max, 3)}, sum of exps = ${fixed(s.sum, 3)}. The largest weight, ${fixed(s.probs[top])}, goes to ${quote(m.tokens[top])} (column ${top}).`,
          vars: { i, max: s.max, sum: s.sum, [`W[${i}]`]: s.probs.slice(0, k) },
          i,
          sub: 5,
          hold: 0.8,
        });
    }
    frames.push({
      phase: "Done",
      line: 8,
      say: n
        ? `W is ${n} × ${n}. ${mask ? "Everything above the diagonal is 0" : "With the mask off the upper triangle is filled in too: tokens take from later tokens"} and every row adds up to 1 (row ${n - 1}: ${fixed(m.weights[n - 1].reduce((a, b) => a + b, 0), 6)}). Click any cell to see its arithmetic.`
        : "W is empty.",
      vars: { "W.shape": `${n} × ${n}` },
      i: n,
      sub: 5,
    });
    return frames;
  },
  blocks(ctx) {
    const m = ctx.data.transformer;
    const mask = paramsOf(ctx).causalMask;
    const n = m.tokens.length;
    return [
      mat({
        id: "W",
        title: mask ? "W[i] = softmax(S[i], with j > i masked)" : "W[i] = softmax(S[i]), no mask",
        data: m.weights,
        rowLabels: labelsOf(m.tokens),
        colLabels: m.tokens.map((_, j) => String(j)),
        heat: "sequential",
        scale: 1,
        cellW: 1.2,
        masked: (r, c) => mask && c > r,
        explain: (r, c) => {
          const s = m.softmaxRows[r];
          if (!s || m.weights[r][c] === undefined) return null;
          const meaning = `How much ${quote(m.tokens[r])} attends to ${quote(m.tokens[c])}: the share of row ${r}'s attention that goes to column ${c}.`;
          if (mask && c > r)
            return {
              meaning: `${meaning} ${quote(m.tokens[c])} comes later, so the causal mask hides it.`,
              formula: "w = exp(−∞) / sum = 0",
              worked: `W[${r}][${c}] = 0 ÷ ${fixed(s.sum, 4)} = 0`,
            };
          return {
            meaning,
            formula: `w_ij = exp(s_ij − max) / Σ_k exp(s_ik − max)${mask ? ", over k ≤ i" : ""}`,
            worked: `W[${r}][${c}] = exp(${fixed(m.scores[r][c], 4)} − ${fixed(s.max, 4)}) / ${fixed(s.sum, 4)} = ${fixed(s.exps[c], 4)} / ${fixed(s.sum, 4)} = ${fixed(s.probs[c], 4)}`,
          };
        },
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
        explain: (r, c) => {
          const s = m.softmaxRows[r];
          if (!s || c > 1) return null;
          const k = seenOf(mask, n)(r);
          const scores = m.scores[r].slice(0, k).map((v) => fixed(v, 3));
          return c === 0
            ? {
                meaning: `The largest ${mask ? "visible " : ""}score in row ${r} (${quote(m.tokens[r])}). It is subtracted first so exp never overflows.`,
                formula: mask ? "max = max(S[i][0..i])" : "max = max(S[i])",
                worked: `max(${scores.join(", ")}) = ${fixed(s.max, 4)}`,
              }
            : {
                meaning: `The total of row ${r}'s exps: dividing by it makes the weights add up to 1.`,
                formula: "sum = Σ_j exp(s_ij − max)",
                worked: `${s.exps.slice(0, k).map((e) => fixed(e, 4)).join(" + ")} = ${fixed(s.sum, 4)}`,
              };
        },
      }),
    ];
  },
  output: "W",
  links: () => [{ from: "Wstats", to: "W" }],
  state(frame, ctx) {
    const n = ctx.data.transformer.tokens.length;
    const mask = paramsOf(ctx).causalMask;
    const i = frame.i;
    const sub = frame.sub;
    const live = i >= 0 && i < n;
    const visible = live ? range(0, seenOf(mask, n)(i)) : [];
    const every = frame.phase === "Every row";
    return {
      S: {
        source: !live ? [] : sub === 0 ? cells([i], range(0, n)) : sub === 4 ? [] : cells([i], visible),
      },
      W: {
        done: (r, c) => r < i || i >= n || (r === i && (mask && c > i ? sub >= 0 : sub >= 5)),
        active: live && sub >= 5 ? cells([i], visible) : [],
      },
      Wstats: {
        done: (r, c) => r < i || i >= n || (r === i && sub >= (c === 0 ? 1 : 4)),
        active: !live ? [] : every ? [[i, 0], [i, 1]] : sub === 1 ? [[i, 0]] : sub === 4 ? [[i, 1]] : [],
        source: live && !every && (sub === 2 || sub === 3) ? [[i, 0]] : live && !every && sub === 5 ? [[i, 1]] : [],
      },
    };
  },
  math(frame, ctx) {
    const m = ctx.data.transformer;
    const mask = paramsOf(ctx).causalMask;
    const i = frame.i;
    if (i < 0 || i >= m.tokens.length) return [];
    const s = m.softmaxRows[i];
    const seen = range(0, seenOf(mask, m.tokens.length)(i));
    const hidden = m.tokens.length - seen.length;
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
      [{ label: mask ? `S[${i}] masked` : `S[${i}] (no mask)`, terms: [[...scores, ...(hidden ? [`−∞ × ${hidden}`] : [])].join(", ")] }],
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
    const mask = paramsOf(ctx).causalMask;
    const [picked, setPicked] = useState(null);
    const labels = labelsOf(m.tokens);
    const rowDone = (r) => r < frame.i || (r === frame.i && frame.sub >= 5);
    const pickedOk = picked && picked[0] < n && rowDone(picked[0]);
    const row = pickedOk ? picked[0] : frame.i >= 0 && frame.i < n ? frame.i : frame.i >= n && n ? n - 1 : null;
    const sub = row === frame.i ? frame.sub : 5;
    const col = pickedOk ? picked[1] : row !== null && sub >= 5 ? argmax(m.weights[row]) : null;
    const s = row !== null ? m.softmaxRows[row] : null;
    const hides = (r, c) => mask && c > r;
    const masked = (r) => r < frame.i || (r === frame.i && frame.sub >= 0) || frame.i >= n;
    const sState = (r, c) => {
      if (!masked(r)) return frame.i < 0 ? "done" : "dim";
      if (hides(r, c)) return "masked";
      return r === row ? "active" : "done";
    };
    const wState = (r, c) => {
      if (!rowDone(r)) return "pending";
      if (hides(r, c)) return "masked";
      return r === row && c === col ? "active" : "done";
    };
    const dot = "·";
    const last = row === null ? 0 : mask ? row + 1 : n;
    return (
      <div className="x-stack">
        <Matrix
          className="is-square"
          caption={mask ? "S with the causal mask (rows: query token i, columns: key token j)" : "S, no mask (rows: query token i, columns: key token j)"}
          data={m.scores}
          rowLabels={labels}
          colLabels={m.tokens.map((_, j) => j)}
          state={sState}
        />
        {s && (
          <Panel title={`Row ${row}, ${quote(m.tokens[row])}: softmax step by step`}>
            <Table
              head={["j", "token", "s_ij", mask ? "masked" : "kept", "− max", "exp", "w_ij"]}
              active={col ?? undefined}
              rows={m.tokens.map((t, j) => {
                const hidden = hides(row, j);
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
                terms={[`max(${m.scores[row].slice(0, last).map((v) => fixed(v, 4)).join(", ")})`]}
                result={fixed(s.max, 4)}
              />
            )}
            {sub >= 4 && <Expr label="sum" terms={s.exps.slice(0, last).map((e) => fixed(e, 4))} result={fixed(s.sum, 4)} />}
          </Panel>
        )}
        <Matrix
          className="is-square"
          caption={
            mask
              ? "W = softmax of each masked row. Hatched cells had score −∞, so their weight is exactly 0. Click a cell."
              : "W = softmax of each full row. The mask is off, so later tokens get weight too. Click a cell."
          }
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
            {hides(row, col) ? (
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
