import { Panel, Table, Tag, fixed } from "../../kit.jsx";
import { PLANNER_DEFAULTS } from "../../../engine/pipeline.js";
import { analyzedRecords, decisionRows, indexed, paramsOf, revealState, slotRow, tunedNote } from "./util.js";
import { column, tableBlock } from "../../../map/blocks.js";

// The rule list inside analyze(), in order. The trace keeps only the rules
// that were evaluated, so the rest are listed here to show them as skipped.
const rulesFor = (p) => [
  { id: "empty", test: "the request is empty" },
  { id: "validation", test: "extraction reported a problem" },
  { id: "title", test: "no title words were found" },
  { id: "search", test: "the command is a search" },
  { id: "no-match", test: `update/delete, and no record scores above ${p.matchThreshold}` },
  { id: "selection", test: "a chosen record is not one of the candidates" },
  { id: "duplicate", test: `update/delete, nothing chosen, top two scores differ by < ${p.tieGap}` },
  { id: "missing-fields", test: "not a delete, and the date or time is missing" },
  { id: "ready", test: "otherwise" },
];
const RULES = rulesFor(PLANNER_DEFAULTS);
const RULE_LINE = Object.fromEntries(RULES.map((r, i) => [r.id, 2 + i]));

const q = (v) => (v === null || v === undefined ? "null" : typeof v === "string" ? `“${v}”` : String(v));

// The values each rule's test looks at, and how they combine.
function evaluate(trace, id) {
  const e = trace.entities;
  const p = trace.params ?? PLANNER_DEFAULTS;
  const edits = ["update", "delete"].includes(e.intent);
  const scoreOf = (cid) => trace.vectors.results.find((r) => r.record.id === cid)?.score;
  const cands = trace.candidates;
  const candText = cands.length ? cands.map((c) => `${c} ${fixed(scoreOf(c))}`).join(", ") : "none";
  const notEdit = `intent = ${q(e.intent)} is not update or delete`;
  switch (id) {
    case "empty":
      return trace.normalized
        ? `normalized.length = ${trace.normalized.length} → !normalized = false`
        : "normalized = “” → !normalized = true";
    case "validation":
      return e.issues.length
        ? `issues.length = ${e.issues.length} > 0 → true`
        : "issues.length = 0 → false";
    case "title":
      return `title = ${q(e.title)}, keywords.length = ${e.keywords.length} → ${!e.title || !e.keywords.length}`;
    case "search":
      return `intent = ${q(e.intent)} → ${e.intent === "search"}`;
    case "no-match":
      return edits
        ? `candidates above ${p.matchThreshold}${tunedNote(p, "matchThreshold")}: ${candText} (${cands.length}) → ${!cands.length}`
        : `${notEdit} → false`;
    case "selection":
      if (!edits) return `${notEdit} → false`;
      if (!trace.selectedId) return "selectedId = null (nothing chosen) → false";
      return `selectedId = ${q(trace.selectedId)}; candidates: ${cands.join(", ") || "none"} → ${
        cands.includes(trace.selectedId) ? `${trace.selectedId} is a candidate → false` : `${trace.selectedId} is not a candidate → true`
      }`;
    case "duplicate": {
      if (!edits) return `${notEdit} → false`;
      if (trace.selectedId) return `selectedId = ${q(trace.selectedId)} (a record was chosen) → false`;
      if (trace.gap === null) return `candidates: ${candText}; fewer than two, gap = null → false`;
      const [a, b] = cands;
      return `candidates: ${a} ${fixed(scoreOf(a))}, ${b} ${fixed(scoreOf(b))}; gap ${fixed(trace.gap)} ${
        trace.gap < p.tieGap ? `< ${p.tieGap}${tunedNote(p, "tieGap")} → true` : `≥ ${p.tieGap}${tunedNote(p, "tieGap")} → false`
      }`;
    }
    case "missing-fields":
      return e.intent === "delete"
        ? "intent = “delete” (a delete needs no date or time) → false"
        : `date = ${q(e.date)}, time = ${q(e.time)} → ${!e.date || !e.time}`;
    case "ready":
      return "no earlier rule fired → true";
    default:
      return "";
  }
}

function why(trace, id, hit) {
  const e = trace.entities;
  switch (id) {
    case "empty":
      return hit ? "The request is empty." : "The request has text.";
    case "validation":
      return hit ? `Extract reported ${e.issues.length === 1 ? "a problem" : `${e.issues.length} problems`}; the first one becomes the question.` : "Extract found no problems.";
    case "title":
      return hit ? "Nothing is left to describe the reminder." : `The title has ${e.keywords.length === 1 ? "a search term" : "search terms"}.`;
    case "search":
      return hit ? "A search answers with the ranked records and never writes." : "This is not a search.";
    case "no-match":
      return hit ? "An update or delete needs an existing record, and none scored high enough." : "";
    case "selection":
      return hit ? "The chosen record is not among this run's candidates." : "";
    case "duplicate":
      return hit ? "Two records are too close to choose between, so the visitor must pick one." : "";
    case "missing-fields":
      return hit ? "A create or move needs both a date and a time." : "";
    default:
      return "";
  }
}

const mod = {
  id: "decide",
  source: [["pipeline", "analyze"]],
  code: [
    'const edits = intent === "update" || intent === "delete"',
    "const rules = [",
    '  { id: "empty",          hit: () => !normalized },',
    '  { id: "validation",     hit: () => issues.length > 0 },',
    '  { id: "title",          hit: () => !title || !keywords.length },',
    '  { id: "search",         hit: () => intent === "search" },',
    '  { id: "no-match",       hit: () => edits && !candidates.length },',
    '  { id: "selection",      hit: () => edits && selectedId && !candidates.includes(selectedId) },',
    '  { id: "duplicate",      hit: () => edits && !selectedId && gap !== null && gap < tieGap },   // a setting',
    '  { id: "missing-fields", hit: () => intent !== "delete" && (!date || !time) },',
    '  { id: "ready",          hit: () => true },',
    "]",
    "for (const rule of rules) if (rule.hit()) { decision = rule.decide(); break }",
    "// ready: target = candidates.find(c => c.id === selectedId) ?? candidates[0]",
    "// proposal = { intent, targetId, expectedRevision: target.revision, title, date, time,",
    "//   dates: recurring ? [0 … n−1].map(i => addDays(date, 7 * i)) : [date] }",
  ],
  frames({ trace }) {
    const frames = [];
    const { decision, entities: e } = trace;
    trace.rules.forEach((rule, i) => {
      const values = evaluate(trace, rule.id);
      const reason = why(trace, rule.id, rule.hit);
      frames.push({
        phase: "Rules",
        line: i === 0 ? [0, RULE_LINE[rule.id], 12] : [RULE_LINE[rule.id], 12],
        say: `Rule ${i + 1}, ${rule.id} (${rule.test}): ${values}.${rule.hit ? ` It fires, so the loop stops here. ${reason}` : ""}`,
        vars: { rule: rule.id, hit: rule.hit, ...(i === 0 ? { edits: ["update", "delete"].includes(e.intent) } : {}) },
        at: i,
        hold: rule.hit ? 1.4 : 0.9,
      });
    });
    const p = decision.proposal;
    if (p) {
      const target = p.targetId;
      frames.push({
        phase: "Proposal",
        line: [13, 14, 15],
        say:
          p.intent === "create"
            ? `A create has no target: targetId = null, expectedRevision = null. ${
                p.dates.length > 1
                  ? `recurring with ${p.dates.length} weeks: dates = ${p.dates.join(", ")} (${e.date} + 7 × i).`
                  : `dates = [${p.dates.join(", ")}].`
              }`
            : `target = ${trace.selectedId ? `the chosen record ${trace.selectedId}` : `the top candidate ${target}`} (“${p.title}”). expectedRevision = ${p.expectedRevision}, the revision seen now; Apply will refuse to write if it has changed.${
                p.intent === "update" ? ` New values: date = ${p.date}, time = ${p.time}.` : ""
              }`,
        vars: { targetId: p.targetId, expectedRevision: p.expectedRevision, dates: p.dates },
        at: trace.rules.length,
      });
    }
    frames.push({
      phase: "Decision",
      line: 12,
      say: `decision.status = “${decision.status}”, reason = “${decision.reason}”. ${decision.message}`,
      vars: { status: decision.status, reason: decision.reason, ...(p ? { "proposal.intent": p.intent } : {}) },
      at: trace.rules.length + 1,
    });
    return frames;
  },
  Stage({ ctx, frame, frames, seek }) {
    const { trace } = ctx;
    const { decision } = trace;
    const evaluated = trace.rules;
    const firedAt = evaluated.findIndex((r) => r.hit);
    const p = decision.proposal;
    return (
      <div className="x-stack">
        <Panel title="Rules, checked top to bottom" note="The first rule whose test is true decides. Click an evaluated rule to jump to it.">
          <Table className="p-table"
            head={["#", "rule", "test", "values", "result"]}
            active={frame.phase === "Rules" ? frame.at : undefined}
            onRow={(i) => {
              const at = frames.findIndex((f) => f.phase === "Rules" && f.at === i);
              if (at >= 0) seek(at);
            }}
            rows={rulesFor(paramsOf(ctx)).map((r, i) => {
              const ev = evaluated[i];
              const reached = ev && i <= frame.at;
              if (!ev)
                return {
                  cls: "p-skipped",
                  cells: [i + 1, <code key="id">{r.id}</code>, r.test, "", <Tag key="t" kind="skip">not checked</Tag>],
                };
              if (!reached)
                return { cls: "is-pending", cells: [i + 1, <code key="id">{r.id}</code>, ev.test, "…", "…"] };
              return {
                cls: ev.hit ? "p-hit" : "",
                cells: [
                  i + 1,
                  <code key="id">{r.id}</code>,
                  <span key="t" className="p-rule-test">{ev.test}</span>,
                  <span key="v" className="p-values">{evaluate(trace, r.id)}</span>,
                  ev.hit ? <Tag key="t" kind="pass">true: fires</Tag> : <Tag key="t" kind="fail">false</Tag>,
                ],
              };
            })}
          />
        </Panel>
        {frame.at >= evaluated.length && (
          <Panel title={`decision (rule ${firedAt + 1}, ${decision.reason})`}>
            <dl className="p-kv">
              <dt>status</dt>
              <dd>
                <Tag kind={decision.status === "proposal" ? "pass" : decision.status === "answer" ? "kept" : "fail"}>{decision.status}</Tag>
              </dd>
              <dt>reason</dt>
              <dd>{decision.reason}</dd>
              <dt>message</dt>
              <dd>{decision.message}</dd>
            </dl>
          </Panel>
        )}
        {p && frame.at >= evaluated.length && (
          <Panel title="proposal" note="Nothing is written in this step. Apply checks expectedRevision before changing anything.">
            <dl className="p-kv">
              <dt>intent</dt>
              <dd>{p.intent}</dd>
              <dt>targetId</dt>
              <dd>{q(p.targetId)}</dd>
              <dt>expectedRevision</dt>
              <dd>{q(p.expectedRevision)}</dd>
              <dt>title</dt>
              <dd>{q(p.title)}</dd>
              <dt>date</dt>
              <dd>{q(p.date)}</dd>
              <dt>time</dt>
              <dd>{q(p.time)}</dd>
              <dt>dates</dt>
              <dd>
                [{p.dates.map((d, i) => (i ? `, ${d}` : d))}]
                {p.dates.length > 1 && <small className="p-dim"> = {p.date} + 7 × i, i = 0 … {p.dates.length - 1}</small>}
              </dd>
            </dl>
          </Panel>
        )}
      </div>
    );
  },
};

// ---- Map layer ----

const SLOT = (key) => [[slotRow(key), 1]];
// The cells of earlier steps each rule reads.
function ruleSources(ctx, id) {
  const { trace } = ctx;
  const recs = analyzedRecords(ctx);
  const n = recs.length;
  const candCol = { cosine: { source: column(5, n) } };
  switch (id) {
    case "empty":
      return { normsteps: { source: [[3, 1]] } };
    case "validation":
      return { slots: { source: SLOT("issues") } };
    case "title":
      return { slots: { source: SLOT("title") }, terms: { source: trace.entities.keywords.map((_, k) => [k, 1]) } };
    case "search":
      return { slots: { source: SLOT("intent") } };
    case "no-match":
      return { slots: { source: SLOT("intent") }, ...candCol };
    case "selection":
      return candCol;
    case "duplicate":
      return { gap: { source: [[0, 2], [0, 3]] } };
    case "missing-fields":
      return { slots: { source: [...SLOT("intent"), ...SLOT("date"), ...SLOT("time")] } };
    default:
      return {};
  }
}

function cellsOf(frame, ctx) {
  const { trace } = ctx;
  const rows = decisionRows(trace);
  const fired = trace.rules.findIndex((r) => r.hit);
  if (frame.phase === "Rules") {
    const i = frame.at;
    const id = trace.rules[i].id;
    const src = ruleSources(ctx, id);
    if (id === "ready") src.rules = { source: Array.from({ length: i }, (_, k) => [k, 3]) };
    return { ...src, rules: { ...(src.rules ?? {}), active: [[i, 2], [i, 3]] } };
  }
  if (frame.phase === "Proposal") {
    const p = trace.decision.proposal;
    const recs = analyzedRecords(ctx);
    const t = recs.findIndex((r) => r.id === p.targetId);
    return {
      slots: { source: p.intent === "create" ? [...SLOT("title"), ...SLOT("date"), ...SLOT("time")] : [...SLOT("date"), ...SLOT("time")] },
      ...(t >= 0 ? { cosine: { source: [[t, 0], [t, 3]] } } : {}),
      decision: { active: rows.map((_, r) => [r, 1]).slice(3) },
    };
  }
  return { rules: { source: [[fired, 3]] }, decision: { active: [[0, 1], [1, 1], [2, 1]] } };
}

const stripResult = (v) => v.replace(/\s*→\s*(true|false)$/, "").replace(/→ !normalized = (true|false)$/, "→ !normalized");

// ---- Explain a cell ----

const RULE_MEANING = {
  empty: "Ask for a request when nothing was typed.",
  validation: "Ask about the first problem Extract found, such as an impossible time.",
  title: "Ask what the reminder is about when no search term is left.",
  search: "A search answers with ranked records and never writes.",
  "no-match": "An update or delete needs an existing record; ask when none scores above the match threshold.",
  selection: "A record chosen by the visitor must be one of this run's candidates.",
  duplicate: "When the top two candidates score almost the same, ask which one you meant.",
  "missing-fields": "A create or move needs both a date and a time.",
  ready: "Every check passed: prepare a proposal for you to confirm.",
};

function explainRule(trace, rule, r, c) {
  if (!rule) return null;
  const ev = trace.rules[r];
  const fired = trace.rules.findIndex((x) => x.hit);
  const meaning = `Rule ${r + 1}, ${rule.id}. ${RULE_MEANING[rule.id] ?? ""}`;
  if (c === 0 || c === 1) return { meaning, formula: `fires when: ${ev?.test ?? rule.test}` };
  if (!ev)
    return c === 3
      ? { meaning: `Not checked: rule ${fired + 1} (${trace.rules[fired]?.id}) already decided, and the list stops at the first true rule.` }
      : null;
  const values = evaluate(trace, rule.id);
  if (c === 2) return { meaning: "The values this rule's test looks at in this run.", formula: ev.test, worked: values };
  if (c === 3)
    return {
      meaning: ev.hit ? `True, so this rule decides and no later rule is checked.` : "False, so the next rule is checked.",
      formula: "decision = the first rule whose test is true",
      worked: values,
    };
  return null;
}

const FIELD_MEANING = {
  status: "What the planner does next: clarify asks you a question, answer shows search results, proposal prepares a change.",
  reason: "The id of the rule that decided.",
  message: "The text shown to you.",
  intent: "The kind of change the proposal makes.",
  targetId: "The record the change applies to. A create has none.",
  expectedRevision: "The record's revision seen now. Apply refuses to write if it has changed since.",
  title: "The reminder's title in the proposal.",
  "date / time": "The new date and time.",
  dates: "Every date the change writes. A weekly reminder gets one per week.",
};

function explainDecision(trace, r, c) {
  const row = decisionRows(trace)[r];
  if (!row) return null;
  const meaning = FIELD_MEANING[row.key] ?? row.key;
  if (c === 0) return { meaning };
  if (c !== 1) return null;
  const d = trace.decision;
  const p = d.proposal;
  const fired = trace.rules.find((x) => x.hit);
  const worked = {
    status: `rule “${fired?.id}” fired → ${d.status}`,
    reason: `rule “${fired?.id}” fired → reason = “${d.reason}”`,
    targetId: p && (p.intent === "create" ? "a create has no target → null" : trace.selectedId ? `the chosen record → ${p.targetId}` : `the top candidate → ${p.targetId}`),
    expectedRevision: p && (p.intent === "create" ? "a create has no target → null" : `${p.targetId}.revision = ${p.expectedRevision}`),
    dates:
      p && (p.dates.length > 1 ? `${p.date} + 7 × i for i = 0 … ${p.dates.length - 1} → ${p.dates.join(", ")}` : `[${p.dates.join(", ")}]`),
  }[row.key];
  return { meaning, ...(worked ? { worked } : {}) };
}

Object.assign(mod, {
  blocks(ctx) {
    const { trace } = ctx;
    const p = paramsOf(ctx);
    const evaluated = trace.rules;
    return [
      tableBlock({
        id: "rules",
        title: "rules, in order · the first true one decides",
        head: ["rule", "test", "values", "result"],
        widths: [1.45, 4.3, 5.7, 1.15],
        rows: rulesFor(p).map((r, i) => {
          const ev = evaluated[i];
          if (!ev)
            return [
              { text: r.id, tone: "muted", align: "left" },
              { text: r.test, tone: "muted", align: "left" },
              { text: "", tone: "muted" },
              { text: "not checked", tone: "muted" },
            ];
          return [
            { text: r.id, align: "left", bold: ev.hit },
            { text: ev.test, align: "left", dim: true },
            { text: stripResult(evaluate(trace, r.id)), align: "left" },
            ev.hit ? { text: "true", tone: "good", bold: true } : { text: "false", tone: "muted" },
          ];
        }),
        explain: (r, c) => explainRule(trace, rulesFor(p)[r], r, c),
      }),
      tableBlock({
        id: "decision",
        title: "decision",
        head: ["field", "value"],
        widths: [2.1, 8.6],
        rows: decisionRows(trace).map((r) => [
          { text: r.key, align: "left", dim: true },
          { text: String(r.value), align: "left", tone: r.tone, bold: r.key === "status" },
        ]),
        explain: (r, c) => explainDecision(trace, r, c),
      }),
    ];
  },
  output: "decision",
  state(frame, ctx) {
    return revealState(mod, frame, ctx, cellsOf, {
      rules: (r, c) => c < 2 && r < ctx.trace.rules.length,
      decision: (r, c) => c === 0,
    });
  },
  math(frame, { trace }) {
    if (frame.phase === "Rules") {
      const r = trace.rules[frame.at];
      return [{ label: r.id, terms: [stripResult(evaluate(trace, r.id))], result: String(r.hit) }];
    }
    const d = trace.decision;
    if (frame.phase === "Proposal") {
      const p = d.proposal;
      if (p.intent === "create")
        return [
          { label: "target", terms: ["none (create)"] },
          { label: "dates", terms: p.dates.length > 1 ? [`${p.date} + 7 × i, i = 0 … ${p.dates.length - 1}`] : [String(p.date)], result: p.dates.join(", ") },
        ];
      return [
        { label: "target", terms: [trace.selectedId ? `selectedId “${trace.selectedId}”` : "candidates[0]"], result: p.targetId },
        { label: "expectedRevision", terms: [`${p.targetId}.revision`], result: String(p.expectedRevision) },
        ...(p.intent === "update" ? [{ label: "new values", terms: [String(p.date), String(p.time)], op: "," }] : []),
      ];
    }
    const fired = trace.rules.findIndex((r) => r.hit);
    return [{ label: "decision", terms: [`rule ${fired + 1} “${trace.rules[fired].id}”`], result: `${d.status} / ${d.reason}` }];
  },
});

const rawFrames = mod.frames;
mod.frames = (ctx) => indexed(rawFrames.call(mod, ctx));

export default mod;
