// Every setting a visitor can tune, per track. The Tune panel draws its form
// from this list, the code view edits the same object as JSON, and lessons
// refer to a setting by `track.key`.
//
// Setting: { key, label, type, default, help, steps, ...type options }
//   type "number" | "int": min, max, step
//   type "bool"
//   type "select": options [{ value, label }]
//   type "words": a list of lowercase words (stop word lists)
//   type "pairs": an object of word → word (aliases)
// `steps` are the step ids whose output the setting can change.
import { COPILOT_DEFAULTS } from "../engine/copilot.js";
import { PLANNER_DEFAULTS } from "../engine/pipeline.js";
import { TRANSFORMER_DEFAULTS } from "../engine/transformer.js";

export const SETTINGS = {
  planner: [
    {
      key: "stopWords",
      label: "Stop words",
      type: "words",
      help: "Words treated as filler: never search terms, never part of the title's meaning.",
      steps: ["tokenize", "filter", "vectorize", "retrieve", "decide"],
    },
    {
      key: "aliases",
      label: "Aliases",
      type: "pairs",
      help: "Spellings mapped to one term before searching, written as word=term.",
      steps: ["filter", "vectorize", "retrieve", "decide"],
    },
    {
      key: "dropDates",
      label: "Drop month and weekday names",
      type: "bool",
      help: "Keep dates out of the search terms, so “friday” does not have to match a title.",
      steps: ["filter", "vectorize", "retrieve", "decide"],
    },
    {
      key: "useIdf",
      label: "Weight rare words higher (IDF)",
      type: "bool",
      help: "Off: every term counts the same, so common words weigh as much as rare ones.",
      steps: ["vectorize", "retrieve", "decide"],
    },
    {
      key: "smoothIdf",
      label: "Smoothed IDF",
      type: "bool",
      help: "Add one to both counts, ln((N+1)/(df+1)) + 1, so no term ever gets an infinite or zero weight.",
      steps: ["vectorize", "retrieve", "decide"],
    },
    {
      key: "matchThreshold",
      label: "Match threshold",
      type: "number",
      min: 0,
      max: 1,
      step: 0.01,
      help: "A record counts as a match only when its cosine score is above this.",
      steps: ["retrieve", "decide"],
    },
    {
      key: "tieGap",
      label: "Tie gap",
      type: "number",
      min: 0,
      max: 1,
      step: 0.01,
      help: "When the top two scores are closer than this, the planner asks which one you meant.",
      steps: ["decide"],
    },
  ],
  copilot: [
    {
      key: "stopwords",
      label: "Stop words",
      type: "words",
      help: "Words removed before hashing. The server's list has 32.",
      steps: ["searchwords", "hashvector", "retrieval"],
    },
    {
      key: "queryChars",
      label: "Query length (characters)",
      type: "int",
      min: 20,
      max: 2000,
      step: 10,
      help: "Only the first part of your message is searched.",
      steps: ["searchwords", "hashvector", "retrieval"],
    },
    {
      key: "dimensions",
      label: "Vector slots",
      type: "int",
      min: 8,
      max: 4096,
      step: 8,
      help: "How many numbered boxes words are hashed into. Fewer boxes, more words share one (collisions).",
      steps: ["hashvector", "retrieval"],
    },
    {
      key: "logWeight",
      label: "Damp repeated words (1 + ln count)",
      type: "bool",
      help: "Off: a word said three times weighs three times as much.",
      steps: ["hashvector", "retrieval"],
    },
    {
      key: "titleBoost",
      label: "Title boost",
      type: "number",
      min: 0,
      max: 6,
      step: 0.5,
      help: "Extra count added for a word that appears in a record's title.",
      steps: ["retrieval"],
    },
    {
      key: "candidates",
      label: "Candidates considered",
      type: "int",
      min: 1,
      max: 100,
      step: 1,
      help: "How many nearest records are looked at before the filters.",
      steps: ["retrieval"],
    },
    {
      key: "maxDistance",
      label: "Distance cutoff",
      type: "number",
      min: 0,
      max: 1,
      step: 0.01,
      help: "Records farther than this (1 − cosine similarity) are dropped.",
      steps: ["retrieval", "prompt"],
    },
    {
      key: "requireShared",
      label: "Require a shared word",
      type: "bool",
      help: "Drop records that only look close because two different words landed in the same slot.",
      steps: ["retrieval", "prompt"],
    },
    {
      key: "limit",
      label: "Sources kept",
      type: "int",
      min: 1,
      max: 20,
      step: 1,
      help: "The most records shown to the model as sources.",
      steps: ["retrieval", "prompt"],
    },
  ],
  transformer: [
    {
      key: "merges",
      label: "BPE merges",
      type: "int",
      min: 0,
      max: 200,
      step: 1,
      help: "How many merge rules the tokenizer learns. 0 means every character is its own token.",
      steps: ["bpe", "embedding", "position", "scores", "attention", "weighted", "addnorm", "ffn", "logits", "decode"],
    },
    {
      key: "context",
      label: "Context window (tokens)",
      type: "int",
      min: 2,
      max: 32,
      step: 1,
      help: "How many tokens the block can see at once; the rest are cut off.",
      steps: ["embedding", "position", "scores", "attention", "weighted", "addnorm", "ffn", "logits", "decode"],
    },
    {
      key: "positional",
      label: "Positional encoding",
      type: "bool",
      help: "Off: the block cannot tell word order, so “dog bites man” looks like “man bites dog”.",
      steps: ["position", "scores", "attention", "weighted", "addnorm", "ffn", "logits", "decode"],
    },
    {
      key: "scaleScores",
      label: "Scale scores by √d",
      type: "bool",
      help: "Off: raw dot products go into softmax, which gets peakier as vectors grow.",
      steps: ["scores", "attention", "weighted", "addnorm", "ffn", "logits", "decode"],
    },
    {
      key: "causalMask",
      label: "Causal mask",
      type: "bool",
      help: "Off: each token can look at tokens after it, which a model writing left to right cannot do.",
      steps: ["attention", "weighted", "addnorm", "ffn", "logits", "decode"],
    },
    {
      key: "residual",
      label: "Residual connections",
      type: "bool",
      help: "Off: each layer replaces its input instead of adding to it.",
      steps: ["addnorm", "ffn", "logits", "decode"],
    },
    {
      key: "activation",
      label: "Activation",
      type: "select",
      options: [
        { value: "gelu", label: "GELU (smooth)" },
        { value: "relu", label: "ReLU (cuts negatives to 0)" },
      ],
      help: "The bend in the feed-forward layer that lets it do more than a straight-line map.",
      steps: ["ffn", "logits", "decode"],
    },
    {
      key: "temperature",
      label: "Temperature",
      type: "number",
      min: 0.1,
      max: 3,
      step: 0.1,
      help: "Divides the scores before softmax. Below 1 sharpens the guess, above 1 flattens it.",
      steps: ["logits", "decode"],
    },
  ],
};

export const DEFAULTS = {
  planner: PLANNER_DEFAULTS,
  copilot: COPILOT_DEFAULTS,
  transformer: TRANSFORMER_DEFAULTS,
};
for (const [track, list] of Object.entries(SETTINGS)) for (const s of list) s.default = DEFAULTS[track][s.key];

export const settingFor = (path) => {
  const [track, key] = path.split(".");
  return SETTINGS[track]?.find((s) => s.key === key) ?? null;
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// One setting's value made safe to run: clamped, typed, or the default.
export function clean(setting, value) {
  const d = setting.default;
  switch (setting.type) {
    case "int":
    case "number": {
      const n = Number(value);
      if (!Number.isFinite(n)) return d;
      const v = Math.min(setting.max, Math.max(setting.min, n));
      return setting.type === "int" ? Math.round(v) : v;
    }
    case "bool":
      return typeof value === "boolean" ? value : d;
    case "select":
      return setting.options.some((o) => o.value === value) ? value : d;
    case "words": {
      if (!Array.isArray(value)) return d;
      const words = [...new Set(value.map((w) => String(w).trim().toLowerCase()).filter(Boolean))];
      return same(words, d) ? d : words;
    }
    case "pairs": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return d;
      const pairs = Object.fromEntries(
        Object.entries(value)
          .map(([k, v]) => [String(k).trim().toLowerCase(), String(v).trim().toLowerCase()])
          .filter(([k, v]) => k && v),
      );
      return same(pairs, d) ? d : pairs;
    }
    default:
      return d;
  }
}

// Full, safe settings for a track from any partial object. Values equal to a
// default keep the default's identity, so engines can use their fast paths.
export function resolve(track, partial = {}) {
  const out = {};
  for (const s of SETTINGS[track]) out[s.key] = s.key in (partial ?? {}) ? clean(s, partial[s.key]) : s.default;
  return out;
}

export const resolveAll = (partial = {}) =>
  Object.fromEntries(Object.keys(SETTINGS).map((t) => [t, resolve(t, partial[t])]));

// Keys whose value differs from the default.
export const changed = (track, params) =>
  SETTINGS[track].filter((s) => !same(params?.[s.key] ?? s.default, s.default)).map((s) => s.key);

export const isTuned = (params) => Object.keys(SETTINGS).some((t) => changed(t, params?.[t]).length > 0);

// Only the changed values, for storage and the code view's "changes only".
export const diff = (params) =>
  Object.fromEntries(
    Object.keys(SETTINGS)
      .map((t) => [t, Object.fromEntries(changed(t, params?.[t]).map((k) => [k, params[t][k]]))])
      .filter(([, v]) => Object.keys(v).length),
  );

// Step ids a track's changed settings can affect.
export function affectedSteps(track, params) {
  const keys = new Set(changed(track, params));
  return new Set(SETTINGS[track].filter((s) => keys.has(s.key)).flatMap((s) => s.steps));
}

// The code view: JSON in, settings out, with readable errors. Never evaluated.
export function parseCode(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${e.message}` };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "Expected an object." };
  const unknown = [];
  for (const [track, values] of Object.entries(data)) {
    if (!SETTINGS[track]) unknown.push(track);
    else if (values && typeof values === "object")
      for (const k of Object.keys(values)) if (!SETTINGS[track].some((s) => s.key === k)) unknown.push(`${track}.${k}`);
  }
  if (unknown.length) return { ok: false, error: `Unknown setting${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}` };
  return { ok: true, params: resolveAll(data) };
}

export const toCode = (params, changesOnly = false) => JSON.stringify(changesOnly ? diff(params) : params, null, 2);
