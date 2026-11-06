# Transformer presentation and demonstration reference

## What you can accurately say

“We use a real pretrained MiniLM Transformer encoder to convert planner requests into contextual sentence embeddings. We train separate supervised classifiers for the action and item type. The encoder stays frozen. Explicit extraction and validation rules construct the final Planner payload.”

This is transfer learning with trained classification heads. It is not training a Transformer from scratch, fine-tuning all its weights, or using a generative chatbot API.

## Slide 1 Why add a Transformer

- TF-IDF describes observed word and character fragments.
- A pretrained Transformer uses self-attention to build contextual representations.
- The project compares both approaches on the same family-separated dataset.
- Contextual representations may help unfamiliar wording; the experiment results determine what improved on this corpus.

Speaker line: “We added learned contextual features while retaining the original baselines, so we can compare their behavior rather than assume the newer model wins.”

## Slide 2 The model we actually use

| Property | Implementation |
| --- | --- |
| Encoder | Xenova/all-MiniLM-L6-v2, an ONNX export of the sentence Transformer |
| Revision | 751bff37182d3f1213fa05d7196b954e230abad9 |
| Transformer layers | 6 |
| Attention heads per layer | 12 |
| Sentence embedding | 384 floating-point coordinates |
| Tokenizer | Uncased WordPiece tokenizer with special tokens |
| Maximum model input | 256 tokens; token-limit status appears in the trace |
| Pooling | Mean pooling over valid token representations |
| Normalization | L2 normalization |
| Inference weights | Quantized q8 ONNX model |
| Supervised project training | Separate logistic regression heads for action and item type |
| Frozen parameters | All pretrained Transformer encoder weights |

Speaker line: “The model is small enough to run locally and in a browser. Its output is an embedding, not a generated answer.”

## Slide 3 What happens inside the Transformer

1. WordPiece converts the normalized request into subword tokens and integer IDs.
2. Token and positional representations encode content and token order.
3. Each encoder layer applies multi-head self-attention and a feed-forward network, with residual connections and layer normalization.
4. Mean pooling combines the final valid token vectors into a sentence representation.
5. L2 normalization scales that vector to unit length.
6. Two trained heads produce action and item-type probability estimates.

The standard attention expression is `softmax(Q K^T / sqrt(d_k)) V`.

Q means query, K means key, and V means value. Attention scores determine how token representations combine information. An attention head learns a separate representation subspace; do not claim that a particular head always detects dates or actions.

The attention mask marks valid input positions and excludes padding. It is not an attention-weight matrix. The ONNX model used here does not export attention matrices, so the website deliberately shows tokens, masks and embeddings instead of an invented attention heatmap.

Browser encoding runs before the Python pipeline, and repeated inputs may reuse cached embeddings. The stage timer alone is not end-to-end Transformer latency; do not use it as a cold-start or inference benchmark.

## Slide 4 Training and inference are different

Training: approved training requests → frozen encoder → embeddings → fit action/type classification heads → evaluate candidate → explicit activation.

Inference: new request → same pinned encoder → new embedding → saved heads → rankings → extraction and validation.

- Encoder pretraining happened before this project.
- Our supervised heads fit on training rows only.
- Validation and test rows are encoded by the frozen encoder but their labels do not fit the heads.
- The corpus starts with 800 synthetic examples and family-separated train/validation/test splits.
- Reviewed corrections can retrain heads. They do not automatically teach new extraction rules or update encoder weights.
- Previous model versions remain available for rollback.

## Slide 5 Evidence and comparison

Use the experiment table and actual saved report, not the older classical-only PowerPoint numbers. Compare `model:transformer` with `model:logistic` for a direct representation/model comparison. Show `hybrid:transformer` separately, because its explicit rules can override labels.

Discuss action/type macro-F1, exact field-value F1, semantic payload accuracy, clarification rate and accepted-request coverage. A schema-valid request may still misunderstand a user. High scores on synthetic templates do not establish production accuracy.

Include the Transformer model-only confusion matrix. Identify one error or limitation rather than presenting only successful examples. The existing threshold/coverage graph is for hybrid logistic regression; it must not be labeled as a Transformer calibration result.

Measured browser-runtime starter-corpus results from `docs/transformer-browser-results.json`:

| Pipeline | Validation action macro F1 | Test action macro F1 | Test semantic payload accuracy | Test clarification rate |
| --- | --- | --- | --- | --- |
| TF-IDF logistic model only | 74.36% | 99.17% | 99% | 1% |
| MiniLM Transformer model only | 86.25% | 96.09% | 74% | 26% |
| MiniLM Transformer hybrid | 96.22% | 96.09% | 98% | 2% |

Interpretation: the Transformer improves validation action F1 over the model-only lexical baseline, but the lexical baseline wins on this test split. The default confidence and margin thresholds were retained, not tuned for the new encoder. More requests require clarification in Transformer model-only mode, which also lowers exact outcome accuracy. These results do not establish overall Transformer superiority; this is an important experiment finding to explain.

## Slide 6 Benefits and limits

Benefits: contextual features, reusable pretrained knowledge, browser execution, no paid inference API, model comparison, traceable model provenance, and inexpensive head retraining compared with encoder fine-tuning.

Limits: first-use model download, higher memory/compute than TF-IDF, subword token limits, domain mismatch, quantization tradeoffs and dependence on the starter dataset. Titles, dates and fields still use explicit extraction rules. Strong intent predictions do not solve every extraction problem.

## Live demo and screenshots

1. Train a candidate with the Transformer option, or activate the new completed starter candidate in Experiments. Older saved models may have only classical heads.
2. In Inspector expand the reference context. Select classifier `transformer`; use `hybrid` for the complete guarded payload demo.
3. Enter `Create a task called Chemistry report tomorrow at 3pm with high priority` and run.
4. Capture Feature extraction: model tokens, input IDs, attention mask, 384 dimensions, embedding norm, pinned revision and frozen-training description.
5. Capture Classification: Transformer action/type rankings. Switch to `model` mode to inspect predictions without rule label overrides; clarification may be appropriate.
6. Capture Experiments: same-split classical/Transformer metric rows and Transformer model-only confusion matrix.
7. Try `Don't delete the task Pay rent` and a partial target. Explain why confidence never bypasses validation.
8. Review a prediction, train a candidate, compare and activate explicitly. Show an older version can be reactivated.

Recommended screenshots: Transformer feature trace, model-only rankings, experiment comparison, and a blocked negation request. Recommended code snippets: the pinned encoder pipeline, mean pooling/normalization, train-only head fitting and the final validation guard.

## Code to open in VS Code

- `src/transformer-encoder.js`: actual pretrained model, revision, ONNX inference and token/embedding output.
- `nlplab/transformer.py`: validated embedding cache and native inference bridge.
- `nlplab/models.py`: independent head training, probabilities and measured evaluation.
- `nlplab/pipeline.py`: Transformer inspection trace and unchanged readiness checks.
- `src/browser-worker.js`: browser inference and persistent training integration.

## Likely professor questions

**Are you using a real Transformer?** Yes. MiniLM executes pretrained self-attention layers to produce the features consumed by our classification heads.

**Did you fine-tune the Transformer?** No. We froze the encoder and trained the downstream heads. Full encoder fine-tuning is a future experiment.

**Why is logistic regression still present?** The Transformer provides the contextual features; logistic regression maps those features to our planner labels.

**Are embedding dimensions word explanations?** No. Coordinates are distributed learned features. Linear head contributions refer to coordinates, not causal token importance.

**Does hybrid accuracy prove the Transformer is better?** No. Rules influence hybrid results. Model-only rows are necessary for direct comparison.

**Is it generating the JSON?** No. The heads predict labels; extraction rules produce fields; typed validation and an adapter construct the JSON.

## Primary references

- Model card: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
- Pinned ONNX encoder: https://huggingface.co/Xenova/all-MiniLM-L6-v2/tree/751bff37182d3f1213fa05d7196b954e230abad9
- Transformers.js feature extraction: https://huggingface.co/docs/transformers.js/api/pipelines
- Original Transformer paper: https://arxiv.org/abs/1706.03762
