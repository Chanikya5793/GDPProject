// Pure, inspectable NLP. No models, remote APIs, credentials, or planner imports.
export const DEMO_TODAY = "2026-10-19";
export const MAX_INPUT = 500;
// A record is a candidate above this cosine score; two candidates closer
// than TIE_GAP are treated as a tie that needs the user to choose.
export const MATCH_THRESHOLD = 0.08;
export const TIE_GAP = 0.15;
export const SEED_RECORDS = [
  {
    id: "A",
    title: "Call advisor",
    date: "2026-10-16",
    time: "09:00",
    revision: 1,
    note: "Discuss spring course registration.",
  },
  {
    id: "B",
    title: "Call advisor",
    date: "2026-10-17",
    time: "10:00",
    revision: 1,
    note: "Follow up about graduation requirements.",
  },
  {
    id: "C",
    title: "Submit GDP report",
    date: "2026-10-23",
    time: "17:00",
    revision: 1,
    note: "Upload the team progress report.",
  },
  {
    id: "D",
    title: "Study for mobile computing",
    date: "2026-10-22",
    time: "14:00",
    revision: 1,
    note: "Review iOS navigation and storage.",
  },
  {
    id: "E",
    title: "Meet professor",
    date: "2026-10-21",
    time: "11:00",
    revision: 1,
    note: "Discuss research project.",
  },
  {
    id: "F",
    title: "Pay housing bill",
    date: "2026-10-25",
    time: "12:00",
    revision: 1,
    note: "Check housing portal.",
  },
];
export const SCENARIOS = [
  {
    id: "duplicate",
    name: "Two reminders, one title",
    tag: "Ambiguity",
    prompt: "Move my call advisor reminder to October 20 at 11 AM.",
    caption: "A tie is a reason to ask, not a reason to guess.",
  },
  {
    id: "create",
    name: "A new reminder",
    tag: "Create",
    prompt: "Remind me to submit my lab tomorrow at 3 PM.",
    caption: "Turn a sentence into a typed reminder proposal.",
  },
  {
    id: "search",
    name: "Find the right record",
    tag: "Retrieval",
    prompt: "Find my GDP report reminder.",
    caption: "Watch words become vectors and actual search scores.",
  },
  {
    id: "invalid",
    name: "An impossible time",
    tag: "Validation",
    prompt: "Remind me to call advisor tomorrow at 25:00.",
    caption: "A recognized time still needs to be valid.",
  },
  {
    id: "recurring",
    name: "Every Friday… until when?",
    tag: "Recurrence",
    prompt: "Remind me to study every Friday at 4 PM.",
    caption: "A recurring schedule needs a finite boundary.",
  },
  {
    id: "bounded",
    name: "Four Fridays",
    tag: "Recurrence",
    prompt: "Remind me to study every Friday at 4 PM for 4 weeks.",
    caption: "Expand a bounded recurrence into inspectable dates.",
  },
];
export const STOP_WORDS = new Set(
  "a an the me my please to at on for of in is it and with reminder reminders remind move reschedule change update find show search get list create add set delete remove cancel every next tomorrow today am pm weeks week until".split(
    " ",
  ),
);
export const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
export const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
export const ALIASES = { adviser: "advisor", phone: "call" };
// The settings a visitor can tune; the defaults are the values above.
export const PLANNER_DEFAULTS = {
  stopWords: [...STOP_WORDS],
  aliases: ALIASES,
  dropDates: true,
  smoothIdf: true,
  useIdf: true,
  matchThreshold: MATCH_THRESHOLD,
  tieGap: TIE_GAP,
};
const stopSets = new WeakMap();
const stopSet = (p) => {
  if (p.stopWords === PLANNER_DEFAULTS.stopWords) return STOP_WORDS;
  let set = stopSets.get(p.stopWords);
  if (!set) stopSets.set(p.stopWords, (set = new Set(p.stopWords)));
  return set;
};
// Alternatives are tried left to right at each position; the first that
// matches wins. Whitespace matches none of them, so it is skipped.
export const TOKEN_PATTERNS = [
  { name: "clock", source: String.raw`\d{1,2}:\d{2}` },
  { name: "word", source: String.raw`[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)?` },
  { name: "number", source: String.raw`\d+` },
  { name: "symbol", source: String.raw`[^\s]` },
];
const TOKEN_RE = new RegExp(
  TOKEN_PATTERNS.map((p) => `(?<${p.name}>${p.source})`).join("|"),
  "gu",
);
// Checked in this order against the start of the normalized request.
export const INTENT_RULES = [
  { intent: "update", verbs: ["move", "reschedule", "change", "update"] },
  { intent: "delete", verbs: ["delete", "remove", "cancel"] },
  { intent: "search", verbs: ["find", "show", "search", "get", "list"] },
  { intent: "create", verbs: ["remind", "create", "add", "set"] },
];
export const normalize = (text) =>
  text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
export function normalizeSteps(text) {
  const nfkc = text.normalize("NFKC");
  const lower = nfkc.toLowerCase();
  const collapsed = lower.replace(/\s+/g, " ");
  return { nfkc, lower, collapsed, trimmed: collapsed.trim() };
}
const alias = (word, p = PLANNER_DEFAULTS) => p.aliases[word] || word;
export function tokenize(text, p = PLANNER_DEFAULTS) {
  const stop = stopSet(p);
  return Array.from(text.matchAll(TOKEN_RE), (match, id) => {
    const normalized = normalize(match[0]);
    const kind = /^\d/.test(normalized)
      ? "number"
      : /^[\p{L}]/u.test(normalized)
        ? stop.has(normalized)
          ? "context"
          : "keyword"
        : "punctuation";
    return {
      id,
      text: match[0],
      normalized,
      start: match.index,
      end: match.index + match[0].length,
      kind,
      rule: TOKEN_PATTERNS.find((p) => match.groups[p.name] !== undefined).name,
    };
  });
}
// Each token's fate on the way to a retrieval term, with the reason.
export function termSteps(text, p = PLANNER_DEFAULTS) {
  return tokenize(normalize(text), p).map((t) => {
    const reason =
      t.kind === "context"
        ? "stop word"
        : t.kind === "number"
          ? "number"
          : t.kind === "punctuation"
            ? "punctuation"
            : p.dropDates && MONTHS.includes(t.normalized)
              ? "month name"
              : p.dropDates && DAYS.includes(t.normalized)
                ? "weekday name"
                : null;
    return {
      token: t.normalized,
      kind: t.kind,
      kept: !reason,
      reason,
      term: reason ? null : alias(t.normalized, p),
      aliased: !reason && alias(t.normalized, p) !== t.normalized,
    };
  });
}
export function terms(text, p = PLANNER_DEFAULTS) {
  return termSteps(text, p)
    .filter((s) => s.kept)
    .map((s) => s.term);
}
export function addDays(iso, count) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function friendlyDate(date) {
  if (!date) return "Not specified";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
export function friendlyTime(time) {
  if (!time) return "Not specified";
  const [h, m] = time.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
// `steps` records what every rule saw and produced, for the explainer.
export function extract(text, p = PLANNER_DEFAULTS) {
  const input = normalize(text);
  const command = input.replace(/^please\s+/, "");
  const intentRule = INTENT_RULES.find((r) =>
    new RegExp(`^(${r.verbs.join("|")})\\b`).test(command),
  );
  const intent = intentRule?.intent ?? "unknown";
  const steps = {
    input,
    command,
    intent: {
      tried: INTENT_RULES.map((r) => ({
        ...r,
        matched: r === intentRule,
      })).slice(0, intentRule ? INTENT_RULES.indexOf(intentRule) + 1 : undefined),
      verb: intentRule ? command.match(/^\S+/)[0] : null,
    },
    date: [],
    clock: null,
    recurrence: null,
    title: [],
  };
  const issues = [];
  if (
    /\b(?:and|then|or)\s+(?:remind|create|add|set|move|reschedule|change|update|delete|remove|cancel|find)\b/.test(
      input,
    )
  )
    issues.push(
      "Use one reminder action per request. Split chained instructions into separate runs.",
    );
  const dateReferences = [
    ...input.matchAll(
      new RegExp(
        `\\b(?:today|tomorrow|${DAYS.join("|")}|(?:${MONTHS.join("|")})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+20\\d{2})?)\\b`,
        "g",
      ),
    ),
  ];
  if (dateReferences.length > 1)
    issues.push(
      "Use one target date per request. Choose a date and run the request again.",
    );
  const dateExpressions = [];
  let date = null;
  if (/\btomorrow\b/.test(input)) {
    date = addDays(DEMO_TODAY, 1);
    dateExpressions.push("tomorrow");
    steps.date.push({
      rule: "relative",
      matched: "tomorrow",
      calc: `${DEMO_TODAY} + 1 day`,
      result: date,
    });
  } else if (/\btoday\b/.test(input)) {
    date = DEMO_TODAY;
    dateExpressions.push("today");
    steps.date.push({
      rule: "relative",
      matched: "today",
      calc: `${DEMO_TODAY} + 0 days`,
      result: date,
    });
  }
  const explicit = input.match(
    new RegExp(
      `\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`,
    ),
  );
  if (explicit) {
    const year = explicit[3] ? +explicit[3] : +DEMO_TODAY.slice(0, 4);
    const month = MONTHS.indexOf(explicit[1]) + 1;
    date = `${year}-${String(month).padStart(2, "0")}-${String(+explicit[2]).padStart(2, "0")}`;
    const parsed = new Date(`${date}T12:00:00Z`);
    const valid =
      Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === date;
    steps.date.push({
      rule: "explicit",
      matched: explicit[0],
      calc: `month "${explicit[1]}" → ${month}, day ${+explicit[2]}, year ${year}${explicit[3] ? "" : " (reference year)"}`,
      result: valid ? date : null,
    });
    if (!valid) {
      issues.push(
        "That calendar date does not exist. Use a date such as October 20.",
      );
      date = null;
    }
    dateExpressions.push(explicit[0]);
  }
  const dayMatch = input.match(
    new RegExp(`\\b(?:(next|every)\\s+)?(${DAYS.join("|")})\\b`),
  );
  if (dayMatch && !date) {
    const todayDay = new Date(`${DEMO_TODAY}T12:00:00Z`).getUTCDay();
    const target = DAYS.indexOf(dayMatch[2]);
    const delta = (target - todayDay + 7) % 7 || 7;
    date = addDays(DEMO_TODAY, delta);
    dateExpressions.push(dayMatch[0]);
    steps.date.push({
      rule: "weekday",
      matched: dayMatch[0],
      calc: `((${target} − ${todayDay} + 7) mod 7) || 7 = ${delta} days after ${DEMO_TODAY}`,
      result: date,
    });
  } else if (dayMatch)
    steps.date.push({
      rule: "weekday",
      matched: dayMatch[0],
      calc: "skipped: a date was already found",
      result: null,
    });
  const clockMatches = Array.from(
    input.matchAll(
      /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))\s*(am|pm)?\b|\b(?:at\s+)?(\d{1,2})\s*(am|pm)\b|\bat\s+(\d{1,2})\b/g,
    ),
  );
  const clock = clockMatches[0];
  let time = null;
  if (clockMatches.length > 1) issues.push("Use one target time per request.");
  if (clock) {
    let hour = Number(clock[1] ?? clock[4] ?? clock[6]);
    const minute = Number(clock[2] ?? 0);
    const meridiem = clock[3] ?? clock[5];
    steps.clock = {
      matched: clock[0],
      form: clock[1] !== undefined ? "h:mm" : clock[4] !== undefined ? "h am/pm" : "bare hour",
      hour,
      minute,
      meridiem: meridiem ?? null,
      calc: null,
      result: null,
    };
    if (minute > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23))
      issues.push(
        `${clock[0].replace(/^at\s+/, "")} is not a valid time. Use 00:00–23:59 or a time such as 11 AM.`,
      );
    else if (!meridiem && clock[6] && hour >= 1 && hour <= 12)
      issues.push(`Does ${hour} mean AM or PM? Add AM, PM, or a 24-hour time.`);
    else {
      if (meridiem) {
        const converted = (hour % 12) + (meridiem === "pm" ? 12 : 0);
        steps.clock.calc = `(${hour} mod 12) + ${meridiem === "pm" ? 12 : 0} = ${converted}`;
        hour = converted;
      }
      time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      steps.clock.result = time;
    }
  }
  const recurring = /\bevery\b/.test(input);
  const countMatch = input.match(/\bfor\s+(\d+)\s+weeks?\b/);
  const occurrences = countMatch ? Number(countMatch[1]) : null;
  if (recurring || countMatch)
    steps.recurrence = {
      every: recurring,
      weeks: occurrences,
      matched: countMatch?.[0] ?? null,
    };
  if (recurring && !dayMatch)
    issues.push(
      "This demo supports weekly recurrence. Specify a weekday, such as every Friday.",
    );
  if (recurring && !occurrences)
    issues.push(
      "For how many weeks? Add “for 4 weeks” to bound this recurring reminder.",
    );
  if (recurring && occurrences && (occurrences < 1 || occurrences > 12))
    issues.push("Choose between 1 and 12 weeks for this classroom demo.");
  if (recurring && intent !== "create")
    issues.push(
      "This demo creates new weekly schedules. To move an existing reminder, choose one date and time.",
    );
  let title = input;
  const strip = (label, next) => {
    if (next !== title) steps.title.push({ label, before: title, after: next });
    title = next;
  };
  strip(
    "remove the command words",
    title.replace(
      /^(?:please\s+)?(?:remind\s+me\s+(?:to\s+)?|(?:create|add|set)\s+(?:a\s+)?(?:reminder\s+)?(?:to\s+)?|(?:move|reschedule|change|update|find|show|search|get|list|delete|remove|cancel)\s+(?:my\s+)?)/,
      "",
    ),
  );
  for (const expression of dateExpressions)
    strip(`remove the date “${expression}”`, title.replace(expression, ""));
  if (clock) strip(`remove the time “${clock[0]}”`, title.replace(clock[0], ""));
  strip(
    "remove “for N weeks”",
    title.replace(/\bfor\s+\d+\s+weeks?\b/g, ""),
  );
  strip(
    "remove “reminder” and “my”",
    title.replace(/\b(reminders?|my)\b/g, ""),
  );
  strip("remove symbols", title.replace(/[^\p{L}\p{N}\s'-]/gu, ""));
  strip(
    "collapse spaces and trim a dangling to/on/at",
    title
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b(to|on|at)\s*$/g, "")
      .trim(),
  );
  const keywords = terms(title, p);
  if (intent === "unknown")
    issues.push(
      "Start with remind me, find, move, or delete. This demo uses explicit command rules.",
    );
  return {
    intent,
    title,
    date,
    time,
    recurring,
    occurrences,
    keywords,
    issues,
    steps,
  };
}

export function vectorize(queryTerms, records, p = PLANNER_DEFAULTS) {
  const documents = records.map((r) => terms(r.title, p));
  const vocabulary = [...new Set([...documents.flat(), ...queryTerms])].sort();
  const dimensions = vocabulary.map((term) => {
    const df = documents.filter((doc) => doc.includes(term)).length;
    const idf = !p.useIdf
      ? 1
      : p.smoothIdf
        ? Math.log((records.length + 1) / (df + 1)) + 1
        : Math.log(records.length / Math.max(df, 1)) + 1;
    return { term, df, idf };
  });
  const encode = (values) =>
    dimensions.map(
      ({ term, idf }) => values.filter((v) => v === term).length * idf,
    );
  const query = encode(queryTerms);
  const magnitude = (values) =>
    Math.sqrt(values.reduce((sum, v) => sum + v * v, 0));
  const results = records
    .map((record, i) => {
      const vector = encode(documents[i]);
      const dot = query.reduce((sum, v, j) => sum + v * vector[j], 0);
      const denominator = magnitude(query) * magnitude(vector);
      return {
        record,
        vector,
        dot,
        score: denominator ? Math.min(1, dot / denominator) : 0,
        matched: queryTerms.filter((t) => documents[i].includes(t)),
      };
    })
    .sort(
      (a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id),
    );
  return {
    documents,
    dimensions,
    query,
    results,
    queryMagnitude: magnitude(query),
  };
}

export function analyze(text, records = SEED_RECORDS, selectedId = null, p = PLANNER_DEFAULTS) {
  const started = performance.now();
  const original = text.slice(0, MAX_INPUT);
  const normalized = normalize(original);
  const tokens = tokenize(original, p);
  const entities = extract(original, p);
  const vectors = vectorize(entities.keywords, records, p);
  const candidates = vectors.results.filter((r) => r.score > p.matchThreshold);
  const ask = (reason, message) => ({ status: "clarify", reason, message });
  const edits = ["update", "delete"].includes(entities.intent);
  const gap = candidates.length > 1 ? candidates[0].score - candidates[1].score : null;
  const missing =
    !entities.date && !entities.time ? "date and time" : !entities.date ? "date" : "time";
  // Checked top to bottom; the first rule whose test is true decides.
  const rules = [
    {
      id: "empty",
      test: "the request is empty",
      hit: () => !normalized,
      decide: () => ask("empty", "Enter a request to begin."),
    },
    {
      id: "validation",
      test: "extraction reported a problem",
      hit: () => entities.issues.length > 0,
      decide: () => ask("validation", entities.issues[0]),
    },
    {
      id: "title",
      test: "no title words were found",
      hit: () => !entities.title || !entities.keywords.length,
      decide: () =>
        ask(
          "title",
          "What should the reminder be about? Include a title such as “call advisor”.",
        ),
    },
    {
      id: "search",
      test: "the command is a search",
      hit: () => entities.intent === "search",
      decide: () => ({
        status: "answer",
        reason: "search",
        message: candidates.length
          ? `Found ${candidates.length} matching reminder${candidates.length === 1 ? "" : "s"}. Results are ranked by word overlap.`
          : "No matching reminders. Try words from a sample title.",
      }),
    },
    {
      id: "no-match",
      test: `update/delete, and no record scores above ${p.matchThreshold}`,
      hit: () => edits && !candidates.length,
      decide: () =>
        ask(
          "no-match",
          "No reminder matches that title. Try “call advisor” or “GDP report”.",
        ),
    },
    {
      id: "selection",
      test: "a chosen record is not one of the candidates",
      hit: () =>
        edits && !!selectedId && !candidates.some((c) => c.record.id === selectedId),
      decide: () =>
        ask(
          "selection",
          "That selection is not a matching reminder. Choose a record from this run.",
        ),
    },
    {
      id: "duplicate",
      test: `update/delete, nothing chosen, top two scores differ by < ${p.tieGap}`,
      hit: () => edits && !selectedId && gap !== null && gap < p.tieGap,
      decide: () =>
        ask(
          "duplicate",
          "Which reminder do you mean? Choose the record below before we prepare a change.",
        ),
    },
    {
      id: "missing-fields",
      test: "not a delete, and the date or time is missing",
      hit: () => entities.intent !== "delete" && (!entities.date || !entities.time),
      decide: () =>
        ask(
          "missing-fields",
          `What ${missing} should I use? Edit the request and run it again.`,
        ),
    },
    {
      id: "ready",
      test: "otherwise",
      hit: () => true,
      decide: () => {
        const target =
          candidates.find((c) => c.record.id === selectedId)?.record ??
          candidates[0]?.record;
        const proposal = {
          intent: entities.intent,
          targetId: entities.intent === "create" ? null : target?.id,
          expectedRevision: entities.intent === "create" ? null : target?.revision,
          title: entities.intent === "create" ? entities.title : target?.title,
          date: entities.date,
          time: entities.time,
          dates:
            entities.recurring && entities.occurrences
              ? Array.from({ length: entities.occurrences }, (_, i) =>
                  addDays(entities.date, i * 7),
                )
              : entities.date
                ? [entities.date]
                : [],
        };
        return {
          status: "proposal",
          reason: "ready",
          proposal,
          message:
            entities.intent === "delete"
              ? `Ready to delete “${proposal.title}” (${proposal.targetId}). Review and confirm below.`
              : `Ready to ${entities.intent === "create" ? "create" : "move"} “${proposal.title}”${proposal.dates.length > 1 ? ` on ${proposal.dates.length} weekly dates` : ` to ${friendlyDate(proposal.date)}`} at ${friendlyTime(proposal.time)}. Review and confirm below.`,
        };
      },
    },
  ];
  const evaluated = [];
  let decision;
  for (const rule of rules) {
    const hit = rule.hit();
    evaluated.push({ id: rule.id, test: rule.test, hit });
    if (hit) {
      decision = rule.decide();
      break;
    }
  }
  return {
    original,
    normalized,
    tokens,
    entities,
    vectors,
    decision,
    rules: evaluated,
    candidates: candidates.map((c) => c.record.id),
    gap,
    selectedId,
    elapsed: +(performance.now() - started).toFixed(2),
    referenceDate: DEMO_TODAY,
    params: p,
  };
}

// A pure transaction: the caller replaces state only on success. Confirming an
// old update twice fails its revision check; UI consumption also guards creates.
export function applyProposal(records, proposal) {
  if (!proposal || !["create", "update", "delete"].includes(proposal.intent))
    throw new Error("A valid proposal is required.");
  if (proposal.intent === "create") {
    if (!proposal.title || !proposal.dates?.length || !proposal.time)
      throw new Error("The proposal is incomplete.");
    const nextNumber =
      Math.max(0, ...records.map((r) => Number(r.id.replace("N", "")) || 0)) +
      1;
    return [
      ...records,
      ...proposal.dates.map((date, i) => ({
        id: `N${nextNumber + i}`,
        title: proposal.title,
        date,
        time: proposal.time,
        revision: 1,
        note: "Created in the TRACE sandbox.",
      })),
    ];
  }
  const target = records.find((r) => r.id === proposal.targetId);
  if (!target || target.revision !== proposal.expectedRevision)
    throw new Error(
      "This record changed after the preview. Run the request again before confirming.",
    );
  if (proposal.intent === "delete")
    return records.filter((r) => r.id !== target.id);
  if (!proposal.date || !proposal.time)
    throw new Error("The proposal is incomplete.");
  return records.map((r) =>
    r.id === target.id
      ? {
          ...r,
          date: proposal.date,
          time: proposal.time,
          revision: r.revision + 1,
        }
      : r,
  );
}

export function exportTrace(trace) {
  return JSON.stringify(
    { format: "trace-v1", mode: "deterministic-classroom-sandbox", ...trace },
    null,
    2,
  );
}
