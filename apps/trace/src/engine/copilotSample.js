import { buildPrompt, CANDIDATES, MAX_DISTANCE, RETRIEVAL_LIMIT, recordText, retrieve, safeExcerpt } from "./copilot.js";

// A sample copilot exchange for the standalone site, the planner's demo mode
// and tests. Field names follow the planner client (records) and the
// backend's ChatResponse (response). Everything the server would have
// computed is computed here with the browser's copy of its code, so the
// sample is self-consistent; it is still a sample, not a reply anyone got.
export const SAMPLE_RECORDS = [
  { id: "t1", type: "task", title: "Submit GDP report", notes: "Upload the team progress report", dueDate: "2026-10-23", dueTime: "17:00", priority: "high", category: "School", completed: false, estimatedMinutes: 90, keepScheduled: false, revision: 3, updatedAt: "2026-10-19T14:02:00Z", approvedForAi: true },
  { id: "t2", type: "task", title: "Study for mobile computing", notes: "Review iOS navigation and storage", dueDate: "2026-10-22", dueTime: "14:00", priority: "medium", category: "School", completed: false, estimatedMinutes: 120, keepScheduled: false, revision: 1, updatedAt: "2026-10-18T09:00:00Z", approvedForAi: true },
  { id: "t3", type: "task", title: "Pay housing bill", notes: "", dueDate: "2026-10-25", dueTime: "12:00", priority: "medium", category: "Personal", completed: false, estimatedMinutes: 15, keepScheduled: false, revision: 1, updatedAt: "2026-10-12T09:00:00Z", approvedForAi: true },
  { id: "r1", type: "reminder", title: "Call advisor", date: "2026-10-20", time: "11:00", notes: "", completed: false, revision: 1, updatedAt: "2026-10-15T09:00:00Z", approvedForAi: true },
  { id: "r2", type: "reminder", title: "Meet professor", date: "2026-10-21", time: "11:00", notes: "Research project", completed: false, revision: 1, updatedAt: "2026-10-15T09:00:00Z", approvedForAi: true },
  { id: "n1", type: "note", title: "Advisor meeting", body: "Ask about spring registration and the GDP report timeline.", revision: 2, updatedAt: "2026-10-21T18:30:00Z", approvedForAi: true },
  { id: "n2", type: "note", title: "Journal", body: "Private thoughts about the semester.", revision: 1, updatedAt: "2026-10-21T22:00:00Z", approvedForAi: false },
];

export const SAMPLE_MESSAGE = "When is my GDP report due? Move it to Monday at 9 AM.";

const SAMPLE_TODAY = "2026-10-22";
const SAMPLE_HISTORY = [
  { role: "user", text: "What do I have due this week?" },
  { role: "assistant", text: "Your GDP report is due Friday at 5 PM, and studying for mobile computing is today at 2 PM." },
];
const SAMPLE_EARLIER = [
  { citation_id: "S1", entity_type: "task", record_id: "t1", title: "Submit GDP report" },
  { citation_id: "S2", entity_type: "task", record_id: "t2", title: "Study for mobile computing" },
];

const t1 = SAMPLE_RECORDS[0];
const task = (r, patch = {}) => ({
  entity_type: "task",
  title: r.title,
  due_date: r.dueDate,
  due_time: r.dueTime,
  priority: r.priority,
  category: r.category,
  notes: r.notes,
  completed: r.completed,
  estimated_minutes: r.estimatedMinutes,
  keep_scheduled: r.keepScheduled,
  series_id: null,
  recurrence: null,
  ...patch,
});

export const SAMPLE_RESPONSE = {
  answer: "Due Friday, Oct 23 at 5 PM. Moving it to Monday, Oct 26 at 9 AM.",
  // The opening search is not a step: the model answered from the first
  // prompt, so no lookups ran.
  steps: [],
  citations: [],
  retrieval: { attempted: true, result_count: 0, entity_types: [], abstained: false, reason: null, searches: [] },
  proposals: [
    {
      proposal_id: "p1",
      operation: "update",
      entity_type: "task",
      record_id: "t1",
      base_revision: 3,
      before: task(t1),
      after: task(t1, { due_date: "2026-10-26", due_time: "09:00" }),
      rationale: "Update this task.",
      series: [],
      status: "pending",
      created_at: "2026-10-22T15:04:00Z",
      expires_at: "2026-10-23T15:04:00Z",
    },
  ],
  unavailable: [],
};

export function sampleCopilot() {
  return {
    message: SAMPLE_MESSAGE,
    // An earlier turn, so the sample shows what the copilot remembers.
    history: SAMPLE_HISTORY,
    earlier: SAMPLE_EARLIER,
    focus: null,
    timezone: "America/Chicago",
    today: SAMPLE_TODAY,
    records: SAMPLE_RECORDS,
    response: SAMPLE_RESPONSE,
    timings: null,
    demo: true,
  };
}

const OUTCOME = (reason) =>
  !reason ? "kept" : reason.startsWith("distance") ? "too_far" : reason.startsWith("no shared") ? "no_shared_word" : "limit_reached";

// What the server would have sent for the sample: its opening search, the
// citation ledger, the prompt sizes and the one citation the answer used.
function complete() {
  const run = retrieve(SAMPLE_MESSAGE, SAMPLE_RECORDS);
  const exchange = { ...sampleCopilot(), response: null };
  const built = buildPrompt(exchange, { kept: run.kept.map((k) => k.record) });
  const idOf = new Map(built.issued.map((c) => [c.record_id, c.citation_id]));
  const search = {
    query: run.query,
    entity_type: null,
    requested: CANDIDATES,
    limit: RETRIEVAL_LIMIT,
    max_distance: MAX_DISTANCE,
    candidates: run.candidates.map((c, i) => ({
      rank: i + 1,
      distance: Math.round(c.distance * 1e6) / 1e6,
      outcome: OUTCOME(c.reason),
      entity_type: c.record.type,
      record_id: c.record.id,
      citation_id: c.reason ? null : (idOf.get(c.record.id) ?? null),
    })),
    skipped: run.skipped ?? null,
  };
  SAMPLE_RESPONSE.citations = [
    {
      citation_id: idOf.get("t1"),
      entity_type: "task",
      record_id: "t1",
      revision: t1.revision,
      title: t1.title,
      excerpt: safeExcerpt(recordText(t1)),
    },
  ];
  SAMPLE_RESPONSE.retrieval = {
    ...SAMPLE_RESPONSE.retrieval,
    // The whole turn's ledger, not only the search: briefing records count.
    result_count: built.issued.length,
    entity_types: [...new Set(built.issued.map((c) => c.entity_type))].sort(),
    searches: [search],
    turn: {
      today: SAMPLE_TODAY,
      reply_style: built.context.replyStyle,
      daily_capacity_minutes: built.context.capacity,
      indexed_entity_types: built.context.types,
      index_attachments: false,
      history_turns: SAMPLE_HISTORY.length,
      briefing_items: built.sections.find((s) => s.name === "PLANNER_BRIEFING").items,
      briefing_truncated: !!built.briefing.truncated,
      focus: "none",
      focus_from_reference: false,
      // The planner's system message is this long; it is not reproduced here.
      system_chars: 10667,
      rounds: [
        {
          sections: built.sections.map((s) => ({ name: s.name, chars: s.chars, items: s.items ?? null })),
          chars: built.chars,
          tools_available: true,
          tool_requests: 0,
          tool_calls: 0,
        },
      ],
      tool_calls: 0,
      deadline_reached: false,
      issued: built.issued,
    },
  };
}
complete();
