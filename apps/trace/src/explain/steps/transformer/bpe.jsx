import { Panel, Table, Tag } from "../../kit.jsx";
import {
  CORPUS,
  END,
  TRANSFORMER_DEFAULTS,
  inspectBPE,
  preTokenize,
  trainBPEDetailed,
  vocabularyFor,
  wordCounts,
} from "../../../engine/transformer.js";
import { tableBlock } from "../../../map/blocks.js";
import { Chips, Piece, Pieces, cells, paramsOf, quote, range, toTokens, tunedSay } from "./shared.jsx";

// Training does not depend on the request, so it runs once per merge count.
const COUNTS = wordCounts();
const CORPUS_WORDS = preTokenize(CORPUS);
const LINES = CORPUS.split("\n");
const SAMPLE = 8; // changed words listed per training round
const PER_MERGE_LIMIT = 90; // above this many applied merges, one frame per word
const MERGE_ROWS = 15;
const trainings = new Map();
function trainingFor(n = TRANSFORMER_DEFAULTS.merges) {
  if (!trainings.has(n)) {
    const { initial, rounds } = trainBPEDetailed(CORPUS, n);
    trainings.set(n, {
      n,
      initial,
      rounds,
      groups: Math.max(1, Math.ceil(rounds.length / MERGE_ROWS)),
      vocabulary: vocabularyFor(n),
    });
  }
  return trainings.get(n);
}
const trainingOf = (ctx) => trainingFor(paramsOf(ctx).merges);

const pairSay = ([a, b]) => `${quote(a)} + ${quote(b)}`;
const brackets = (pieces) => `[${pieces.join(", ")}]`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Words whose pieces changed in round k (training keeps wordCounts order).
function changedWords(T, k) {
  const prev = k ? T.rounds[k - 1].words : T.initial;
  return T.rounds[k].words
    .map((w, i) => ({ word: COUNTS[i].word, count: w.count, before: prev[i].pieces, after: w.pieces }))
    .filter((w) => w.before.length !== w.after.length);
}

// For each request token, the index of the word it came from.
const ownersOf = (words) => words.flatMap((w, wi) => toTokens(w.pieces).map(() => wi));

// Map layout: the corpus counts and the merge list wrap into side-by-side groups.
const show = (piece) => piece.replace(END, "▁");
const pairText = ([a, b]) => `${show(a)} + ${show(b)}`;
const CORPUS_ROWS = Math.ceil(COUNTS.length / 4);
const corpusIndex = (r, c) => Math.floor(c / 2) * CORPUS_ROWS + r;
const corpusCells = (i) => cells([i % CORPUS_ROWS], [0, 1].map((k) => Math.floor(i / CORPUS_ROWS) * 2 + k));
const mergeIndex = (r, c) => Math.floor(c / 3) * MERGE_ROWS + r;
const mergeCells = (k) => cells([k % MERGE_ROWS], [0, 1, 2].map((j) => Math.floor(k / MERGE_ROWS) * 3 + j));
const TOP_WORDS = [...COUNTS].sort((a, b) => b.count - a.count).slice(0, 3);

// Where the winning pair of round k occurs: occurrences per word × word count.
function contributions(T, k) {
  const prev = k ? T.rounds[k - 1].words : T.initial;
  const [a, b] = T.rounds[k].pair;
  return prev
    .map((w, i) => {
      let occ = 0;
      for (let j = 0; j < w.pieces.length - 1; j++) if (w.pieces[j] === a && w.pieces[j + 1] === b) occ++;
      return { i, word: COUNTS[i].word, occ, count: w.count };
    })
    .filter((x) => x.occ);
}
const countSum = (T, k) =>
  contributions(T, k)
    .map((x) => `${x.occ > 1 ? `${x.occ}×` : ""}${x.count} (${x.word})`)
    .join(" + ");

// The request's words and, for each position of the model window, the word
// it came from (-1 for a token appended by decoding).
function windowOf(ctx) {
  const { trace, data, generatedTokens = [] } = ctx;
  const p = paramsOf(ctx);
  const bpe = data.bpe ?? inspectBPE(trace.original, p.merges);
  const owners = [...ownersOf(bpe.words).slice(0, p.context), ...generatedTokens.map(() => -1)].slice(-p.context);
  return { bpe, owners, context: p.context };
}

export default {
  id: "bpe",
  source: [
    ["transformer", "preTokenize"],
    ["transformer", "wordCounts"],
    ["transformer", "mergePair"],
    ["transformer", "trainBPEDetailed"],
    ["transformer", "inspectBPE"],
    ["transformer", "encodeBPE"],
  ],
  code: [
    "words = preTokenize(CORPUS)  // lowercase; letter/digit runs or one symbol",
    "vocab = wordCounts(CORPUS)  // [{ word, count }], one per distinct word",
    "corpus = vocab.map(w => [...w.word, \"</w>\"])",
    "for (let step = 0; step < merges; step++) {  // merges setting, default 60",
    "  counts = each adjacent pair (a, b), + word count per occurrence",
    "  best = highest count; ties: alphabetical by pair text",
    "  if (best.count < 2) break",
    "  corpus = corpus.map(p => mergePair(p, best.pair))  // a, b → ab",
    "  merges.push(best.pair)",
    "}",
    "for (const word of preTokenize(request)) {",
    "  let pieces = [...word, \"</w>\"]",
    "  merges.forEach(pair => pieces = mergePair(pieces, pair))  // training order",
    "  tokens.push(...pieces)  // lone \"</w>\" dropped, trailing \"</w>\" shown as ▁",
    "}",
    "window = tokens.slice(0, context)  // context setting, default 16",
    "window = [...window, ...generated].slice(-context)  // after decoding",
  ],
  frames(ctx) {
    const { model, generatedTokens = [] } = ctx;
    const p = paramsOf(ctx);
    const T = trainingOf(ctx);
    const ROUNDS = T.rounds;
    const CONTEXT = p.context;
    const { bpe } = windowOf(ctx);
    const frames = [];

    // Corpus
    const top = [...COUNTS].sort((a, b) => b.count - a.count).slice(0, 3);
    const example = T.initial[COUNTS.indexOf(top[0])];
    frames.push({
      phase: "Corpus",
      line: 0,
      view: "text",
      say: `The tokenizer learns from a fixed corpus of ${LINES.length} short lines. preTokenize lowercases it and splits it into runs of letters or digits; any other non-space character is a word by itself. That gives ${CORPUS_WORDS.length} words.${tunedSay(p, ["merges", "context"])}`,
      vars: { "lines": LINES.length, "words.length": CORPUS_WORDS.length },
    });
    frames.push({
      phase: "Corpus",
      line: 1,
      view: "counts",
      say: `wordCounts keeps one entry per distinct word, with how often it occurs: ${COUNTS.length} distinct words. The most frequent are ${top.map((w) => `${quote(w.word)} (${w.count})`).join(", ")}.`,
      vars: { "vocab.length": COUNTS.length, ...Object.fromEntries(top.map((w) => [`count of ${quote(w.word)}`, w.count])) },
    });
    const symbols = new Set(T.initial.flatMap((w) => w.pieces)).size;
    frames.push({
      phase: "Corpus",
      line: 2,
      view: "pieces",
      say: `Each distinct word starts as its single characters plus an end marker </w>, so ${quote(top[0].word)} becomes ${brackets(example.pieces)}. The marker keeps a word ending apart from the same letters inside a longer word. There are ${symbols} different starting symbols.`,
      vars: { "starting symbols": symbols, [`corpus of ${quote(top[0].word)}`]: example.pieces },
    });

    // Training
    let tieExplained = false;
    ROUNDS.forEach((r, k) => {
      const changed = changedWords(T, k);
      const ties = r.top.slice(1).filter((t) => t.count === r.count);
      const allTied = ties.length === r.top.length - 1;
      const tie = ties.length
        ? ` ${ties.map((t) => pairSay(t.pair)).join(", ")}${allTied ? " and possibly others" : ""} also occur${ties.length === 1 && !allTied ? "s" : ""} ${r.count} times${tieExplained ? " but sort later" : "; a tie goes to the pair that sorts first alphabetically"}.`
        : "";
      if (ties.length) tieExplained = true;
      frames.push({
        phase: "Training",
        line: [4, 5, 7, 8],
        round: k,
        hold: 0.5,
        say: `Round ${k + 1}: ${pairSay(r.pair)} is the most frequent adjacent pair, ${r.count} times.${tie} Merging it into ${quote(r.merged)} changes ${changed.length} of the ${COUNTS.length} words.`,
        vars: { step: k, "best.pair": r.pair, "best.count": r.count, merged: r.merged, "merges.length": k + 1 },
      });
    });
    const V = T.vocabulary.length;
    frames.push({
      phase: "Training",
      line: ROUNDS.length < p.merges ? 6 : [3, 9],
      round: ROUNDS.length,
      say: !p.merges
        ? `The merges setting is 0, so training learns nothing: every character stays its own token. Encoding the corpus gives ${V} distinct tokens, one per character: the vocabulary the model scores in the last step.`
        : ROUNDS.length < p.merges
          ? `No pair occurs at least twice any more, so training stops after ${ROUNDS.length} merges, short of the ${p.merges} allowed. Encoding the corpus with them gives ${V} distinct tokens: the vocabulary the model scores in the last step.`
          : `Training stops at merges = ${p.merges}${p.merges === TRANSFORMER_DEFAULTS.merges ? "" : ` (the default is ${TRANSFORMER_DEFAULTS.merges})`}. The ordered list of ${ROUNDS.length} merges is the whole tokenizer. Encoding the corpus itself with it gives ${V} distinct tokens: the vocabulary the model scores in the last step.`,
      vars: { "merges.length": ROUNDS.length, "vocabulary.length": V },
    });

    // Encode
    const words = bpe.words;
    const totalApplied = words.reduce((s, w) => s + w.applied.length, 0);
    const perMerge = totalApplied <= PER_MERGE_LIMIT;
    const shown = words.slice(0, 14).map((w) => quote(w.word)).join(" ");
    frames.push({
      phase: "Encode",
      line: 10,
      word: -1,
      step: -1,
      say: words.length
        ? `The request goes through the same preTokenize: ${plural(words.length, "word")}, ${shown}${words.length > 14 ? " …" : ""}. Each word is encoded on its own by replaying the ${ROUNDS.length} merges in training order. In the printed tokens a trailing </w> is written ▁ and a lone </w> is dropped.`
        : "The request has no letters, digits or symbols, so preTokenize returns no words and there is nothing to encode.",
      vars: { "words.length": words.length, "merges.length": ROUNDS.length },
    });
    const firstApplied = words.findIndex((w) => w.applied.length);
    words.forEach((w, wi) => {
      const toks = toTokens(w.pieces);
      const lone = w.pieces.at(-1) === END ? " (the lone </w> at the end is dropped)" : "";
      const result = `${quote(w.word)} gives ${toks.length ? toks.map(quote).join(", ") : "no tokens"}${lone}.`;
      const none = !w.applied.length;
      frames.push({
        phase: "Encode",
        line: none ? [11, 12, 13] : 11,
        word: wi,
        step: none ? 0 : -1,
        hold: 0.8,
        say: `Word ${wi}, ${quote(w.word)}, starts as ${brackets(w.start)}. ${
          none
            ? `None of the merges finds a pair it knows, so ${result}`
            : `${w.applied.length} of the ${ROUNDS.length} merges change it${wi === firstApplied ? "; the others find no matching pair and do nothing" : ""}.`
        }`,
        vars: { word: w.word, pieces: w.start },
      });
      if (none) return;
      if (perMerge)
        w.applied.forEach((a, s) => {
          const last = s === w.applied.length - 1;
          frames.push({
            phase: "Encode",
            line: last ? [12, 13] : 12,
            word: wi,
            step: s,
            hold: 0.6,
            say: `Merge #${a.rank + 1}, ${pairSay(a.pair)}: ${brackets(a.before)} → ${brackets(a.after)}.${last ? ` No later merge applies, so ${result}` : ""}`,
            vars: { word: w.word, merge: a.rank + 1, pair: a.pair, pieces: a.after },
          });
        });
      else
        frames.push({
          phase: "Encode",
          line: [12, 13],
          word: wi,
          step: w.applied.length - 1,
          hold: 0.8,
          say: `Merges ${w.applied.map((a) => `#${a.rank + 1}`).join(", ")} apply, in that order. ${result[0].toUpperCase()}${result.slice(1)}`,
          vars: { word: w.word, pieces: w.pieces },
          bulk: true,
        });
    });

    // Window
    const all = bpe.final;
    const kept = all.slice(0, CONTEXT);
    const cut = all.slice(CONTEXT);
    const owners = ownersOf(words);
    frames.push({
      phase: "Window",
      line: 15,
      gen: false,
      owners: owners.slice(0, CONTEXT),
      say: all.length
        ? `The request gives ${plural(all.length, "subword token")}. The model reads at most context = ${CONTEXT}${CONTEXT === TRANSFORMER_DEFAULTS.context ? "" : ` (your setting; the default is ${TRANSFORMER_DEFAULTS.context})`}, so tokens 0 to ${kept.length - 1} go in${cut.length ? ` and the last ${cut.length} (${cut.map(quote).join(", ")}) are cut off` : ""}.`
        : "The request gives 0 tokens, so the model's window is empty and every later step works on an empty matrix.",
      vars: { "tokens.length": all.length, "window.length": kept.length, "cut off": cut.length },
    });
    if (generatedTokens.length) {
      const seq = [...kept, ...generatedTokens];
      const dropped = seq.slice(0, seq.length - model.tokens.length);
      frames.push({
        phase: "Window",
        line: 16,
        gen: true,
        owners: [...owners.slice(0, CONTEXT), ...generatedTokens.map(() => -1)].slice(-CONTEXT),
        say: `Decoding has appended ${plural(generatedTokens.length, "token")} (${generatedTokens.map(quote).join(", ")}). The window is the last ${CONTEXT} of these ${seq.length} tokens${dropped.length ? `, so the first ${dropped.length} (${dropped.map(quote).join(", ")}) fall out` : ""}. Every later step uses this window.`,
        vars: { "sequence.length": seq.length, "window.length": model.tokens.length, dropped: dropped.length },
      });
    }
    return frames;
  },
  blocks(ctx) {
    const { bpe, owners, context } = windowOf(ctx);
    const T = trainingOf(ctx);
    const window = ctx.data.transformer.tokens;
    const starts = []; // index of each word's first token
    bpe.words.reduce((first, w) => (starts.push(first), first + toTokens(w.pieces).length), 0);
    return [
      tableBlock({
        id: "corpus",
        title: `wordCounts(CORPUS): ${COUNTS.length} distinct words`,
        head: range(0, 4).flatMap(() => ["word", "n"]),
        widths: range(0, 4).flatMap(() => [1.35, 0.45]),
        rows: range(0, CORPUS_ROWS).map((r) =>
          range(0, 8).map((c) => {
            const w = COUNTS[corpusIndex(r, c)];
            if (!w) return null;
            return c % 2 ? { text: String(w.count), dim: true } : { text: w.word, align: "left" };
          }),
        ),
        explain: (r, c) => {
          const i = corpusIndex(r, c);
          const w = COUNTS[i];
          if (!w) return null;
          const start = T.initial[i].pieces;
          return c % 2
            ? {
                meaning: `How many times ${quote(w.word)} occurs in the training corpus.`,
                formula: "count = occurrences of the word in preTokenize(CORPUS)",
                worked: `count(${quote(w.word)}) = ${w.count}, so every pair inside it counts ${w.count} times`,
              }
            : {
                meaning: `${quote(w.word)}, one of the ${COUNTS.length} distinct words the tokenizer learns from.`,
                formula: "start = [...word, \"</w>\"]",
                worked: `${quote(w.word)} starts as ${brackets(start)} and ends as ${brackets(T.rounds.at(-1)?.words[i].pieces ?? start)}`,
              };
        },
      }),
      tableBlock({
        id: "merges",
        title: T.rounds.length ? "merges, in training order (▁ = </w>)" : "merges (none: merges = 0)",
        beside: true,
        head: range(0, T.groups).flatMap(() => ["#", "pair", "n"]),
        widths: range(0, T.groups).flatMap(() => [0.45, 1.6, 0.4]),
        rows: range(0, Math.min(MERGE_ROWS, T.rounds.length)).map((r) =>
          range(0, T.groups * 3).map((c) => {
            const k = mergeIndex(r, c);
            const x = T.rounds[k];
            if (!x) return null;
            return [{ text: String(k + 1), dim: true }, { text: pairText(x.pair) }, { text: String(x.count), dim: true }][c % 3];
          }),
        ),
        explain: (r, c) => {
          const k = mergeIndex(r, c);
          const x = T.rounds[k];
          if (!x) return null;
          return {
            meaning: `Merge #${k + 1}: wherever ${quote(show(x.pair[0]))} is followed by ${quote(show(x.pair[1]))}, glue them into ${quote(show(x.merged))}.`,
            formula: "pair = the most frequent adjacent pair after the earlier merges; count = Σ occurrences × word count; ties go alphabetically",
            worked: `count(${pairText(x.pair)}) = ${countSum(T, k)} = ${x.count}`,
          };
        },
      }),
      tableBlock({
        id: "words",
        title: "request words → subwords",
        head: ["word", "tokens"],
        widths: [1.35, 2.4],
        rows: bpe.words.map((w, wi) => {
          const toks = toTokens(w.pieces);
          const cut = toks.length > 0 && starts[wi] >= context;
          return [
            { text: w.word, align: "left" },
            { text: toks.join(" ") || "—", align: "left", tone: cut ? "muted" : undefined, full: cut ? `past the ${context}-token window` : undefined },
          ];
        }),
        explain: (r, c) => {
          const w = bpe.words[r];
          if (!w || c > 1) return null;
          const toks = toTokens(w.pieces);
          if (c === 0)
            return {
              meaning: `Word ${r} of your request, after lowercasing and splitting.`,
              formula: "preTokenize: runs of letters or digits, or one other symbol",
              worked: `${quote(w.word)} starts as ${brackets(w.start)}`,
            };
          return {
            meaning: `The subword tokens ${quote(w.word)} becomes${starts[r] >= context && toks.length ? `; they fall past the ${context}-token window` : ""}.`,
            formula: "replay every learned merge, in training order; drop a lone </w>, write a trailing one as ▁",
            worked: w.applied.length
              ? `${brackets(w.start)} → ${w.applied.map((x) => `#${x.rank + 1} ${pairText(x.pair)}`).join(", ")} → ${toks.map(quote).join(" ") || "no tokens"}`
              : `no merge applies, so ${brackets(w.start)} → ${toks.map(quote).join(" ") || "no tokens"}`,
          };
        },
      }),
      tableBlock({
        id: "subwords",
        title: `model window (${window.length} of ${context})`,
        head: ["#", "token"],
        widths: [0.45, 1.4],
        rows: window.map((t, p) => [{ text: String(p), dim: true }, { text: t, tone: owners[p] < 0 ? "good" : undefined }]),
        beside: true,
        explain: (r) => {
          const t = window[r];
          if (t === undefined) return null;
          const word = bpe.words[owners[r]]?.word;
          return {
            meaning: `The token at position ${r} of the model window: what every later step reads.`,
            formula: ctx.generatedTokens?.length
              ? `window = [...tokens.slice(0, ${context}), ...generated].slice(-${context})`
              : `window = tokens.slice(0, ${context})`,
            worked: word !== undefined ? `${quote(t)} comes from the word ${quote(word)}` : `${quote(t)} was appended by decoding`,
          };
        },
      }),
    ];
  },
  output: "subwords",
  state(frame, ctx) {
    const { bpe, owners } = windowOf(ctx);
    const none = () => false;
    if (frame.phase === "Corpus")
      return {
        corpus: {
          done: () => frame.view !== "text",
          active: frame.view === "counts" ? TOP_WORDS.flatMap((w) => corpusCells(COUNTS.indexOf(w))) : [],
          source: frame.view === "pieces" ? corpusCells(COUNTS.indexOf(TOP_WORDS[0])) : [],
        },
        merges: { done: none },
        words: { done: none },
        subwords: { done: none },
      };
    if (frame.phase === "Training") {
      const T = trainingOf(ctx);
      const k = frame.round;
      const r = T.rounds[k];
      return {
        corpus: { source: r ? contributions(T, k).flatMap((x) => corpusCells(x.i)) : [] },
        merges: { done: (row, c) => mergeIndex(row, c) <= k, active: r ? mergeCells(k) : [] },
        words: { done: none },
        subwords: { done: none },
      };
    }
    const positions = (pred) => range(0, owners.length).filter((p) => pred(owners[p]));
    if (frame.phase === "Encode") {
      const wi = frame.word;
      const w = bpe.words[wi];
      const finished = Boolean(w) && frame.step >= w.applied.length - 1;
      const used = !w ? [] : frame.bulk ? w.applied : w.applied.slice(frame.step, frame.step + 1);
      return {
        merges: { source: used.map((a) => mergeCells(a.rank)[1]) },
        words: {
          done: (r, c) => (c === 0 ? r <= wi : r < wi || (r === wi && finished)),
          active: w ? [[wi, finished ? 1 : 0]] : [],
        },
        subwords: {
          done: (p) => owners[p] >= 0 && (owners[p] < wi || (owners[p] === wi && finished)),
          active: finished ? cells(positions((o) => o === wi), [1]) : [],
        },
      };
    }
    return {
      words: { source: frame.gen ? [] : cells(range(0, bpe.words.length), [1]) },
      subwords: {
        done: (p) => frame.gen || owners[p] >= 0,
        active: cells(positions((o) => (frame.gen ? o < 0 : o >= 0)), [1]),
      },
    };
  },
  math(frame, ctx) {
    const { bpe, context: CONTEXT } = windowOf(ctx);
    const T = trainingOf(ctx);
    const ROUNDS = T.rounds;
    if (frame.phase === "Corpus") {
      if (frame.view === "text")
        return [{ label: "preTokenize(CORPUS)", terms: [`${LINES.length} lines`], result: `${CORPUS_WORDS.length} words` }];
      if (frame.view === "counts")
        return [
          { label: "distinct words", terms: [`${CORPUS_WORDS.length} words`], result: COUNTS.length },
          { label: "most frequent", terms: [TOP_WORDS.map((w) => `${w.word} ×${w.count}`).join(", ")] },
        ];
      const ex = T.initial[COUNTS.indexOf(TOP_WORDS[0])];
      return [
        { label: TOP_WORDS[0].word, terms: [brackets(ex.pieces)] },
        { label: "starting symbols", terms: ["distinct characters + </w>"], result: new Set(T.initial.flatMap((w) => w.pieces)).size },
      ];
    }
    if (frame.phase === "Training") {
      const r = ROUNDS[frame.round];
      if (!r)
        return [
          { label: "merges", terms: [`${ROUNDS.length} rounds (merges = ${T.n})`], result: ROUNDS.length },
          { label: "vocabulary", terms: ["distinct tokens of encodeBPE(CORPUS)"], result: T.vocabulary.length },
        ];
      const ties = r.top.filter((t) => t.count === r.count);
      return [
        {
          label: `count(${pairText(r.pair)})`,
          terms: contributions(T, frame.round).map((x) => `${x.word} ${x.occ > 1 ? `${x.occ}×` : ""}${x.count}`),
          result: r.count,
        },
        { label: "next best", terms: [r.top.slice(1, 4).map((t) => `${pairText(t.pair)} (${t.count})`).join(", ")] },
        ...(ties.length > 1
          ? [{ label: "tie-break", terms: [`${ties.map((t) => pairText(t.pair)).join(" < ")} alphabetically, so ${pairText(r.pair)} wins`] }]
          : []),
        { label: "merge", terms: [`${r.pair[0]} + ${r.pair[1]}`], result: r.merged },
      ];
    }
    if (frame.phase === "Encode") {
      const w = bpe.words[frame.word];
      if (!w) return [{ label: "preTokenize(request)", terms: [bpe.words.map((x) => x.word).join(" ") || "nothing"], result: `${bpe.words.length} words` }];
      const toks = { label: "tokens", terms: [toTokens(w.pieces).map((t) => `“${t}”`).join(", ") || "none"] };
      if (frame.step < 0)
        return [
          { label: w.word, terms: [brackets(w.start)] },
          { label: "merges that apply", terms: [w.applied.length ? w.applied.map((a) => `#${a.rank + 1}`).join(", ") : "none"] },
        ];
      if (frame.bulk || !w.applied.length)
        return [
          ...w.applied.slice(0, 7).map((a) => ({ label: `#${a.rank + 1} ${pairText(a.pair)}`, terms: [brackets(a.before), brackets(a.after)], op: "→" })),
          toks,
        ];
      const a = w.applied[frame.step];
      const lines = [{ label: `#${a.rank + 1} ${pairText(a.pair)}`, terms: [brackets(a.before), brackets(a.after)], op: "→" }];
      return frame.step === w.applied.length - 1 ? [...lines, toks] : lines;
    }
    const all = bpe.final;
    if (frame.gen) {
      const gen = ctx.generatedTokens ?? [];
      const seq = Math.min(all.length, CONTEXT) + gen.length;
      return [
        { label: "sequence", terms: [`${Math.min(all.length, CONTEXT)} request`, `${gen.length} generated`], result: seq },
        { label: "window", terms: [`sequence.slice(-${CONTEXT})`], result: `drops ${Math.max(0, seq - CONTEXT)}` },
      ];
    }
    return [
      { label: "tokens", terms: [`${all.length} subwords`], result: all.length },
      { label: "window", terms: [`tokens.slice(0, ${CONTEXT})`], result: `${Math.min(all.length, CONTEXT)} tokens` },
      ...(all.length > CONTEXT ? [{ label: "cut off", terms: [all.slice(CONTEXT).map((t) => `“${t}”`).join(", ")] }] : []),
    ];
  },
  Stage({ ctx, frame, frames, seek }) {
    const { bpe, context } = windowOf(ctx);
    const T = trainingOf(ctx);
    if (frame.phase === "Corpus") return <Corpus view={frame.view} T={T} />;
    if (frame.phase === "Training") return <Training T={T} k={frame.round ?? 0} frames={frames} seek={seek} />;
    if (frame.phase === "Encode") return <Encode words={bpe.words} context={context} frame={frame} frames={frames} seek={seek} />;
    return (
      <Window
        bpe={bpe}
        context={context}
        window={ctx.model.tokens}
        generated={ctx.generatedTokens ?? []}
        frame={frame}
        frames={frames}
        seek={seek}
      />
    );
  },
};

function Corpus({ view, T }) {
  if (view === "text")
    return (
      <div className="x-stack">
        <Panel title={`CORPUS (${LINES.length} lines)`}>
          <pre className="t-corpus">{CORPUS}</pre>
        </Panel>
        <Panel
          title={`preTokenize(CORPUS): ${CORPUS_WORDS.length} words`}
          note="Lowercased. Spaces only separate words; they are not kept."
        >
          <Chips items={CORPUS_WORDS} sub={(i) => i} />
        </Panel>
      </div>
    );
  const pieces = view === "pieces";
  return (
    <Panel
      title={`wordCounts(CORPUS): ${COUNTS.length} distinct words, in order of first appearance`}
      note={pieces ? "A pair inside a word that occurs 8 times is counted 8 times." : undefined}
    >
      <Table
        className="t-scroll"
        head={["#", "word", "count", ...(pieces ? ["starting symbols"] : [])]}
        rows={COUNTS.map((w, i) => [
          i,
          <code key="w">{w.word}</code>,
          w.count,
          ...(pieces ? [<Pieces key="p" pieces={T.initial[i].pieces} />] : []),
        ])}
      />
    </Panel>
  );
}

function MergeList({ T, k, frames, seek }) {
  const ROUNDS = T.rounds;
  const goRound = (i) => seek(frames.findIndex((f) => f.phase === "Training" && f.round === i));
  const learned = Math.min(k + 1, ROUNDS.length);
  return (
    <Panel title={`Merge list (${learned} of ${ROUNDS.length})`} note="Click a merge to replay its round.">
      <div className="t-merges">
        {ROUNDS.map((x, i) => (
          <button
            key={i}
            className={i === k ? "is-active" : i > k ? "is-pending" : ""}
            onClick={() => goRound(i)}
          >
            <small>{i + 1}</small>
            <Piece text={x.pair[0]} />
            <Piece text={x.pair[1]} />
          </button>
        ))}
      </div>
    </Panel>
  );
}

function Training({ T, k, frames, seek }) {
  const r = T.rounds[k];
  const VOCABULARY = T.vocabulary;
  if (!r)
    return (
      <div className="x-stack">
        <MergeList T={T} k={k} frames={frames} seek={seek} />
        <Panel
          title={`VOCABULARY: ${VOCABULARY.length} tokens`}
          note="encodeBPE(CORPUS) with duplicates removed, in order of first appearance. ▁ marks a word end."
        >
          <Chips items={VOCABULARY} sub={(i) => i} />
        </Panel>
      </div>
    );
  const changed = changedWords(T, k);
  return (
    <div className="x-stack">
      <div className="x-row-wrap">
        <Panel title={`Round ${k + 1}: the most frequent pairs`}>
          <Table
            head={["rank", "pair (a, b)", "count", ""]}
            active={0}
            rows={r.top.map((t, i) => [
              i + 1,
              <Pieces key="p" pieces={t.pair} />,
              t.count,
              i === 0 ? (
                <Tag key="t" kind="pass">merged</Tag>
              ) : t.count === r.count ? (
                <Tag key="t" kind="skip">tie, sorts later</Tag>
              ) : (
                ""
              ),
            ])}
          />
        </Panel>
        <Panel title="Merge">
          <div className="t-merge-row">
            <Pieces pieces={r.pair} cls={() => "is-pair"} />
            <span className="t-arrow">→</span>
            <Piece text={r.merged} cls="is-new" />
          </div>
          <p className="x-note">count {r.count}</p>
        </Panel>
      </div>
      <Panel
        title={`Words changed by this merge (${changed.length} of ${COUNTS.length})`}
        note={changed.length > SAMPLE ? `Showing ${SAMPLE}; ${changed.length - SAMPLE} more change the same way.` : undefined}
      >
        <Table
          head={["word", "count", "before", "after"]}
          rows={changed.slice(0, SAMPLE).map((w) => [
            <code key="w">{w.word}</code>,
            w.count,
            <Pieces key="b" pieces={w.before} />,
            <Pieces key="a" pieces={w.after} cls={(i) => (w.after[i] === r.merged ? "is-new" : "")} />,
          ])}
        />
      </Panel>
      <MergeList T={T} k={k} frames={frames} seek={seek} />
    </div>
  );
}

function Encode({ words, context: CONTEXT, frame, frames, seek }) {
  const wi = frame.word;
  const w = words[wi];
  const goWord = (i) => seek(frames.findLastIndex((f) => f.phase === "Encode" && f.word === i));
  const finished = w && frame.step >= w.applied.length - 1;
  const before = words.slice(0, Math.max(0, wi)).flatMap((x) => toTokens(x.pieces));
  const current = finished ? toTokens(w.pieces) : [];
  return (
    <div className="x-stack">
      <Panel title={`preTokenize(request): ${plural(words.length, "word")}`} note={words.length ? "Click a word to jump to it." : undefined}>
        {words.length ? (
          <Chips
            items={words.map((x) => x.word)}
            sub={(i) => i}
            cls={(i) => (i === wi ? "is-active" : i < wi ? "is-done" : "is-pending")}
            onPick={goWord}
          />
        ) : (
          <p className="x-note">No words.</p>
        )}
      </Panel>
      {w && (
        <Panel
          title={`Word ${wi}: ${quote(w.word)}`}
          note="Merges are tried in training order. Only the ones that change this word are listed; the rest find no matching pair."
        >
          <div className="t-merge-row">
            <span>start</span>
            <Pieces pieces={w.start} />
          </div>
          {w.applied.length ? (
            <Table
              head={["merge #", "pair", "pieces after"]}
              active={frame.step}
              rows={w.applied.map((a, s) =>
                s <= frame.step
                  ? [
                      a.rank + 1,
                      <Pieces key="p" pieces={a.pair} />,
                      <Pieces
                        key="a"
                        pieces={a.after}
                        cls={(i) => (s === frame.step && a.after[i] === a.pair.join("") ? "is-new" : "")}
                      />,
                    ]
                  : { cls: "is-pending", cells: ["…", "…", "…"] },
              )}
            />
          ) : (
            <p className="x-note">No merge applies.</p>
          )}
          {finished && (
            <div className="t-merge-row">
              <span>tokens</span>
              {current.length ? <Chips items={current} /> : <span>none</span>}
            </div>
          )}
        </Panel>
      )}
      <Panel title={`Tokens so far (${before.length + current.length})`}>
        {before.length + current.length ? (
          <Chips
            items={[...before, ...current]}
            sub={(i) => i}
            cls={(i) => (i >= before.length ? "is-active" : i >= CONTEXT ? "is-cut" : "")}
          />
        ) : (
          <p className="x-note">None yet.</p>
        )}
      </Panel>
    </div>
  );
}

function Window({ bpe, context: CONTEXT, window, generated, frame, frames, seek }) {
  const all = bpe.final;
  const kept = all.slice(0, CONTEXT);
  const owners = frame.owners ?? [];
  const tokens = frame.gen ? window : kept;
  const seq = [...kept, ...generated];
  const drop = seq.length - window.length;
  const goToken = (i) => {
    const owner = ownersOf(bpe.words)[i];
    const at = frames.findLastIndex((f) => f.phase === "Encode" && f.word === owner);
    if (at >= 0) seek(at);
  };
  return (
    <div className="x-stack">
      <Panel
        title={`Request tokens (${all.length})`}
        note={`▁ marks the end of a word (a trailing </w>).${all.length > CONTEXT ? ` Crossed out: past the first ${CONTEXT}, cut off.` : ""} Click a token to see how its word was encoded.`}
      >
        {all.length ? (
          <Chips items={all} sub={(i) => i} cls={(i) => (i >= CONTEXT ? "is-cut" : "is-done")} onPick={goToken} />
        ) : (
          <p className="x-note">No tokens.</p>
        )}
      </Panel>
      {frame.gen && (
        <Panel
          title={`After decoding: ${seq.length} tokens, the window is the last ${CONTEXT}`}
          note="Green border: appended by decoding. Crossed out: no longer in the window."
        >
          <Chips
            items={seq}
            sub={(i) => (i < drop ? "out" : i - drop)}
            cls={(i) => (i < drop ? "is-drop" : i >= kept.length ? "is-gen" : "is-done")}
          />
        </Panel>
      )}
      <Panel title={`Model window: ${tokens.length} of ${CONTEXT} positions`}>
        <Table
          head={["position", "token", "characters", "from word"]}
          rows={tokens.map((t, p) => [
            p,
            <code key="t">{t}</code>,
            Array.from(t).length,
            owners[p] >= 0 ? <code key="w">{bpe.words[owners[p]]?.word}</code> : "appended by decoding",
          ])}
        />
      </Panel>
    </div>
  );
}
