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

// The planner copilot, from your message to its answer. `badge` says how much
// of the step is the real system: "real" values from your actual exchange,
// "recomputed" by the same algorithm in your browser, or "illustration" of a
// mechanism we cannot show from the inside.
const COPILOT_HEAD = [
  {
    id: "message",
    name: "Your message",
    badge: "real",
    algorithm: "Request validation",
    color: "#c6acff",
    plain:
      "Your message is trimmed and checked (1 to 8,000 characters). The first 500 characters become the search query; earlier turns and any attached record travel with it.",
    summary:
      "The API validates the request (message 1–8000 chars, up to 20 earlier turns of 4000 chars, optional focus record, timezone), checks your rate limit, and cuts the search query to 500 characters.",
    formula: "query = message.trim().slice(0, 500)",
    io: ["your message", "validated request + search query"],
    limit: "The message is the real one you sent.",
  },
  {
    id: "searchwords",
    name: "Search words",
    badge: "recomputed",
    algorithm: "Lexical tokenizer",
    color: "#b4a2ff",
    plain:
      "The search query is lowercased and split into plain letters and digits. Common filler words like “the”, “my” and “please” are dropped.",
    summary:
      "casefold() the query, keep every run of [a-z0-9], and drop the 32 stopwords. No stemming: “reports” and “report” are different words.",
    formula: "tokens = casefold(q).match(/[a-z0-9]+/g) − STOPWORDS",
    io: ["search query", "search words"],
    limit: "Recomputed in your browser with the same rules as backend/app/local_embeddings.py.",
  },
  {
    id: "hashvector",
    name: "Hashed vector",
    badge: "recomputed",
    algorithm: "Feature hashing",
    color: "#96ddf1",
    plain:
      "Each word is turned into a fingerprint (SHA-256) and dropped into one of 768 numbered boxes. Words that repeat make their box heavier.",
    summary:
      "slot = first 4 bytes of sha256(word) mod 768; weight = 1 + ln(count). Record titles add +2 to their words. There is no IDF.",
    formula: "v[sha256(w)[0:4] mod 768] += 1 + ln(count(w))",
    io: ["search words", "768-slot vector"],
    limit: "Exactly the server's formula, checked against the Python code in a test.",
  },
  {
    id: "retrieval",
    name: "Retrieval",
    badge: "recomputed",
    algorithm: "Cosine nearest neighbours",
    color: "#91ead3",
    plain:
      "Your vector is compared with the vector of every record you allowed the copilot to read. The closest ones that really share a word with your question are kept, up to 5.",
    summary:
      "Cosine distance to each record's vector; take the 25 nearest, then drop distance > 0.98, records not approved for AI, and hash collisions with no shared word; keep 5.",
    formula: "distance = 1 − (q · d) / (‖q‖ ‖d‖)",
    io: ["query vector + your records", "up to 5 sources"],
    limit:
      "Recomputed over the records in this browser. The server searched its own index of the same records; its pick is in the citations.",
  },
  {
    id: "memory",
    name: "Context memory",
    badge: "real",
    algorithm: "Conversation memory",
    color: "#9de7dc",
    plain:
      "The LLM itself forgets everything between messages. The copilot remembers for it: each turn it re-sends your earlier messages, the records it already pointed to, and any record you attached, so words like “it” still make sense.",
    summary:
      "Up to 20 earlier turns (4000 chars each) travel with every request. Sources cited earlier keep their S-numbers across turns, and an attached record is re-sent while its chip is on screen.",
    formula: "context = last 20 turns + earlier sources (same S-numbers) + attached record",
    io: ["earlier turns + sources", "what the LLM will remember"],
    limit: "These are the turns and sources this conversation really carried.",
  },
  {
    id: "prompt",
    name: "Prompt",
    badge: "real",
    algorithm: "Prompt assembly",
    color: "#a4c5ff",
    plain:
      "Everything the model will read is packed into labelled sections: today’s date, a briefing of your planner, the search results, the conversation and your question.",
    summary:
      "Sections in a fixed order so the provider can cache the stable prefix. Search hits are wrapped as untrusted content; character caps, not token counts, keep it bounded.",
    formula: "prompt = [TODAY, BRIEFING, SOURCES, TOOLS, CONVERSATION, FOCUS, QUESTION]",
    io: ["sources + conversation + question", "one prompt"],
    limit: "The order and caps are real. The system instructions themselves are not shown.",
  },
];
const COPILOT_MODEL = TRANSFORMER_STEPS.map((s) => ({
  ...s,
  badge: "illustration",
  limit: `How a language model works in general, run on your words with small untrained weights. ${s.limit}`,
}));
const COPILOT_TAIL = [
  {
    id: "lookups",
    name: "Lookups",
    badge: "real",
    algorithm: "Tool loop",
    color: "#f5c6a6",
    plain:
      "Before answering, the model may ask the planner for more: a search or a date range. Each lookup runs, its results are added, and the model writes again.",
    summary:
      "The model returns tool_requests in its JSON instead of an answer; the server runs at most 4 lookups over at most 3 generations within 90 seconds.",
    formula: "while answer.tool_requests and rounds < 3: run tools, generate again",
    io: ["model output", "extra evidence"],
    limit: "The lookups listed are the ones that really ran for your message.",
  },
  {
    id: "answer",
    name: "Answer",
    badge: "real",
    algorithm: "Structured output + citation check",
    color: "#a0e8ca",
    plain:
      "The model must reply in a fixed JSON shape: the answer, which sources it used, and any changes it suggests. Answers that cite sources it was never given are thrown away.",
    summary:
      "GeneratedAnswer {answer, citation_ids, needs_clarification, actions}. Inline [S2] markers are removed; citations are only the sources the answer used.",
    formula: "citations = sources ∩ answer.citation_ids",
    io: ["model JSON", "answer + citations"],
    limit: "The text and citations are the real ones from your reply.",
  },
  {
    id: "proposals",
    name: "Proposals",
    badge: "real",
    algorithm: "Validated, revision-checked change",
    color: "#abefd2",
    plain:
      "Suggested changes become proposals. Nothing is written until you confirm, and only if the record has not changed since the proposal was made.",
    summary:
      "Each action is validated per record type and stored as a proposal for 24 hours. Confirming sends the expected base revision; the write is a transaction that rejects stale proposals.",
    formula: "if record.revision === proposal.base_revision: write, revision + 1",
    io: ["actions", "proposals waiting for you"],
    limit: "Before and after are the real proposed values.",
  },
];
export const COPILOT_STEPS = [...COPILOT_HEAD, ...COPILOT_MODEL, ...COPILOT_TAIL];

// When the reply carried the server's own search (retrieval.searches), the
// Retrieval step shows real values and says so.
export function copilotSteps(copilot) {
  if (!copilot?.response?.retrieval?.searches?.length) return COPILOT_STEPS;
  return COPILOT_STEPS.map((s) =>
    s.id === "retrieval"
      ? {
          ...s,
          badge: "real",
          limit:
            "The ranking, distances and filter outcomes are the server's own, sent with your reply. The browser's recomputation is shown first so you can check the arithmetic.",
        }
      : s,
  );
}

export const stepsFor = (mode) =>
  mode === "planner" ? PLANNER_STEPS : mode === "copilot" ? COPILOT_STEPS : TRANSFORMER_STEPS;
