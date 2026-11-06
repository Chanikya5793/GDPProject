import { pipeline, env, mean_pooling } from '@huggingface/transformers'

export const ENCODER = Object.freeze({
  model: 'Xenova/all-MiniLM-L6-v2', revision: '751bff37182d3f1213fa05d7196b954e230abad9',
  architecture: 'MiniLM Transformer encoder', layers: 6, attention_heads: 12,
  dimensions: 384, pooling: 'mean', normalized: true, dtype: 'q8', max_tokens: 256,
  training: 'Frozen pretrained encoder; supervised logistic regression heads',
})
env.allowLocalModels = false
env.backends.onnx.wasm.numThreads = 1
if (typeof process !== 'undefined' && process.versions?.node) env.cacheDir = '.local/transformer-cache'
let extractorPromise
export async function encodeRequests(texts, progress = () => {}) {
  extractorPromise ??= pipeline('feature-extraction', ENCODER.model, {
    revision: ENCODER.revision, dtype: ENCODER.dtype,
    device: typeof process !== 'undefined' && process.versions?.node ? 'cpu' : 'wasm',
    session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
    progress_callback: event => { if (event.status === 'progress') progress(`Loading Transformer: ${event.file} ${Math.round(event.progress || 0)}%`) },
  })
  const extractor = await extractorPromise
  const records = []
  for (const text of texts) {
    const encoded = await extractor.tokenizer(text, { truncation: true, max_length: ENCODER.max_tokens })
    const ids = encoded.input_ids.tolist()[0].map(Number)
    const mask = encoded.attention_mask.tolist()[0].map(Number)
    const outputs = await extractor.model(encoded)
    const vector = mean_pooling(outputs.last_hidden_state ?? outputs.token_embeddings, encoded.attention_mask).normalize(2, -1)
    records.push({ text, vector: Array.from(vector.data), input_ids: ids, attention_mask: mask,
      tokens: ids.map(id => extractor.tokenizer.decode([id], { skip_special_tokens: false })),
      encoder: ENCODER, at_token_limit: ids.length === ENCODER.max_tokens })
    if (records.length % 40 === 0) progress(`Transformer embeddings: ${records.length}/${texts.length}`)
  }
  return records
}
