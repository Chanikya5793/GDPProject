// One entry per step, shared by the 3D and 2D views. `id` keys the 3D scene
// geometry and the 2D step module; the prose describes the code that runs.
export const PLANNER_STEPS = [
  {
    id: "signal",
    algorithm: "Text cleanup",
    plain:
      "The computer first makes a tidy copy of what you typed: same letters, all lowercase, no extra spaces. Your original text is kept so every later piece can point back to it.",
    name: "Input",
    color: "#c6acff",
    summary:
      "Keep the original text untouched and make a normalized copy: Unicode NFKC, lowercase, single spaces. Rules match the copy; tokens keep offsets into the original.",
    formula: "normalize(s) = trim(collapseSpaces(lowercase(NFKC(s))))",
    io: ["string", "string (normalized copy)"],
    limit:
      "The clock is fixed to Monday, October 19, 2026, so every run is reproducible.",
  },
  {
    id: "tokenize",
    algorithm: "Regex tokenizer",
    plain:
      "The sentence is cut into pieces called tokens: words, numbers and punctuation. Small common words like “my” and “to” are marked as filler.",
    name: "Tokenize",
    color: "#b4a2ff",
    summary:
      "Scan left to right with one regular expression made of four alternatives: clock, word, number, symbol. Each match becomes a token with its [start, end) offsets and a kind.",
    formula: "clock | word | number | symbol, first alternative that matches wins",
    io: ["string", "Token[]"],
    limit:
      "Word-level tokens. Language models split text into subwords instead; the Transformer track shows that.",
  },
  {
    id: "parse",
    algorithm: "Rule-based parser",
    plain:
      "Simple rules read the pieces: the first verb says what you want (create, move, find, delete), and patterns pick out the date and time. Whatever is left is the reminder’s title.",
    name: "Extract",
    color: "#f4bd99",
    summary:
      "Rule-based slot filling. The first verb picks the intent, regular expressions find a date and a clock time, validation rejects impossible values, and what is left becomes the title.",
    formula: "intent ← first verb · date ← tomorrow | month day | weekday · time ← h:mm | h am/pm",
    io: ["normalized string", "{ intent, date, time, title, issues }"],
    limit:
      "A bounded English grammar. Anything it does not recognize stays empty; it is never guessed.",
  },
  {
    id: "filter",
    algorithm: "Keyword filter",
    plain:
      "The title is boiled down to the words that matter for searching, like “call” and “advisor”. Filler words, numbers and dates are dropped.",
    name: "Title terms",
    color: "#96ddf1",
    summary:
      "Turn the title into search terms: drop stop words, numbers, month and weekday names, then map the fixed aliases (adviser → advisor, phone → call).",
    formula: "terms = [alias(t) for t in tokenize(title) if t is a keyword]",
    io: ["title", "string[] terms"],
    limit: "Aliases are a fixed list, not learned synonyms.",
  },
  {
    id: "vectorize",
    algorithm: "TF–IDF vectors",
    plain:
      "Each title becomes a list of numbers: one number per word. Rare words get bigger numbers because they say more about which reminder you mean.",
    name: "TF–IDF",
    color: "#91ead3",
    summary:
      "Every distinct term becomes one dimension. A term's weight is how often it occurs (tf) times how rare it is across the record titles (idf).",
    formula: "weight = tf × (ln((N + 1) / (df + 1)) + 1)",
    io: ["query terms + record titles", "one vector per text"],
    limit: "Lexical vectors: two different spellings never match.",
  },
  {
    id: "retrieve",
    algorithm: "Cosine similarity",
    plain:
      "Your request is compared with every saved reminder. The more important words they share, the closer the score is to 1.",
    name: "Cosine",
    color: "#a4c5ff",
    summary:
      "Score each record by the angle between its vector and the query vector: the dot product divided by both lengths. 1 means the same direction; 0 means no shared terms.",
    formula: "cos(q, d) = (q · d) / (‖q‖ × ‖d‖)",
    io: ["query vector + record vectors", "ranked scores"],
    limit:
      "A similarity, not a probability. A record is a candidate only above 0.08.",
  },
  {
    id: "decide",
    algorithm: "Decision rules",
    plain:
      "A checklist runs top to bottom. The first item that applies decides what happens: ask you a question, show search results, or prepare a change.",
    name: "Decide",
    color: "#f0d49f",
    summary:
      "Check an ordered list of rules. The first rule whose test is true decides the outcome: ask a question, answer a search, or prepare a proposal.",
    formula: "decision = first rule where test() is true",
    io: ["slots + candidates", "clarify | answer | proposal"],
    limit: "Nothing is written in this step.",
  },
  {
    id: "respond",
    algorithm: "Safe write",
    plain:
      "Nothing changes until you confirm. Even then, the change is only saved if the reminder hasn’t been edited since you saw the preview.",
    name: "Apply",
    color: "#abefd2",
    summary:
      "A proposal is applied only after you confirm it, and only if the record still has the revision that was previewed (compare-and-swap).",
    formula: "if record.revision === expected: write and revision += 1",
    io: ["proposal + records", "new records"],
    limit: "The sample records live in memory and reset on reload.",
  },
];

export const TRANSFORMER_STEPS = [
  {
    id: "bpe",
    algorithm: "Byte-pair encoding",
    plain:
      "Instead of whole words, the model reads common chunks of letters. It learned those chunks by repeatedly gluing together the pair of letters that appears most often.",
    name: "BPE subwords",
    color: "#c6acff",
    summary:
      "Learn a tokenizer from a small corpus by repeatedly merging the most frequent adjacent pair of symbols, then encode the request by replaying those merges in order.",
    formula: "(a, b) = argmax count(a, b) · replace every a b with ab",
    io: ["corpus, request", "merge list, subword tokens"],
    limit:
      "60 merges learned from 12 sentences. Production tokenizers learn tens of thousands.",
  },
  {
    id: "embedding",
    algorithm: "Embedding lookup",
    plain:
      "Each chunk is turned into a short list of numbers, a bit like coordinates. Here the numbers come from a fixed formula, so they carry no meaning yet.",
    name: "Embedding",
    color: "#a7c7ff",
    summary:
      "Each subword becomes a row of 4 numbers. Here the table is a fixed formula of the token's characters, so it is reproducible but carries no meaning.",
    formula: "code = Σ codePoint(cᵢ)·(i+1) · E[d] = sin(code·(d+1)·0.017)",
    io: ["n tokens", "n × 4 matrix"],
    limit: "Untrained. Real embeddings are learned from data.",
  },
  {
    id: "position",
    algorithm: "Positional encoding",
    plain:
      "A wave-shaped pattern is added to each chunk’s numbers so the model can tell first from fifth. Without it, word order would be invisible.",
    name: "Position",
    color: "#9de7dc",
    summary:
      "Attention by itself ignores word order, so a sinusoidal position vector is added to each embedding. The same token at another position gets a different vector.",
    formula: "PE(p, 2k) = sin(p / 10000^(2k/4)) · PE(p, 2k+1) = cos(p / 10000^(2k/4))",
    io: ["n × 4", "n × 4 (X)"],
    limit: "The formula from Vaswani et al. (2017), with d = 4.",
  },
  {
    id: "qk",
    algorithm: "Attention scores",
    plain:
      "Every chunk asks a question (query) and offers a label (key). Matching each question against each label gives a score for how relevant one chunk is to another.",
    name: "Q · K scores",
    color: "#f5c6a6",
    summary:
      "Project every row into a query and a key with fixed 4 × 4 matrices. Each score is one query dotted with one key, divided by √4.",
    formula: "S = (X·W_Q)(X·W_K)ᵀ / √4",
    io: ["X (n × 4)", "S (n × n)"],
    limit: "One attention head. W_Q and W_K are fixed, not learned.",
  },
  {
    id: "attention",
    algorithm: "Masked softmax",
    plain:
      "Each chunk may only look at itself and earlier chunks. Its scores are turned into percentages that add up to 100%.",
    name: "Mask + softmax",
    color: "#bca6ff",
    summary:
      "Block each token from seeing later tokens by setting those scores to −∞, then turn each row into weights that sum to 1 with a numerically stable softmax.",
    formula: "w_ij = exp(s_ij − max_i) / Σ_k exp(s_ik − max_i)",
    io: ["S (n × n)", "W (n × n), rows sum to 1"],
    limit: "Subtracting the row maximum changes nothing mathematically; it prevents overflow.",
  },
  {
    id: "output",
    algorithm: "Weighted average",
    plain:
      "Each chunk builds a new version of itself by blending the chunks it looked at, using those percentages.",
    name: "Weighted sum",
    color: "#a0e8ca",
    summary:
      "Each token's output is the weighted average of the value vectors it is allowed to see. W_V is the identity here, so V = X.",
    formula: "oᵢ = Σⱼ w_ij · vⱼ",
    io: ["W (n × n), V (n × 4)", "O (n × 4)"],
    limit: "No output projection W_O in this toy block.",
  },
  {
    id: "residual",
    algorithm: "Add and normalize",
    plain:
      "The original numbers are added back in, then rescaled to a standard range so nothing grows out of control.",
    name: "Add & norm",
    color: "#a7c7ff",
    summary:
      "Add the block's input back (a residual connection), then normalize each row to mean 0 and variance 1.",
    formula: "LN(x) = (x − μ) / √(σ² + 0.00001)",
    io: ["O + X", "H₁ (n × 4)"],
    limit: "Post-norm, with no learned scale or shift.",
  },
  {
    id: "feedforward",
    algorithm: "Feed-forward network",
    plain:
      "Each chunk passes through a tiny neural network on its own: widen to 8 numbers, bend them with a smooth curve, squeeze back to 4.",
    name: "Feed-forward",
    color: "#f5c6a6",
    summary:
      "For each token on its own: expand 4 → 8 with W₁ and b₁, apply GELU, project 8 → 4 with W₂, then add and normalize again.",
    formula: "H₂ = LN(H₁ + GELU(H₁·W₁ + b₁)·W₂)",
    io: ["H₁ (n × 4)", "H₂ (n × 4)"],
    limit: "GELU uses the tanh approximation.",
  },
  {
    id: "logits",
    algorithm: "Vocabulary scores",
    plain:
      "The last chunk’s numbers are compared with every chunk the model knows, giving a probability for what comes next.",
    name: "Vocabulary",
    color: "#bca6ff",
    summary:
      "Score every vocabulary token against the last position's vector, then softmax the scores into probabilities.",
    formula: "logitₜ = h_last · Uₜ · p = softmax(logits)",
    io: ["h_last (4)", "p over the vocabulary"],
    limit: "Only the last position predicts the next token.",
  },
  {
    id: "decode",
    algorithm: "Greedy decoding",
    plain:
      "The most likely next chunk is picked and added to the end, and the whole process runs again. These weights are untrained, so the guesses are not meaningful.",
    name: "Decode",
    color: "#a0e8ca",
    summary:
      "Greedy decoding picks the most probable token, appends it, slides the 16-token window, and runs the whole block again.",
    formula: "next = argmax p",
    io: ["p", "one new token"],
    limit: "Untrained weights: the output is real arithmetic, not language.",
  },
];

export const stepsFor = (mode) =>
  mode === "planner" ? PLANNER_STEPS : TRANSFORMER_STEPS;
