// Ties a step's pseudocode lines to the real engine source, so the source
// panel can highlight the line that is running. Each pseudocode line is
// matched to the source line that shares the most identifiers with it.
import { sourceOf } from "./source.js";

const KEYWORDS = new Set(
  "const let var for of in if else return new function true false null undefined this while do break continue typeof export import from default".split(
    " ",
  ),
);
// Pseudocode uses the math names; the engine spells them out.
const SYNONYMS = {
  S: "scores",
  Q: "query",
  K: "key",
  V: "value",
  W: "weights",
  O: "output",
  R: "residual",
  H1: "norm1",
  H2: "norm2",
  Hid: "hidden",
  Act: "activated",
  F: "feedforward",
  E: "embeddings",
  PE: "positional",
  X: "positions",
  P: "probabilities",
  p: "probabilities",
  logit: "logits",
  U: "unembedding",
  LN: "layerNormSteps",
  next: "nextToken",
};
const words = (line) => {
  const found = (line.replace(/\/\/.*$/, "").match(/[A-Za-z_$][\w$]*/g) || []).map(
    (w) => SYNONYMS[w] ?? w,
  );
  return new Set(found.filter((w) => !KEYWORDS.has(w) && w.length > 1).map((w) => w.toLowerCase()));
};

const cache = new WeakMap();
export function sourceMap(module) {
  if (cache.has(module)) return cache.get(module);
  // Every transformer step's arithmetic ultimately runs inside attention().
  const list = module.source.some(([f]) => f === "transformer") &&
    !module.source.some(([, n]) => n === "attention")
    ? [...module.source, ["transformer", "attention"]]
    : module.source;
  const blocks = list
    .map(([file, name]) => sourceOf(file, name))
    .filter(Boolean)
    .map((s) => ({ ...s, lines: s.code.split("\n") }));
  // A statement often wraps onto the next line, so each line also sees its
  // continuation.
  const all = blocks.flatMap((b, bi) =>
    b.lines.map((text, li) => ({
      bi,
      li,
      text,
      w: words(`${text} ${/[=(,>[{]\s*$/.test(text) ? (b.lines[li + 1] ?? "") : ""}`),
    })),
  );
  const toSource = module.code.map((pseudo, i) => {
    // A module can pin a pseudocode line to the source line containing a string.
    const pin = module.sourceLines?.[i];
    if (pin) {
      const line = all.find((l) => l.text.includes(pin));
      if (line) return { bi: line.bi, li: line.li };
    }
    const want = words(pseudo);
    if (!want.size) return null;
    let best = null;
    let bestScore = 0;
    for (const line of all) {
      // Skip shorthand entries of a returned object ("norm1Steps,").
      if (!line.w.size || /^\s*[\w$]+,?\s*$/.test(line.text)) continue;
      let shared = 0;
      want.forEach((w) => line.w.has(w) && shared++);
      // Shared identifiers, relative to both lines' sizes.
      const score = shared / Math.sqrt(want.size * line.w.size);
      if (score > bestScore) {
        bestScore = score;
        best = line;
      }
    }
    return bestScore >= 0.4 ? { bi: best.bi, li: best.li } : null;
  });
  // Loop headers, braces and comments run "around" a statement: point them at
  // the next matched line, or the previous one at the end.
  for (let i = 0; i < toSource.length; i++) {
    if (toSource[i] || !/[A-Za-z]/.test(module.code[i].replace(/\/\/.*$/, ""))) continue;
    const after = toSource.slice(i + 1).find(Boolean);
    const before = toSource.slice(0, i).reverse().find(Boolean);
    toSource[i] = after ?? before ?? null;
  }
  const result = { blocks, toSource };
  cache.set(module, result);
  return result;
}
