// Small helpers shared by the transformer-track steps.
import { Expr, fixed } from "../../kit.jsx";
import { END, TRANSFORMER_DEFAULTS } from "../../../engine/transformer.js";
import { matrixBlock } from "../../../map/blocks.js";

export const DIMS = ["d0", "d1", "d2", "d3"];

// The transformer settings this ctx was computed with. Contexts built without
// tuning (tests, older callers) fall back to what the engine recorded.
export const paramsOf = (ctx) =>
  ctx?.params?.transformer ?? ctx?.model?.params ?? ctx?.data?.transformer?.params ?? TRANSFORMER_DEFAULTS;
export const isDefault = (p, key) => p[key] === TRANSFORMER_DEFAULTS[key];
const TUNED = {
  merges: (v) => `${v} BPE merges instead of ${TRANSFORMER_DEFAULTS.merges}`,
  context: (v) => `a ${v}-token window instead of ${TRANSFORMER_DEFAULTS.context}`,
  positional: () => "positional encoding is off",
  scaleScores: () => "scores are not divided by √4",
  causalMask: () => "the causal mask is off",
  residual: () => "residual connections are off",
  activation: (v) => `${v === "relu" ? "ReLU" : v} instead of GELU`,
  temperature: (v) => `temperature ${v} instead of ${TRANSFORMER_DEFAULTS.temperature}`,
};
// A short note for frame text naming the settings in `keys` that differ from the default.
export function tunedSay(p, keys) {
  const parts = keys.filter((k) => !isDefault(p, k)).map((k) => TUNED[k](p[k]));
  return parts.length ? ` Your settings: ${parts.join("; ")}.` : "";
}
// Explain-a-cell results: null for cells outside the data.
export const within = (data, r, c) => data?.[r]?.[c] !== undefined;
export const quote = (t) => `“${t}”`;
export const labelsOf = (tokens) => tokens.map((t, i) => `${i} ${t}`);
export const list = (values, digits = 3) => values.map((v) => fixed(v, digits)).join(", ");
// A second operand in a sentence: negatives in parentheses, "0.3 + (−0.2)".
export const operand = (v, digits = 3) => (v < 0 ? `(${fixed(v, digits)})` : fixed(v, digits));
export const hex = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;

// tokenCode, one character at a time: codePoint × (i + 1), with the running sum.
export function charTerms(token) {
  let running = 0;
  return Array.from(token).map((char, i) => {
    const cp = char.codePointAt(0);
    running += cp * (i + 1);
    return { char, cp, mult: i + 1, product: cp * (i + 1), running };
  });
}
export const codeSum = (token) =>
  charTerms(token)
    .map((t) => `${t.cp}×${t.mult}`)
    .join(" + ");

// encodeBPE's last step: drop a lone "</w>" and print a trailing one as "▁".
export const toTokens = (pieces) =>
  pieces.filter((p) => p !== END).map((p) => p.replace(END, "▁"));

// One BPE symbol; the "</w>" end marker is drawn faintly.
export function Piece({ text, cls = "" }) {
  const at = text.indexOf(END);
  return (
    <span className={`t-piece ${cls}`}>
      {at < 0 ? (
        text
      ) : (
        <>
          {text.slice(0, at)}
          <small>{END}</small>
          {text.slice(at + END.length)}
        </>
      )}
    </span>
  );
}
export function Pieces({ pieces, cls = () => "" }) {
  return (
    <span className="t-pieces">
      {pieces.map((p, i) => (
        <Piece key={i} text={p} cls={cls(i)} />
      ))}
    </span>
  );
}

// A wrapping row of tokens with a small caption under each.
export function Chips({ items, cls = () => "", sub, onPick }) {
  return (
    <div className="t-chips">
      {items.map((t, i) => {
        const Tag = onPick ? "button" : "span";
        return (
          <Tag key={i} className={`t-chip ${cls(i)}`} onClick={onPick ? () => onPick(i) : undefined}>
            <strong>{t === " " ? "␣" : t}</strong>
            {sub && <small>{sub(i)}</small>}
          </Tag>
        );
      })}
    </div>
  );
}

// LayerNorm, line by line. `upto`: 0 mean, 1 deviations, 2 variance, 3 std, 4 output.
export function NormExprs({ input, steps, upto = 4, inName = "r", outName = "out" }) {
  const { mean, deviations, variance, std, out } = steps;
  const sum = input.reduce((a, b) => a + b, 0);
  const squares = deviations.map((v) => v * v);
  return (
    <>
      <Expr label="sum" terms={input.map((v) => fixed(v, 4))} result={fixed(sum, 4)} />
      <Expr label="μ (mean)" terms={[fixed(sum, 4), "4"]} op="÷" result={fixed(mean, 4)} />
      {upto >= 1 &&
        deviations.map((v, d) => (
          <Expr key={`dev${d}`} label={`${inName}${d} − μ`} terms={[fixed(input[d], 4), fixed(mean, 4)]} op="−" result={fixed(v, 4)} />
        ))}
      {upto >= 2 && (
        <>
          <Expr label="(x − μ)²" terms={squares.map((v) => fixed(v, 4))} result={fixed(squares.reduce((a, b) => a + b, 0), 4)} />
          <Expr label="σ² (variance)" terms={[fixed(squares.reduce((a, b) => a + b, 0), 4), "4"]} op="÷" result={fixed(variance, 4)} />
        </>
      )}
      {upto >= 3 && <Expr label="std" terms={[`√(${fixed(variance, 4)} + 0.00001)`]} result={fixed(std, 4)} />}
      {upto >= 4 &&
        out.map((v, d) => (
          <Expr key={`out${d}`} label={`${outName}${d}`} terms={[fixed(deviations[d], 4), fixed(std, 4)]} op="÷" result={fixed(v, 4)} />
        ))}
    </>
  );
}

// Mean and variance of a normalized row, to show the result really is ≈ (0, 1).
export function moments(row) {
  if (!row.length) return { mean: 0, variance: 0 };
  const mean = row.reduce((a, b) => a + b, 0) / row.length;
  return { mean, variance: row.reduce((s, v) => s + (v - mean) ** 2, 0) / row.length };
}

// Map helpers. A matrix block with no rows drops its labels so its geometry
// stays finite for an empty request.
export function mat(options) {
  return matrixBlock(options.data.length ? options : { ...options, rowLabels: undefined, colLabels: undefined });
}
// Cells [r, c] for every r in `rows` and c in `cols`.
export const cells = (rows, cols) => rows.flatMap((r) => cols.map((c) => [r, c]));
export const range = (from, to) => Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
export const vec = (values, digits = 3) => `[${list(values, digits)}]`;
