// Lessons for the transformer track, keyed by step id. See ./index.js for the shape.
import { TRANSFORMER_DEFAULTS, tokenCode } from "../../engine/transformer.js";

const n3 = (v) => (Number.isFinite(v) ? (Math.abs(v) < 0.0005 ? 0 : v).toFixed(3).replace("-", "−") : String(v));
const q = (t) => `“${t}”`;
const vec = (row) => `[${(row ?? []).map(n3).join(", ")}]`;
const modelOf = (ctx) => ctx?.model ?? ctx?.data?.transformer ?? null;
const paramsOf = (ctx) => ctx?.params?.transformer ?? modelOf(ctx)?.params ?? TRANSFORMER_DEFAULTS;
const EMPTY = "Your request has no tokens, so there is nothing to show yet. Type a sentence to see real numbers here.";
const argmax = (row) => row.reduce((b, v, j) => (v > row[b] ? j : b), 0);

// Runs `fn(m, p, n)` on this run's model, or explains that the request is empty.
const withModel = (fn) => (ctx) => {
  const m = modelOf(ctx);
  if (!m?.tokens?.length) return EMPTY;
  return fn(m, paramsOf(ctx), m.tokens.length);
};

export default {
  bpe: {
    what: "Your sentence is cut into subword tokens: common chunks of letters learned from a small training text. Each word starts as single letters, and learned merges glue frequent pairs back together.",
    why: "A model needs a fixed list of pieces it knows. Whole words would miss every new word; single letters would make sequences long and each piece almost meaningless. Subwords sit in between.",
    example: (ctx) => {
      const m = modelOf(ctx);
      const p = paramsOf(ctx);
      const words = ctx?.data?.bpe?.words ?? [];
      if (!words.length) return EMPTY;
      const w = words.find((x) => x.applied.length) ?? words[0];
      const toks = w.pieces.filter((x) => x !== "</w>").map((x) => x.replace("</w>", "▁"));
      return `${q(w.word)} starts as ${w.start.length} symbols and ${w.applied.length ? `${w.applied.length} merge${w.applied.length === 1 ? "" : "s"} apply` : "no merge applies"}, giving ${toks.map(q).join(" ")}. With ${p.merges} merges, your whole request becomes ${ctx.data.bpe.final.length} tokens, and the model reads ${m?.tokens.length ?? 0} of them.`;
    },
    try: [
      { setting: "transformer.merges", value: 0, watch: "Every character becomes its own token, so the window fills up with single letters." },
      { setting: "transformer.merges", value: 200, watch: "Training stops early when no pair repeats; common words become a single token." },
    ],
  },
  embedding: {
    what: "Each token becomes a row of 4 numbers. Here the row is computed from the token's characters with a sine formula, so the same token always gets the same row.",
    why: "Arithmetic needs numbers, not text. A trained model learns these rows so that similar tokens get similar numbers; this toy uses a fixed formula so the steps stay visible.",
    example: withModel((m) => {
      const t = m.tokens[0];
      return `${q(t)} has code ${tokenCode(t)}, so its row is E[0] = sin(${tokenCode(t)} × (d + 1) × 0.017) = ${vec(m.embeddings[0])}.`;
    }),
    try: [
      { setting: "transformer.merges", value: 0, watch: "Single letters get rows instead of subwords, and repeated letters get identical rows." },
      { setting: "transformer.context", value: 4, watch: "Only the first 4 tokens get embedding rows; the rest are cut off." },
    ],
  },
  position: {
    what: "A wave pattern that depends only on the position is added to each row, so the same token at position 0 and at position 5 ends up with different numbers.",
    why: "Attention compares every pair of rows and ignores their order. Without a position signal, “dog bites man” and “man bites dog” would look the same to it.",
    example: withModel((m, p, n) => {
      const i = Math.min(1, n - 1);
      if (!p.positional)
        return `Positional encoding is off, so PE[${i}] = [0, 0, 0, 0] and X[${i}] = E[${i}] = ${vec(m.positions[i])}.`;
      return `Position ${i} (${q(m.tokens[i])}) gets PE = ${vec(m.positional[i])}, so X[${i}] = E + PE = ${vec(m.embeddings[i])} + ${vec(m.positional[i])} = ${vec(m.positions[i])}.`;
    }),
    try: [
      { setting: "transformer.positional", value: false, watch: "PE turns to zeros and X equals E; a repeated token has identical rows everywhere after this." },
    ],
  },
  qk: {
    what: "Each row is turned into a query (what this token is looking for) and a key (what it offers). Every query is compared with every key by a dot product, giving an n × n table of scores.",
    why: "This is how a token finds which other tokens matter to it. Dividing by √4 keeps the scores small so softmax in the next step does not become too peaked.",
    example: withModel((m, p, n) => {
      const i = n - 1;
      const j = argmax(m.scores[i]);
      return `The last token, ${q(m.tokens[i])}, scores highest against ${q(m.tokens[j])}: S[${i}][${j}] = q · k${p.scaleScores ? " / 2" : " (not scaled)"} = ${n3(m.scores[i][j])}.`;
    }),
    try: [
      { setting: "transformer.scaleScores", value: false, watch: "Every score doubles, and the attention weights in the next step get more extreme." },
      { setting: "transformer.positional", value: false, watch: "Two copies of the same token now get identical rows of scores." },
    ],
  },
  attention: {
    what: "Each row of scores is turned into weights between 0 and 1 that add up to 1 (softmax). With the causal mask, a token gets weight 0 for every token after it.",
    why: "Weights that add to 1 make the next step a fair average. The mask matters because a model that writes left to right must not peek at words that do not exist yet.",
    example: withModel((m, p, n) => {
      const i = n - 1;
      const j = argmax(m.weights[i]);
      const zeros = p.causalMask ? m.weights.reduce((s, row, r) => s + row.filter((_, c) => c > r).length, 0) : 0;
      return `${q(m.tokens[i])} gives its largest weight, ${n3(m.weights[i][j])}, to ${q(m.tokens[j])}. ${p.causalMask ? `${zeros} cells above the diagonal are exactly 0 because of the mask.` : "The mask is off, so cells above the diagonal have weight too."}`;
    }),
    try: [
      { setting: "transformer.causalMask", value: false, watch: "The upper triangle of W fills in: early tokens now take from later ones." },
      { setting: "transformer.scaleScores", value: false, watch: "Rows get peakier: one weight near 1, the rest near 0." },
    ],
  },
  output: {
    what: "Each token builds a new row by blending the rows it attends to, using the weights from the previous step.",
    why: "This is where information moves between tokens. After it, a token's row carries some of the meaning of the words around it.",
    example: withModel((m, p, n) => {
      const i = n - 1;
      const parts = m.weights[i]
        .map((w, j) => [w, j])
        .filter(([w]) => w > 0)
        .sort((a, b) => b[0] - a[0])
        .slice(0, 3)
        .map(([w, j]) => `${n3(w)} × ${q(m.tokens[j])}`);
      return `O[${i}] for ${q(m.tokens[i])} is mostly ${parts.join(" + ")}${m.weights[i].filter((w) => w > 0).length > 3 ? " + …" : ""} = ${vec(m.output[i])}.`;
    }),
    try: [
      { setting: "transformer.causalMask", value: false, watch: "Row 0 is no longer just its own value: it now blends in later tokens." },
    ],
  },
  residual: {
    what: "The block's input is added back to the attention output (a residual connection), then each row is rescaled to mean 0 and variance 1 (layer norm).",
    why: "Adding the input back keeps each token's own information even if attention looked elsewhere. Normalizing keeps the numbers in a steady range as layers stack up.",
    example: withModel((m, p) => {
      const s = m.norm1Steps[0];
      return `Row 0: R = ${p.residual ? `O + X = ${vec(m.output[0])} + ${vec(m.positions[0])}` : "O (residual off)"} = ${vec(m.residual[0])}. Its mean is ${n3(s.mean)} and std ${n3(s.std)}, so H₁[0] = ${vec(m.norm1[0])}.`;
    }),
    try: [
      { setting: "transformer.residual", value: false, watch: "R equals O: the token's own row is no longer added back, here and after the feed-forward layer." },
    ],
  },
  feedforward: {
    what: "Each token's row goes through a tiny network on its own: widen 4 numbers to 8, bend them with an activation, squeeze back to 4, add the input back and normalize.",
    why: "Attention only averages rows. The bend (GELU or ReLU) lets the layer compute things a straight-line mix cannot.",
    example: withModel((m, p, n) => {
      const i = n - 1;
      const cut = m.activated[i].filter((v) => v === 0).length;
      return `For ${q(m.tokens[i])}, h has 8 values from ${n3(Math.min(...m.hidden[i]))} to ${n3(Math.max(...m.hidden[i]))}. ${p.activation === "relu" ? `ReLU sets ${cut} negative one${cut === 1 ? "" : "s"} to exactly 0.` : "GELU pulls the negative ones toward 0 but not all the way."} The block's output row is H₂[${i}] = ${vec(m.norm2[i])}.`;
    }),
    try: [
      { setting: "transformer.activation", value: "relu", watch: "Negative hidden values become exactly 0 instead of small negatives." },
      { setting: "transformer.residual", value: false, watch: "H₂ is built from the feed-forward output alone." },
    ],
  },
  logits: {
    what: "The last token's row is compared with every token in the vocabulary, giving one score (logit) each. Softmax turns the scores into probabilities for the next token.",
    why: "Only the last position predicts what comes next. Temperature divides the scores first: below 1 sharpens the guess, above 1 flattens it.",
    example: (ctx) => {
      const m = modelOf(ctx);
      if (!m?.ranked?.length) return EMPTY;
      const p = paramsOf(ctx);
      const [a, b] = m.ranked;
      return `Out of ${m.vocabulary.length} tokens, ${q(a.token)} has the highest logit, ${n3(a.logit)}, and p = ${(a.probability * 100).toFixed(2)}%${b ? `; next is ${q(b.token)} at ${(b.probability * 100).toFixed(2)}%` : ""}. Temperature is ${p.temperature}.`;
    },
    try: [
      { setting: "transformer.temperature", value: 0.3, watch: "The top token's probability jumps up; the bars get very uneven." },
      { setting: "transformer.temperature", value: 2, watch: "Probabilities flatten toward an even split; the top token stays the same." },
    ],
  },
  decode: {
    what: "Greedy decoding picks the single most probable token, appends it, slides the window, and runs the whole block again.",
    why: "A model writes one token at a time, each based on everything before it. The weights here are untrained, so the chosen tokens are real arithmetic but not meaningful text.",
    example: (ctx) => {
      const m = modelOf(ctx);
      if (!m?.ranked?.length) return EMPTY;
      const p = paramsOf(ctx);
      const n = m.tokens.length;
      return `The next token is ${q(m.nextToken)} (p = ${m.ranked[0].probability.toFixed(4)}). Appended to the ${n}-token window it makes ${n + 1}${n + 1 > p.context ? `, more than ${p.context}, so ${q(m.tokens[0])} drops off the front` : `, within the ${p.context}-token limit`}.`;
    },
    try: [
      { setting: "transformer.context", value: 4, watch: "The window keeps only 4 tokens, so after a few appends the start of your sentence is forgotten." },
      { setting: "transformer.temperature", value: 3, watch: "Probabilities flatten but greedy decoding still picks the same top token." },
    ],
  },
};
