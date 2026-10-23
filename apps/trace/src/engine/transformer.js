// A one-block, one-head toy transformer. Every weight is a fixed formula or a
// literal matrix written below; nothing is trained and no model is loaded.
export const D_MODEL = 4;
export const D_FF = 8;
export const CONTEXT = 16;
export const MAX_MERGES = 60;

// Training text for the tokenizer. Word frequency matters: BPE merges the pair
// that occurs most often across every occurrence of every word.
export const CORPUS = `remind me to call my advisor tomorrow at 9 am
remind me to submit the report on friday
move my advisor reminder to october 20 at 11 am
remind me to study every friday at 4 pm for 4 weeks
find my report reminder
call my advisor about the course
move my study reminder to tomorrow
remind me to pay the housing bill
delete my reminder to call the professor
remind me to meet my professor on monday at 11 am
submit the lab report tomorrow at 3 pm
study for mobile computing on thursday`;

export const END = "</w>";
const WORD = /[\p{L}\p{N}]+|[^\s]/gu;
export const preTokenize = (text) => text.toLowerCase().match(WORD) || [];

export function wordCounts(text = CORPUS) {
  const counts = new Map();
  for (const word of preTokenize(text))
    counts.set(word, (counts.get(word) || 0) + 1);
  return [...counts].map(([word, count]) => ({ word, count }));
}

export function mergePair(pieces, pair) {
  const result = [];
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i] === pair[0] && pieces[i + 1] === pair[1]) {
      result.push(pieces[i] + pieces[i + 1]);
      i++;
    } else result.push(pieces[i]);
  }
  return result;
}

// Returns every training round: the pair counts, the winning pair and the
// corpus after the merge. Ties break alphabetically so runs are reproducible.
export function trainBPEDetailed(text = CORPUS, steps = MAX_MERGES) {
  const vocab = wordCounts(text);
  let words = vocab.map(({ word, count }) => ({
    pieces: [...word, END],
    count,
  }));
  const initial = words.map((w) => ({ ...w, pieces: [...w.pieces] }));
  const rounds = [];
  for (let step = 0; step < steps; step++) {
    const counts = new Map();
    for (const { pieces, count } of words)
      for (let i = 0; i < pieces.length - 1; i++) {
        const key = JSON.stringify([pieces[i], pieces[i + 1]]);
        counts.set(key, (counts.get(key) || 0) + count);
      }
    const ranked = [...counts]
      .map(([key, count]) => ({ pair: JSON.parse(key), key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
    const best = ranked[0];
    if (!best || best.count < 2) break;
    words = words.map((w) => ({ ...w, pieces: mergePair(w.pieces, best.pair) }));
    rounds.push({
      pair: best.pair,
      count: best.count,
      merged: best.pair.join(""),
      top: ranked.slice(0, 6).map(({ pair, count }) => ({ pair, count })),
      words: words.map((w) => ({ ...w, pieces: [...w.pieces] })),
    });
  }
  return { initial, rounds };
}

export function trainBPE(text = CORPUS, steps = MAX_MERGES) {
  return trainBPEDetailed(text, steps).rounds.map(({ pair, count, merged }) => ({
    pair,
    count,
    merged,
  }));
}

export const BPE_MERGES = trainBPE();
const display = (piece) => piece.replace(END, "▁");

// Applies the learned merges, in training order, to each word of `text`.
export function inspectBPE(text) {
  const words = preTokenize(text).map((word) => {
    let pieces = [...word, END];
    const applied = [];
    BPE_MERGES.forEach(({ pair }, rank) => {
      const next = mergePair(pieces, pair);
      if (next.length !== pieces.length)
        applied.push({ rank, pair, before: pieces, after: next });
      pieces = next;
    });
    return { word, start: [...word, END], applied, pieces };
  });
  return { words, final: encodeBPE(text) };
}

export function encodeBPE(text) {
  return preTokenize(text).flatMap((word) => {
    let pieces = [...word, END];
    BPE_MERGES.forEach(({ pair }) => {
      pieces = mergePair(pieces, pair);
    });
    return pieces.filter((p) => p !== END).map(display);
  });
}

export const VOCABULARY = [...new Set(encodeBPE(CORPUS))];

// The "table lookup" for embeddings and the vocabulary head is a formula of
// the token's characters, so any subword has a row, seen in training or not.
export const tokenCode = (token) =>
  Array.from(token).reduce((sum, c, i) => sum + c.codePointAt(0) * (i + 1), 0);
export const embeddingRow = (token) => {
  const code = tokenCode(token);
  return Array.from({ length: D_MODEL }, (_, i) =>
    Math.sin(code * (i + 1) * 0.017),
  );
};
// Vaswani et al. (2017): PE(pos, 2k) = sin(pos / 10000^(2k/d)),
// PE(pos, 2k + 1) = cos(pos / 10000^(2k/d)).
export const positionRow = (pos) =>
  Array.from({ length: D_MODEL }, (_, i) => {
    const angle = pos / 10000 ** ((2 * Math.floor(i / 2)) / D_MODEL);
    return i % 2 ? Math.cos(angle) : Math.sin(angle);
  });

// Row-vector convention: q = x · W_Q, so W[d][j] links input dim d to output j.
export const W_Q = [
  [0.7, 0, 0, 0.3],
  [0.3, 0.7, 0, 0],
  [0, 0.3, 0.7, 0],
  [0, 0, 0.3, 0.7],
];
export const W_K = [
  [0.6, 0, -0.2, 0],
  [0, 0.6, 0, -0.2],
  [-0.2, 0, 0.6, 0],
  [0, -0.2, 0, 0.6],
];
export const W_V = [
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
];
export const W_1 = Array.from({ length: D_MODEL }, (_, d) =>
  Array.from({ length: D_FF }, (_, h) => Math.sin((d + 1) * (h + 1) * 0.79) * 0.4),
);
export const B_1 = Array.from({ length: D_FF }, (_, h) => Math.sin(h) * 0.05);
export const W_2 = Array.from({ length: D_FF }, (_, h) =>
  Array.from({ length: D_MODEL }, (_, d) => Math.cos((h + 1) * (d + 2) * 0.43) * 0.3),
);
export const unembedRow = (token) => {
  const code = tokenCode(token);
  return Array.from({ length: D_MODEL }, (_, d) =>
    Math.sin((code + 1) * (d + 1) * 0.013) * 0.5,
  );
};
export const SCALE = Math.sqrt(D_MODEL);
export const EPSILON = 1e-5;

export const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
export const vecMat = (x, W, bias) =>
  W[0].map((_, j) => x.reduce((sum, v, d) => sum + v * W[d][j], bias ? bias[j] : 0));

export function softmaxSteps(scores) {
  const max = Math.max(...scores);
  const shifted = scores.map((x) => x - max);
  const exps = shifted.map(Math.exp);
  const sum = exps.reduce((a, b) => a + b, 0);
  return { max, shifted, exps, sum, probs: exps.map((x) => x / sum) };
}
export const softmax = (scores) => softmaxSteps(scores).probs;

export function layerNormSteps(row) {
  if (!row.length)
    return { mean: 0, deviations: [], variance: 0, std: 0, out: [] };
  const mean = row.reduce((a, b) => a + b, 0) / row.length;
  const deviations = row.map((v) => v - mean);
  const variance = deviations.reduce((sum, v) => sum + v * v, 0) / row.length;
  const std = Math.sqrt(variance + EPSILON);
  return { mean, deviations, variance, std, out: deviations.map((v) => v / std) };
}
export const layerNorm = (row) => layerNormSteps(row).out;

export const GELU_C = Math.sqrt(2 / Math.PI);
export const gelu = (x) => 0.5 * x * (1 + Math.tanh(GELU_C * (x + 0.044715 * x ** 3)));

export function attention(text, options = {}) {
  const tokens = options.tokenWindow
    ? options.tokenWindow.slice(-CONTEXT)
    : encodeBPE(text).slice(0, CONTEXT);
  const embeddings = tokens.map(embeddingRow);
  const positional = tokens.map((_, pos) => positionRow(pos));
  const positions = embeddings.map((row, pos) =>
    row.map((v, i) => v + positional[pos][i]),
  );
  const query = positions.map((x) => vecMat(x, W_Q));
  const key = positions.map((x) => vecMat(x, W_K));
  const value = positions.map((x) => vecMat(x, W_V));
  const scores = query.map((q) => key.map((k) => dot(q, k) / SCALE));
  const masked = scores.map((row, i) =>
    row.map((v, j) => (j > i ? -Infinity : v)),
  );
  const softmaxRows = masked.map(softmaxSteps);
  const weights = softmaxRows.map((s) => s.probs);
  const output = weights.map((row) =>
    Array.from({ length: D_MODEL }, (_, d) =>
      row.reduce((sum, w, j) => sum + w * value[j][d], 0),
    ),
  );
  const residual = output.map((row, i) => row.map((v, d) => v + positions[i][d]));
  const norm1Steps = residual.map(layerNormSteps);
  const norm1 = norm1Steps.map((s) => s.out);
  const hidden = norm1.map((x) => vecMat(x, W_1, B_1));
  const activated = hidden.map((row) => row.map(gelu));
  const feedforward = activated.map((h) => vecMat(h, W_2));
  const residual2 = feedforward.map((row, i) => row.map((v, d) => v + norm1[i][d]));
  const norm2Steps = residual2.map(layerNormSteps);
  const norm2 = norm2Steps.map((s) => s.out);
  const vocabulary = VOCABULARY;
  const unembedding = vocabulary.map(unembedRow);
  const last = norm2.at(-1) || Array(D_MODEL).fill(0);
  const logits = unembedding.map((row) => dot(last, row));
  const vocabSoftmax = softmaxSteps(logits);
  const probabilities = vocabSoftmax.probs;
  const ranked = vocabulary
    .map((token, i) => ({
      token,
      index: i,
      logit: logits[i],
      probability: probabilities[i],
    }))
    .sort((a, b) => b.probability - a.probability || a.index - b.index);
  return {
    tokens,
    embeddings,
    positional,
    positions,
    query,
    key,
    value,
    scores,
    masked,
    softmaxRows,
    weights,
    output,
    residual,
    norm1Steps,
    norm1,
    hidden,
    activated,
    feedforward,
    residual2,
    norm2Steps,
    norm2,
    vocabulary,
    unembedding,
    logits,
    vocabSoftmax,
    probabilities,
    ranked,
    nextToken: ranked[0]?.token,
  };
}
