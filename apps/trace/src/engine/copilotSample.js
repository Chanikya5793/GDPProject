// A sample copilot exchange for the standalone site, the planner's demo mode
// and tests. Field names follow the planner client (records) and the
// backend's ChatResponse (response).
export const SAMPLE_RECORDS = [
  { id: "t1", type: "task", title: "Submit GDP report", notes: "Upload the team progress report", dueDate: "2026-10-23", dueTime: "17:00", priority: "high", category: "School", completed: false, approvedForAi: true },
  { id: "t2", type: "task", title: "Study for mobile computing", notes: "Review iOS navigation and storage", dueDate: "2026-10-22", dueTime: "14:00", priority: "medium", category: "School", completed: false, approvedForAi: true },
  { id: "t3", type: "task", title: "Pay housing bill", notes: "", dueDate: "2026-10-25", dueTime: "12:00", priority: "medium", category: "Personal", completed: false, approvedForAi: true },
  { id: "r1", type: "reminder", title: "Call advisor", date: "2026-10-20", time: "11:00", notes: "", completed: false, approvedForAi: true },
  { id: "r2", type: "reminder", title: "Meet professor", date: "2026-10-21", time: "11:00", notes: "Research project", completed: false, approvedForAi: true },
  { id: "n1", type: "note", title: "Advisor meeting", body: "Ask about spring registration and the GDP report timeline.", approvedForAi: true },
  { id: "n2", type: "note", title: "Journal", body: "Private thoughts about the semester.", approvedForAi: false },
];

export const SAMPLE_MESSAGE = "When is my GDP report due? Move it to Friday at 5 PM.";

export const SAMPLE_RESPONSE = {
  answer: "Your GDP report is due Thursday, Oct 23 at 5:00 PM. I prepared a change to move it to Friday, Oct 24 at 5:00 PM — confirm it below.",
  steps: [{ tool: "search_planner", label: "Searched the planner for “GDP report”" }],
  citations: [
    { citation_id: "S1", entity_type: "task", record_id: "t1", revision: 3, title: "Submit GDP report", excerpt: "Submit GDP report · Due 2026-10-23 17:00 · Priority high" },
  ],
  retrieval: { attempted: true, result_count: 2, entity_types: ["task", "note"], abstained: false },
  proposals: [
    {
      proposal_id: "p1",
      operation: "update",
      entity_type: "task",
      record_id: "t1",
      base_revision: 3,
      before: { title: "Submit GDP report", due_date: "2026-10-23", due_time: "17:00" },
      after: { title: "Submit GDP report", due_date: "2026-10-24", due_time: "17:00" },
      rationale: "You asked to move it to Friday at 5 PM.",
      status: "pending",
    },
  ],
  unavailable: [],
};

export function sampleCopilot() {
  return {
    message: SAMPLE_MESSAGE,
    history: [],
    focus: null,
    timezone: "America/Chicago",
    today: "2026-10-22",
    records: SAMPLE_RECORDS,
    response: SAMPLE_RESPONSE,
    model: null,
    timings: null,
    demo: true,
  };
}
