import { attention, inspectBPE, encodeBPE, TRANSFORMER_DEFAULTS } from "./transformer.js";

export function microscope(trace, generatedTokens = [], params = TRANSFORMER_DEFAULTS) {
  const utf16 = [];
  let offset = 0;
  for (const char of trace.original) {
    utf16.push({
      char,
      offset,
      length: char.length,
      codePoint: char.codePointAt(0),
      hex: `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
    });
    offset += char.length;
  }
  const vectors = trace.vectors;
  const contributions = vectors.results.map((result) => ({
    id: result.record.id,
    score: result.score,
    documentMagnitude: Math.sqrt(
      result.vector.reduce((sum, v) => sum + v * v, 0),
    ),
    dot: result.dot,
    terms: vectors.dimensions.map((d, i) => ({
      ...d,
      query: vectors.query[i],
      document: result.vector[i],
      product: vectors.query[i] * result.vector[i],
    })),
  }));
  return {
    characters: utf16,
    vocabulary: vectors.dimensions.map((d, i) => ({
      ...d,
      index: i,
      tf: d.idf ? vectors.query[i] / d.idf : 0,
      weight: vectors.query[i],
    })),
    contributions,
    transformer: attention(
      trace.original,
      generatedTokens.length
        ? {
            params,
            tokenWindow: [
              ...encodeBPE(trace.original, params.merges).slice(0, params.context),
              ...generatedTokens,
            ],
          }
        : { params },
    ),
    generatedTokens,
    bpe: inspectBPE(trace.original, params.merges),
  };
}
