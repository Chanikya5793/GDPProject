import { useState } from "react";
import { Expr, Matrix, Panel, Table, fixed } from "../../kit.jsx";
import { tokenCode } from "../../../engine/transformer.js";
import { tableBlock } from "../../../map/blocks.js";
import { DIMS, charTerms, codeSum, hex, labelsOf, list, mat, quote } from "./shared.jsx";

const DETAIL = 2; // tokens 0..DETAIL-1 get one frame per character and per dimension
const angle = (code, d) => code * (d + 1) * 0.017;
const BAR_NOTE = " The end-of-word mark ▁ is the character U+2581 = 9601, so it adds a large amount to the code.";

export default {
  id: "embedding",
  source: [
    ["transformer", "tokenCode"],
    ["transformer", "embeddingRow"],
  ],
  code: [
    "const tokenCode = (token) =>",
    "  Array.from(token).reduce((sum, c, i) => sum + c.codePointAt(0) * (i + 1), 0)",
    "const embeddingRow = (token) => {",
    "  const code = tokenCode(token)",
    "  return [0, 1, 2, 3].map(d => Math.sin(code * (d + 1) * 0.017))",
    "}",
    "E = tokens.map(embeddingRow)  // one row per token: n × 4",
  ],
  frames({ data }) {
    const m = data.transformer;
    const n = m.tokens.length;
    const frames = [
      {
        phase: "Setup",
        line: 6,
        say: n
          ? `There are ${n} tokens. A trained model would look each one up in a learned table. This toy computes the row from the token's characters instead, so every subword gets a row, even one it has never seen.`
          : "There are no tokens, so E has no rows.",
        vars: { n, "E.shape": `${n} × 4` },
        i: -1,
        c: -1,
        d: -1,
      },
    ];
    let barExplained = false;
    const seen = new Map(); // code → first token index with that code
    m.tokens.forEach((t, i) => {
      const chars = charTerms(t);
      const code = tokenCode(t);
      const row = m.embeddings[i];
      const bar = !barExplained && t.includes("▁");
      if (bar) barExplained = true;
      const twin = seen.has(code) && m.tokens[seen.get(code)] !== t ? seen.get(code) : -1;
      if (!seen.has(code)) seen.set(code, i);
      const twinNote =
        twin >= 0
          ? ` That is the same code as ${quote(m.tokens[twin])} (token ${twin}), so the two get identical rows: the formula cannot tell them apart.`
          : "";
      if (i < DETAIL) {
        chars.forEach((ch, c) =>
          frames.push({
            phase: "Step by step",
            line: 1,
            say: `${quote(t)}, character ${c}: ${quote(ch.char)} is ${hex(ch.cp)} = ${ch.cp}, times ${ch.mult} = ${ch.product}. Running sum: ${ch.running}.${c === chars.length - 1 ? ` So tokenCode(${quote(t)}) = ${code}.${twinNote}` : ""}${bar && ch.char === "▁" ? BAR_NOTE : ""}`,
            vars: { token: t, i: c, c: ch.char, "codePointAt(0)": ch.cp, "× (i + 1)": ch.product, sum: ch.running },
            i,
            c,
            d: -1,
            hold: 0.75,
          }),
        );
        row.forEach((v, d) =>
          frames.push({
            phase: "Step by step",
            line: 4,
            say: `E[${i}][${d}] = sin(${code} × ${d + 1} × 0.017) = sin(${fixed(angle(code, d))}) = ${fixed(v)}.${i === 0 && d === 0 ? " The angle is in radians, and sin keeps every entry between −1 and 1." : ""}`,
            vars: { code, d, angle: angle(code, d), [`E[${i}][${d}]`]: v },
            i,
            c: chars.length - 1,
            d,
            hold: 0.75,
          }),
        );
      } else {
        frames.push({
          phase: "Every token",
          line: [0, 1],
          say: `Token ${i}, ${quote(t)}: tokenCode = ${codeSum(t)} = ${code}.${bar ? BAR_NOTE : ""}`,
          vars: { token: t, code },
          i,
          c: chars.length - 1,
          d: -1,
          hold: 0.8,
        });
        frames.push({
          phase: "Every token",
          line: [3, 4],
          say: `E[${i}] = sin(${code} × (d + 1) × 0.017) for d = 0, 1, 2, 3 = [${list(row)}].${twinNote}`,
          vars: { code, [`E[${i}]`]: row },
          i,
          c: chars.length - 1,
          d: 3,
          hold: 0.8,
        });
      }
    });
    frames.push({
      phase: "Done",
      line: 6,
      say: n
        ? `E is ${n} × 4, one row per token. The same token always gets the same row, wherever it stands; the next step adds the position.`
        : "E is empty: 0 × 4.",
      vars: { "E.shape": `${n} × 4` },
      i: n,
      c: -1,
      d: -1,
    });
    return frames;
  },
  blocks({ data }) {
    const m = data.transformer;
    const labels = labelsOf(m.tokens);
    return [
      tableBlock({
        id: "codes",
        title: "code = Σ cp·(i+1)",
        head: ["code"],
        widths: [1.1],
        rowLabels: labels.length ? labels : undefined,
        rows: m.tokens.map((t) => [String(tokenCode(t))]),
      }),
      mat({
        id: "E",
        title: "E[d] = sin(code·(d+1)·0.017)",
        data: m.embeddings,
        rowLabels: labels,
        colLabels: DIMS,
        beside: true,
      }),
    ];
  },
  output: "E",
  links: () => [{ from: "codes", to: "E" }],
  state(frame, { data }) {
    const n = data.transformer.tokens.length;
    const i = frame.i;
    const live = i >= 0 && i < n;
    const codeDone = (r) => r < i || (r === i && frame.c >= Array.from(data.transformer.tokens[i] ?? "").length - 1) || i >= n;
    const rowDone = (r, c) => r < i || (r === i && c <= frame.d) || i >= n;
    const writingCode = live && frame.d < 0;
    return {
      subwords: { source: writingCode ? [[i, 1]] : [] },
      codes: { done: (r) => codeDone(r), active: writingCode && codeDone(i) ? [[i, 0]] : [], source: live && frame.d >= 0 ? [[i, 0]] : [] },
      E: {
        done: rowDone,
        active: !live || frame.d < 0 ? [] : frame.phase === "Every token" ? DIMS.map((_, d) => [i, d]) : [[i, frame.d]],
      },
    };
  },
  math(frame, { data }) {
    const m = data.transformer;
    const i = frame.i;
    if (i < 0 || i >= m.tokens.length) return [];
    const t = m.tokens[i];
    const chars = charTerms(t);
    const code = tokenCode(t);
    if (frame.d < 0) {
      const upto = chars.slice(0, frame.c + 1);
      return [{ label: `tokenCode(${quote(t)})`, terms: upto.map((ch) => `${ch.cp}×${ch.mult}`), result: upto.at(-1)?.running ?? 0 }];
    }
    const dims = frame.phase === "Every token" ? [0, 1, 2, 3] : [frame.d];
    return dims.map((d) => ({
      label: `E[${i}][${d}]`,
      terms: [`sin(${code}×${d + 1}×0.017)`, `sin(${fixed(angle(code, d))})`],
      op: "=",
      result: fixed(m.embeddings[i][d]),
    }));
  },
  Stage({ ctx, frame, frames, seek }) {
    const m = ctx.data.transformer;
    const n = m.tokens.length;
    const [picked, setPicked] = useState(null);
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
    const t = row === null ? "" : m.tokens[row];
    const chars = charTerms(t);
    const code = tokenCode(t);
    const cUpTo = live ? frame.c : chars.length - 1;
    const dUpTo = live ? frame.d : 3;
    const state = (r, c) => {
      if (r === row && !live) return "active";
      if (r < frame.i) return "done";
      if (r > frame.i) return "pending";
      return c < frame.d ? "done" : c === frame.d ? "active" : "pending";
    };
    return (
      <div className="x-stack">
        {row !== null && (
          <div className="x-row-wrap">
            <Panel
              title={`tokenCode(${quote(t)})`}
              note="Each code point is multiplied by its 1-based position, so the order of the characters matters."
            >
              <Table
                head={["i", "char", "code point", "× (i + 1)", "product", "running sum"]}
                active={live && frame.c >= 0 && frame.d < 0 ? frame.c : undefined}
                rows={chars.map((ch, c) =>
                  c <= cUpTo
                    ? [c, <code key="c">{ch.char}</code>, `${hex(ch.cp)} = ${ch.cp}`, `× ${ch.mult}`, ch.product, ch.running]
                    : { cls: "is-pending", cells: [c, <code key="c">{ch.char}</code>, "·", "·", "·", "·"] },
                )}
              />
              {cUpTo >= chars.length - 1 && (
                <Expr label="code" terms={chars.map((ch) => `${ch.cp}×${ch.mult}`)} result={code} />
              )}
            </Panel>
            {dUpTo >= 0 && (
              <Panel title={`E[${row}] = embeddingRow(${quote(t)})`}>
                {m.embeddings[row].map(
                  (v, d) =>
                    d <= dUpTo && (
                      <Expr
                        key={d}
                        label={`E[${row}][${d}]`}
                        op="="
                        terms={[`sin(${code} × ${d + 1} × 0.017)`, `sin(${fixed(angle(code, d))})`]}
                        result={fixed(v)}
                      />
                    ),
                )}
              </Panel>
            )}
          </div>
        )}
        <div className="x-row-wrap">
          <Matrix
            caption="E (rows: tokens, columns: dimensions). Click a row."
            data={m.embeddings}
            rowLabels={labelsOf(m.tokens)}
            colLabels={DIMS}
            state={state}
            onCell={(r) => {
              setPicked(r);
              seek(frames.findLastIndex((f) => f.i === r));
            }}
          />
        </div>
      </div>
    );
  },
};
