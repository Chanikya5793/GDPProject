// Plain one-line definitions for the words the three tracks lean on.
// `forms` are the spellings to link in text; `exact` forms match case.
export const GLOSSARY = [
  { term: "token", forms: ["tokens", "token"], def: "One piece of text the program works with: a word, a number, a symbol or part of a word." },
  { term: "tokenizer", forms: ["tokenizers", "tokenizer", "tokenization"], def: "The code that cuts text into tokens." },
  { term: "stop word", forms: ["stop words", "stop word", "stopwords", "stopword"], def: "A very common word, like “the” or “my”, that is ignored when searching." },
  { term: "alias", forms: ["aliases", "alias"], def: "Another spelling mapped to one standard word, so both match the same thing." },
  { term: "normalize", forms: ["normalization", "normalized", "normalizes", "normalize"], def: "Make text or numbers follow one standard form, such as all lowercase or a fixed size." },
  { term: "regex", forms: ["regular expressions", "regular expression", "regex"], def: "A pattern that describes text to find, such as “one or more digits”." },
  { term: "intent", forms: ["intents", "intent"], def: "What the request wants done: create, move, delete or ask." },
  { term: "slot", forms: ["slots", "slot"], def: "A numbered position in a vector, or a blank in a request such as the date or time." },
  { term: "vector", forms: ["vectors", "vector"], def: "A list of numbers that stands for something, like a word or a whole title." },
  { term: "dimension", forms: ["dimensions", "dimension"], def: "One position in a vector; a vector with 768 numbers has 768 dimensions." },
  { term: "TF–IDF", forms: ["TF–IDF", "TF-IDF", "tf–idf", "tf-idf"], exact: true, def: "A word's weight: how often it appears here times how rare it is across all titles." },
  { term: "TF", forms: ["TF", "term frequency"], exact: true, def: "Term frequency: how many times a word appears in one text." },
  { term: "IDF", forms: ["IDF", "inverse document frequency"], exact: true, def: "Inverse document frequency: a bigger number for words that appear in fewer titles." },
  { term: "dot product", forms: ["dot products", "dot product", "dotted"], def: "Multiply two vectors position by position and add the results." },
  { term: "cosine similarity", forms: ["cosine similarity", "cosine", "similarity"], def: "How closely two vectors point the same way: 1 is the same direction, 0 is nothing in common." },
  { term: "distance", forms: ["distances", "distance"], def: "Here, 1 minus cosine similarity: 0 means identical, bigger means less alike." },
  { term: "threshold", forms: ["thresholds", "threshold", "cutoff"], def: "A fixed line a number must pass, such as “keep scores above 0.3”." },
  { term: "hash", forms: ["hashes", "hashed", "hashing", "hash"], def: "A fixed recipe that turns any text into a number that looks random but is always the same for that text." },
  { term: "SHA-256", forms: ["SHA-256", "sha256", "sha-256"], exact: true, def: "A standard hash that turns text into 256 bits; the copilot uses its first 4 bytes." },
  { term: "feature hashing", forms: ["feature hashing", "feature-hashed"], def: "Put each word in a vector slot chosen by its hash, so no word list is needed." },
  { term: "collision", forms: ["collisions", "collision", "collide"], def: "Two different words hashed into the same slot, so they look alike to the search." },
  { term: "retrieval", forms: ["retrieval", "retrieve", "retrieves", "retrieved"], def: "Finding the saved records that best match a question." },
  { term: "candidate", forms: ["candidates", "candidate"], def: "A record that is close enough to be considered before the filters decide." },
  { term: "prompt", forms: ["prompts", "prompt"], def: "All the text sent to a language model: instructions, sources and your question." },
  { term: "context window", forms: ["context window", "context windows"], def: "The most tokens a model can look at in one go; anything beyond is cut off." },
  { term: "citation", forms: ["citations", "citation", "cites", "cite"], def: "A pointer from the answer to the source it used, such as [S2]." },
  { term: "revision", forms: ["revisions", "revision"], def: "A counter that goes up each time a record changes, used to spot stale edits." },
  { term: "proposal", forms: ["proposals", "proposal"], def: "A suggested change that waits for you to confirm before it is written." },
  { term: "BPE", forms: ["byte-pair encoding", "byte pair encoding", "BPE"], exact: true, def: "Byte-pair encoding: start from single characters and keep joining the most common neighbouring pair." },
  { term: "merge", forms: ["merges", "merge rules", "merge rule", "merge"], def: "In BPE, one rule that joins two neighbouring pieces into one bigger token." },
  { term: "embedding", forms: ["embeddings", "embedding"], def: "The vector a model looks up for each token: the token's starting meaning as numbers." },
  { term: "positional encoding", forms: ["positional encoding", "position vectors", "position vector"], def: "Numbers added to each embedding so the model knows where the token sits in the sentence." },
  { term: "query, key and value", forms: ["queries and keys", "query and key", "query vector", "key vector", "value vector", "Q·K"], def: "In attention, each token's question (query), label (key) and content to pass on (value)." },
  { term: "attention", forms: ["attention"], def: "Each token mixes in information from other tokens, weighted by how relevant they are." },
  { term: "softmax", forms: ["softmax"], def: "Turns a list of scores into percentages that add up to 100%; bigger scores get much more." },
  { term: "causal mask", forms: ["causal mask", "mask", "masked"], def: "Blocks each token from looking at later tokens, so the model only sees the past." },
  { term: "residual", forms: ["residual connections", "residual connection", "residual"], def: "Adding a layer's input back onto its output, so nothing learned earlier is lost." },
  { term: "layer norm", forms: ["layer normalization", "layer norm", "layernorm"], def: "Rescale a vector so its numbers have mean 0 and spread 1." },
  { term: "GELU", forms: ["GELU"], exact: true, def: "A smooth bend: keeps positive numbers, shrinks negative ones toward 0." },
  { term: "ReLU", forms: ["ReLU"], exact: true, def: "A sharp bend: negative numbers become 0, positive ones pass unchanged." },
  { term: "feed-forward", forms: ["feed-forward", "feedforward", "FFN"], def: "A small two-layer network applied to each token on its own." },
  { term: "logits", forms: ["logits", "logit"], def: "Raw scores for every possible next token, before softmax turns them into chances." },
  { term: "temperature", forms: ["temperature"], def: "Divides the scores before softmax: low makes the top guess dominate, high evens them out." },
  { term: "greedy decoding", forms: ["greedy decoding", "greedy"], def: "Always pick the single most likely next token." },
  { term: "LLM", forms: ["LLMs", "LLM", "large language model", "language models", "language model"], exact: false, def: "A large language model: a big trained network that predicts the next token, over and over." },
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FORMS = GLOSSARY.flatMap((entry) => entry.forms.map((form) => ({ form, entry })))
  // Longest first, so "TF–IDF" wins over "TF" and "stop words" over "stop".
  .sort((a, b) => b.form.length - a.form.length);
const PATTERN = new RegExp(`(?<![\\w-])(${FORMS.map((f) => escape(f.form)).join("|")})(?![\\w-])`, "gi");

// Which entry a matched form belongs to, honouring case for exact entries.
function entryOf(match) {
  const lower = match.toLowerCase();
  for (const { form, entry } of FORMS) {
    if (entry.exact ? form === match : form.toLowerCase() === lower) return entry;
  }
  return null;
}

// Splits text into strings and { text, entry } for the first use of each
// term. `seen` (a Set of terms) carries over between texts on one screen.
export function glossText(text, seen = new Set()) {
  const parts = [];
  let last = 0;
  for (const m of String(text).matchAll(PATTERN)) {
    const entry = entryOf(m[0]);
    if (!entry || seen.has(entry.term)) continue;
    seen.add(entry.term);
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push({ text: m[0], entry });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export const termsIn = (text) => glossText(text).filter((p) => typeof p !== "string").map((p) => p.entry);
