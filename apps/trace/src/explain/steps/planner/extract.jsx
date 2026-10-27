import { Chars, Expr, Panel, Table, Tag } from "../../kit.jsx";
import { DAYS, DEMO_TODAY, INTENT_RULES, MONTHS } from "../../../engine/pipeline.js";
import { SLOT_ROWS, diff, edgeWs, hunkSpans, indexed, plural, revealState, showWs, slotRow, spanOf, tokenCells } from "./util.js";
import { row, tableBlock } from "../../../map/blocks.js";

// Local copies of the patterns inside extract(); the engine does not export them.
const CHAIN_RE =
  /\b(?:and|then|or)\s+(?:remind|create|add|set|move|reschedule|change|update|delete|remove|cancel|find)\b/;
const DATE_REF_RE = new RegExp(
  `\\b(?:today|tomorrow|${DAYS.join("|")}|(?:${MONTHS.join("|")})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+20\\d{2})?)\\b`,
  "g",
);
const EXPLICIT_RE = new RegExp(
  `\\b(${MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(20\\d{2}))?\\b`,
);
const DAY_RE = new RegExp(`\\b(?:(next|every)\\s+)?(${DAYS.join("|")})\\b`);
const CLOCK_RE =
  /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))\s*(am|pm)?\b|\b(?:at\s+)?(\d{1,2})\s*(am|pm)\b|\bat\s+(\d{1,2})\b/g;
const COUNT_RE = /\bfor\s+(\d+)\s+weeks?\b/;

const DATE_RULES = [
  { rule: "relative", pattern: "\\btomorrow\\b, then \\btoday\\b", line: [6, 7] },
  { rule: "explicit", pattern: "(month) (day 1–31)(st|nd|rd|th)? (, 20yy)?", line: [8, 9] },
  { rule: "weekday", pattern: "(next|every)? (sunday … saturday)", line: [10, 11] },
];
const SLOT_KEYS = ["intent", "date", "time", "recurring", "occurrences", "issues", "title", "keywords"];

const cache = new WeakMap();
// Everything the frames and the stage need, derived once per trace.
function study(trace) {
  if (cache.has(trace)) return cache.get(trace);
  const e = trace.entities;
  const st = e.steps;
  const input = st.input;
  const command = st.command;
  const please = input.length - command.length;
  const firstWord = command.match(/^\S+/)?.[0] ?? "";
  const chain = input.match(CHAIN_RE);
  const refs = [...input.matchAll(DATE_REF_RE)];
  const clocks = [...input.matchAll(CLOCK_RE)];
  const dayM = input.match(DAY_RE);
  const explicitM = input.match(EXPLICIT_RE);
  const countM = input.match(COUNT_RE);
  const everyM = input.match(/\bevery\b/);
  const clock = st.clock;
  const invalidTime =
    !!clock && (clock.minute > 59 || (clock.meridiem ? clock.hour < 1 || clock.hour > 12 : clock.hour > 23));
  const ambiguous =
    !!clock && !invalidTime && !clock.meridiem && clock.form === "bare hour" && clock.hour >= 1 && clock.hour <= 12;
  const occ = e.occurrences;
  const byRule = (r) => st.date.find((d) => d.rule === r);
  const checks = [
    { label: "one command per request", map: "one command", line: 4, applies: true, fired: !!chain, detail: chain ? `found “${chain[0]}”` : "no “and / then / or” + command verb" },
    { label: "at most one date", map: "one date", line: 5, applies: true, fired: refs.length > 1, detail: `${plural(refs.length, "date reference")}` },
    { label: "the calendar date exists", map: "date exists", line: 9, applies: !!explicitM, fired: !!explicitM && byRule("explicit")?.result === null, detail: explicitM ? `“${explicitM[0]}”` : "no month + day" },
    { label: "at most one time", map: "one time", line: 13, applies: true, fired: clocks.length > 1, detail: plural(clocks.length, "time match", "time matches") },
    { label: "hour and minute in range", map: "time in range", line: 15, applies: !!clock, fired: invalidTime, detail: clock ? `hour ${clock.hour}, minute ${clock.minute}${clock.meridiem ? `, ${clock.meridiem}` : ""}` : "no time" },
    { label: "a bare hour 1–12 needs am/pm", map: "am/pm given", line: 16, applies: !!clock && !invalidTime, fired: ambiguous, detail: clock ? `form ${clock.form}` : "no time" },
    { label: "a recurring request names a weekday", short: "weekday named", map: "weekday named", line: 20, applies: e.recurring, fired: e.recurring && !dayM, detail: dayM ? `“${dayM[0]}”` : "no weekday" },
    { label: "a recurring request says for how many weeks", short: "number of weeks given", map: "weeks given", line: 21, applies: e.recurring, fired: e.recurring && !occ, detail: `occurrences = ${occ ?? "null"}` },
    { label: "1 to 12 weeks", short: "1 ≤ weeks ≤ 12", map: "1 ≤ weeks ≤ 12", line: 22, applies: e.recurring && !!occ, fired: e.recurring && !!occ && (occ < 1 || occ > 12), detail: `occurrences = ${occ ?? "null"}` },
    { label: "recurrence only for new reminders", short: "intent is create", map: "create only", line: 23, applies: e.recurring, fired: e.recurring && e.intent !== "create", detail: `intent = ${e.intent}` },
    { label: "the command is known", map: "known command", line: 28, applies: true, fired: e.intent === "unknown", detail: `intent = ${e.intent}` },
  ];
  let k = 0;
  for (const c of checks) c.message = c.fired ? (e.issues[k++] ?? null) : null;
  // Title operations in the order strip() runs them; only changes are recorded.
  const dateExpressions = st.date
    .filter((d) => d.rule === "explicit" || d.result !== null)
    .map((d) => d.matched);
  const ops = [
    "remove the command words",
    ...dateExpressions.map((x) => `remove the date “${x}”`),
    ...(clock ? [`remove the time “${clock.matched}”`] : []),
    "remove “for N weeks”",
    "remove “reminder” and “my”",
    "remove symbols",
    "collapse spaces and trim a dangling to/on/at",
  ].map((label) => ({ label, step: st.title.findIndex((t) => t.label === label) }));
  const out = {
    e, st, input, command, please, firstWord, chain, refs, clocks, dayM, explicitM, countM, everyM,
    clock, invalidTime, ambiguous, checks, ops,
  };
  cache.set(trace, out);
  return out;
}

const quotes = (x) => x.replace(/"([^"]*)"/g, "“$1”");
const piece = (x) => (/^\s+$/.test(x) ? plural(x.length, "space") : `“${x}”`);
const matchSpan = (m, cls = "hit") => (m ? { start: m.index, end: m.index + m[0].length, cls } : null);

function explicitCandidate(m) {
  if (!m) return null;
  const year = m[3] ? +m[3] : +DEMO_TODAY.slice(0, 4);
  const month = MONTHS.indexOf(m[1]) + 1;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T12:00:00Z`);
  return { iso, back: Number.isFinite(+parsed) ? parsed.toISOString().slice(0, 10) : "Invalid Date" };
}

const mod = {
  id: "parse",
  source: [
    ["pipeline", "INTENT_RULES"],
    ["pipeline", "extract"],
  ],
  code: [
    "const input = normalize(text)",
    'const command = input.replace(/^please\\s+/, "")',
    'const rule = INTENT_RULES.find(r => new RegExp(`^(${r.verbs.join("|")})\\\\b`).test(command))',
    'const intent = rule?.intent ?? "unknown"',
    "if (/\\b(and|then|or)\\s+(remind|move|…|find)\\b/.test(input)) issues.push(…)",
    "if (dateReferences(input).length > 1) issues.push(…)   // today, tomorrow, weekday, month day",
    "if (/\\btomorrow\\b/.test(input)) date = addDays(TODAY, 1)",
    "else if (/\\btoday\\b/.test(input)) date = TODAY",
    "const explicit = input.match(/\\b(month)\\s+(\\d{1,2})(st|nd|rd|th)?(,?\\s+(20\\d\\d))?\\b/)",
    "if (explicit) { date = `${year}-${mm}-${dd}`; if (not a real day) { issues.push(…); date = null } }",
    "const day = input.match(/\\b(?:(next|every)\\s+)?(sunday|…|saturday)\\b/)",
    "if (day && !date) date = addDays(TODAY, ((target − todayDay + 7) % 7) || 7)",
    "const clocks = [...input.matchAll(/h:mm (am|pm)? | h (am|pm) | at h/g)]",
    "if (clocks.length > 1) issues.push(…)",
    "let hour = +h, minute = +(mm ?? 0), meridiem = am | pm | undefined",
    "if (minute > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23)) issues.push(…)",
    "else if (!meridiem && bareHour && hour >= 1 && hour <= 12) issues.push(…)",
    'else { if (meridiem) hour = (hour % 12) + (meridiem === "pm" ? 12 : 0); time = pad(hour) + ":" + pad(minute) }',
    "const recurring = /\\bevery\\b/.test(input)",
    "const occurrences = count ? Number(count[1]) : null   // count = /\\bfor\\s+(\\d+)\\s+weeks?\\b/",
    "if (recurring && !day) issues.push(…)",
    "if (recurring && !occurrences) issues.push(…)",
    "if (recurring && occurrences && (occurrences < 1 || occurrences > 12)) issues.push(…)",
    'if (recurring && intent !== "create") issues.push(…)',
    "let title = input",
    "for (const part of [commandWords, ...dates, time, forNWeeks, /reminders?|my/, symbols])",
    '  title = title.replace(part, "")',
    'title = title.replace(/\\s+/g, " ").trim().replace(/\\b(to|on|at)\\s*$/g, "").trim()',
    'if (intent === "unknown") issues.push(…)',
    "return { intent, title, date, time, recurring, occurrences, keywords: terms(title), issues }",
  ],
  frames({ trace }) {
    const s = study(trace);
    const { e, st, input, command } = s;
    const frames = [];
    const slots = {};
    const push = (f) => frames.push({ slots: { ...slots }, hl: [], ...f });

    push({
      phase: "Command",
      line: 0,
      panel: "input",
      say: input
        ? `Extraction runs on the normalized copy, input = “${input}” (${plural(input.length, "code unit")}). Every pattern below is matched against this string.`
        : "The normalized input is empty, so no pattern below can match anything.",
      vars: { input },
    });
    push({
      phase: "Command",
      line: 1,
      panel: "command",
      ruleAt: -1,
      say: s.please
        ? `The input starts with “please ”, which is removed: command = “${command}”.`
        : `The input does not start with “please ”, so command = input.`,
      vars: { command },
      hl: s.please ? [{ start: 0, end: s.please, cls: "removed" }] : [],
    });
    const tried = st.intent.tried;
    tried.forEach((r, i) => {
      const verbSpan = r.matched ? [{ start: s.please, end: s.please + st.intent.verb.length, cls: "hit" }] : [];
      if (r.matched) slots.intent = r.intent;
      push({
        phase: "Command",
        line: r.matched ? [2, 3] : 2,
        panel: "command",
        ruleAt: i,
        say: r.matched
          ? `Rule ${i + 1} (${r.intent}): /^(${r.verbs.join("|")})\\b/ matches “${st.intent.verb}” at the start of the command, so intent = “${r.intent}”.`
          : `Rule ${i + 1} (${r.intent}): /^(${r.verbs.join("|")})\\b/ does not match${s.firstWord ? ` the first word “${s.firstWord}”` : " an empty command"}.`,
        vars: { rule: i + 1, verbs: r.verbs.join(" | "), "first word": s.firstWord, matched: r.matched, ...(r.matched ? { intent: r.intent } : {}) },
        hl: verbSpan,
        hold: r.matched ? 1.1 : 0.8,
      });
    });
    if (e.intent === "unknown") {
      slots.intent = "unknown";
      push({
        phase: "Command",
        line: 3,
        panel: "command",
        ruleAt: tried.length,
        say: `None of the ${INTENT_RULES.length} rules matched, so intent = “unknown”. An issue asking for a known command is added at the end of extract.`,
        vars: { intent: "unknown" },
      });
    }
    push({
      phase: "Command",
      line: 4,
      panel: "command",
      ruleAt: tried.length,
      say: s.chain
        ? `Chained commands: “${s.chain[0]}” is “and / then / or” followed by a command verb, so an issue is added: one action per request.`
        : "Chained commands: the text has no “and / then / or” followed by a command verb, so no issue.",
      vars: { chained: !!s.chain },
      hl: s.chain ? [matchSpan(s.chain, "removed")] : [],
      hold: 0.9,
    });

    // Date
    const refList = s.refs.map((m) => `“${m[0]}”`).join(", ");
    push({
      phase: "Date",
      line: 5,
      panel: "date",
      dateAt: -1,
      say: s.refs.length > 1
        ? `The date-reference pattern finds ${s.refs.length} references (${refList}). More than one, so an issue is added: use one target date.`
        : s.refs.length
          ? `The date-reference pattern finds one reference (${refList}), so there is no conflict.`
          : "The date-reference pattern (today, tomorrow, a weekday, or a month and day) finds nothing.",
      vars: { "date references": s.refs.map((m) => m[0]), count: s.refs.length },
      hl: s.refs.map((m) => matchSpan(m)),
    });
    let date = null;
    DATE_RULES.forEach((r, i) => {
      const d = st.date.find((x) => x.rule === r.rule);
      let say;
      let hl = [];
      if (r.rule === "relative") {
        if (d) {
          date = d.result;
          say = `“${d.matched}” is relative to the fixed reference day: ${d.calc} = ${d.result}. date = ${d.result}.`;
          hl = [{ ...spanOf(input, d.matched), cls: "hit" }];
        } else say = "Neither “tomorrow” nor “today” appears, so this rule sets nothing.";
      } else if (r.rule === "explicit") {
        if (d) {
          const c = explicitCandidate(s.explicitM);
          hl = [matchSpan(s.explicitM)];
          if (d.result) {
            say = `“${d.matched}”: ${quotes(d.calc)} → ${d.result}. new Date("${d.result}") gives back the same day, so it exists.${date && date !== d.result ? ` This replaces the earlier ${date}.` : ""} date = ${d.result}.`;
            date = d.result;
          } else {
            say = `“${d.matched}”: ${quotes(d.calc)} → ${c?.iso}. new Date gives back ${c?.back}, not the same day, so that date does not exist: an issue is added and date = null.`;
            date = null;
          }
        } else say = "No month name followed by a day number, so this rule sets nothing.";
      } else if (d && d.result) {
        date = d.result;
        say = `“${d.matched}”: ${s.dayM?.[2]} is day ${DAYS.indexOf(s.dayM?.[2])} and ${DEMO_TODAY} is a Monday, day 1 (Sunday is 0). ${d.calc} = ${d.result}.`;
        hl = [{ ...spanOf(input, d.matched), cls: "hit" }];
      } else if (d) {
        say = `“${d.matched}” names a weekday, but a date was already found, so it is skipped. date stays ${date}.`;
        hl = [{ ...spanOf(input, d.matched), cls: "removed" }];
      } else say = `No weekday name. date = ${date ?? "null"}.`;
      if (i === DATE_RULES.length - 1) slots.date = date;
      push({
        phase: "Date",
        line: r.line,
        panel: "date",
        dateAt: i,
        say,
        vars: { rule: r.rule, matched: d?.matched ?? null, date },
        hl: hl.filter((x) => x && x.start !== undefined),
        hold: d ? 1.1 : 0.8,
      });
    });

    // Time
    const clockList = s.clocks.map((m) => `“${m[0]}”`).join(", ");
    const clockSpans = s.clocks.map((m, i) => matchSpan(m, i === 0 ? "hit" : "removed"));
    const c = s.clock;
    if (!c) slots.time = null;
    push({
      phase: "Time",
      line: [12, 13],
      panel: "time",
      timeAt: 0,
      say: !c
        ? "The clock pattern has three alternatives (h:mm with optional am/pm, h followed by am/pm, “at h”). None matches, so time = null."
        : s.clocks.length > 1
          ? `The clock pattern matches ${s.clocks.length} times (${clockList}). More than one, so an issue is added; the first match is still read.`
          : `The clock pattern (h:mm with optional am/pm, h followed by am/pm, or “at h”) matches once: ${clockList}.`,
      vars: { "clock matches": s.clocks.map((m) => m[0]), count: s.clocks.length },
      hl: clockSpans,
    });
    if (c) {
      push({
        phase: "Time",
        line: 14,
        panel: "time",
        timeAt: 1,
        say: `“${c.matched}” uses the ${c.form} form: hour = ${c.hour}, minute = ${c.minute}${c.form === "h:mm" ? "" : " (no minutes written)"}, meridiem = ${c.meridiem ? `“${c.meridiem}”` : "none"}.`,
        vars: { matched: c.matched, form: c.form, hour: c.hour, minute: c.minute, meridiem: c.meridiem },
        hl: clockSpans.slice(0, 1),
      });
      const range = c.meridiem ? "1–12 (with am/pm)" : "0–23 (no am/pm)";
      push({
        phase: "Time",
        line: s.invalidTime ? 15 : [15, 16],
        panel: "time",
        timeAt: 2,
        say: s.invalidTime
          ? `Validation: minute ${c.minute} ${c.minute > 59 ? "> 59" : "≤ 59"}, hour ${c.hour} must be in ${range}. It fails, so an issue is added and time stays null.`
          : s.ambiguous
            ? `Validation: hour ${c.hour} is in range, but “${c.matched}” is a bare hour from 1 to 12 with no am/pm, so it could be morning or evening. An issue asks which one; time stays null.`
            : `Validation: minute ${c.minute} ≤ 59 and hour ${c.hour} is in ${range}. Valid.`,
        vars: { "minute ≤ 59": c.minute <= 59, "hour range": range, valid: !s.invalidTime && !s.ambiguous },
        hl: clockSpans.slice(0, 1),
      });
      if (!s.invalidTime && !s.ambiguous) {
        slots.time = e.time;
        push({
          phase: "Time",
          line: 17,
          panel: "time",
          timeAt: 3,
          say: c.meridiem
            ? `12-hour → 24-hour: ${c.calc}. Both parts are padded to two digits: time = “${e.time}”.`
            : `No am/pm, so hour ${c.hour} is already 24-hour. Padded to two digits: time = “${e.time}”.`,
          vars: { hour: Number(e.time?.slice(0, 2)), minute: c.minute, time: e.time },
          hl: clockSpans.slice(0, 1),
        });
      } else slots.time = null;
    }

    // Recurrence
    slots.recurring = e.recurring;
    push({
      phase: "Recurrence",
      line: 18,
      panel: "recurrence",
      recAt: 0,
      say: e.recurring
        ? "/\\bevery\\b/ finds “every”, so recurring = true."
        : "/\\bevery\\b/ finds no “every”, so recurring = false.",
      vars: { recurring: e.recurring },
      hl: s.everyM ? [matchSpan(s.everyM)] : [],
      hold: 0.8,
    });
    slots.occurrences = e.occurrences;
    push({
      phase: "Recurrence",
      line: 19,
      panel: "recurrence",
      recAt: 1,
      say: s.countM
        ? `/\\bfor\\s+(\\d+)\\s+weeks?\\b/ matches “${s.countM[0]}”, so occurrences = ${e.occurrences}.`
        : "/\\bfor\\s+(\\d+)\\s+weeks?\\b/ finds nothing, so occurrences = null.",
      vars: { occurrences: e.occurrences },
      hl: s.countM ? [matchSpan(s.countM)] : [],
      hold: 0.8,
    });
    const recChecks = s.checks.slice(6, 10);
    push({
      phase: "Recurrence",
      line: e.recurring ? [20, 21, 22, 23] : 20,
      panel: "recurrence",
      recAt: 2,
      say: e.recurring
        ? `recurring is true, so four checks run: ${recChecks
            .map((x) => `${x.short} (${x.detail}) ${!x.applies ? "not checked" : x.fired ? "fails, issue added" : "ok"}`)
            .join("; ")}.`
        : "recurring is false, so the four recurrence checks (weekday, for N weeks, 1 to 12, create only) are skipped.",
      vars: { recurring: e.recurring, occurrences: e.occurrences, "weekday found": !!s.dayM },
      hl: [s.dayM && matchSpan(s.dayM), s.countM && matchSpan(s.countM)].filter(Boolean),
    });

    // Issues
    slots.issues = e.issues.length;
    const fired = s.checks.filter((x) => x.fired);
    push({
      phase: "Issues",
      line: fired.length ? fired.map((x) => x.line) : 29,
      panel: "issues",
      say: e.issues.length === 1
        ? `1 issue: “${e.issues[0]}” Decide will ask this question.`
        : e.issues.length
        ? `${e.issues.length} issues, in the order they were added. Decide asks only the first: “${e.issues[0]}”`
        : `No problems found: all ${s.checks.length} checks passed or did not apply, so issues = [].`,
      vars: { "issues.length": e.issues.length, ...(e.issues.length ? { "issues[0]": e.issues[0] } : {}) },
    });

    // Title
    push({
      phase: "Title",
      line: 24,
      panel: "title",
      titleAt: -1,
      say: `Start with title = input and remove the parts that were already understood, in a fixed order. ${st.title.length} of the ${s.ops.length} operations ${st.title.length === 1 ? "changes" : "change"} something here.`,
      vars: { title: input },
    });
    st.title.forEach((t, i) => {
      const removed = diff(t.before, t.after)
        .map((h) => piece(h.from))
        .join(", ");
      const last = t.label.startsWith("collapse");
      const named = /“/.test(t.label);
      let say = `${t.label[0].toUpperCase()}${t.label.slice(1)}${named ? "" : `: ${removed} removed`}. title = “${t.after}”.`;
      if (last) {
        const tidy = t.before.replace(/\s+/g, " ").trim();
        const end = tidy.replace(/\b(to|on|at)\s*$/g, "").trim();
        say =
          tidy === end
            ? `Collapse spaces and trim: “${t.before}” → “${t.after}”.`
            : `Collapse spaces and trim: “${t.before}” → “${tidy}”, then the dangling “${tidy.slice(end.length).trim()}” at the end is dropped: “${t.after}”.`;
      }
      push({
        phase: "Title",
        line: last ? 27 : [25, 26],
        panel: "title",
        titleAt: i,
        say,
        vars: { before: t.before, after: t.after },
        hold: 1,
      });
    });
    slots.title = e.title;
    slots.keywords = e.keywords;
    push({
      phase: "Done",
      line: [28, 29],
      panel: "done",
      titleAt: st.title.length,
      say: `Result: intent = ${e.intent}, date = ${e.date ?? "null"}, time = ${e.time ?? "null"}, recurring = ${e.recurring}, title = “${e.title}”, ${plural(e.issues.length, "issue")}. keywords = terms(title) is the next step.`,
      vars: {
        intent: e.intent,
        date: e.date,
        time: e.time,
        recurring: e.recurring,
        occurrences: e.occurrences,
        title: e.title,
        "issues.length": e.issues.length,
      },
    });
    return frames;
  },
  Stage({ ctx, frame, frames, at }) {
    const s = study(ctx.trace);
    const { input } = s;
    const titleView = frame.panel === "title" || frame.panel === "done";
    return (
      <div className="x-stack">
        {!titleView && (
          <Panel title="input (normalized)" note="Highlighted: what the current pattern matched. Struck out: text that is set aside.">
            {input ? <Chars text={input} spans={frame.hl ?? []} /> : <p className="p-empty">(empty)</p>}
          </Panel>
        )}
        {frame.panel === "command" && <CommandPanel s={s} frame={frame} />}
        {frame.panel === "date" && <DatePanel s={s} frame={frame} />}
        {frame.panel === "time" && <TimePanel s={s} frame={frame} />}
        {frame.panel === "recurrence" && <RecurrencePanel s={s} frame={frame} />}
        {frame.panel === "done" && <SlotsPanel slots={frame.slots ?? {}} previous={frames[at - 1]?.slots ?? {}} />}
        {frame.panel === "issues" && <IssuesPanel s={s} />}
        {titleView && <TitlePanel s={s} frame={frame} />}
        {frame.panel === "done" && <IssuesPanel s={s} />}
        {frame.panel !== "done" && <SlotsPanel slots={frame.slots ?? {}} previous={frames[at - 1]?.slots ?? {}} />}
      </div>
    );
  },
};

function CommandPanel({ s, frame }) {
  const tried = s.st.intent.tried;
  return (
    <Panel title="INTENT_RULES, tried in order" note={`Each pattern is anchored at the start (^) and must end at a word boundary (\\b). First word of the command: “${s.firstWord}”.`}>
      <Table className="p-table"
        head={["#", "intent", "verbs", "result"]}
        active={frame.ruleAt >= 0 && frame.ruleAt < tried.length ? frame.ruleAt : undefined}
        rows={INTENT_RULES.map((r, i) => {
          const t = tried[i];
          const status =
            i > frame.ruleAt || !t ? (
              <Tag key="r" kind="skip">{t ? "…" : "not tried"}</Tag>
            ) : t.matched ? (
              <Tag key="r" kind="pass">matches “{s.st.intent.verb}”</Tag>
            ) : (
              <Tag key="r" kind="fail">no match</Tag>
            );
          return {
            cls: t?.matched && i <= frame.ruleAt ? "p-hit" : !t ? "p-skipped" : "",
            cells: [i + 1, <strong key="i">{r.intent}</strong>, <code key="v">{r.verbs.join(" | ")}</code>, status],
          };
        })}
      />
    </Panel>
  );
}

function DatePanel({ s, frame }) {
  return (
    <Panel title="Date rules, in order" note={`Reference day: ${DEMO_TODAY} (Monday). Later rules can override earlier ones; the weekday rule only runs when no date was found yet.`}>
      <div className="p-chips" style={{ marginBottom: 10 }}>
        <span className="p-dim">date references:</span>
        {s.refs.length ? (
          s.refs.map((m, i) => (
            <span key={i} className={`p-chip ${s.refs.length > 1 ? "is-dropped" : "is-hit"}`}>
              {m[0]}
            </span>
          ))
        ) : (
          <span className="p-dim">none</span>
        )}
        {s.refs.length > 1 && <Tag kind="fail">more than one</Tag>}
      </div>
      <Table className="p-table"
        head={["rule", "pattern", "matched", "calculation", "result"]}
        active={frame.dateAt >= 0 ? frame.dateAt : undefined}
        rows={DATE_RULES.map((r, i) => {
          if (i > frame.dateAt) return { cls: "is-pending", cells: [r.rule, <code key="p">{r.pattern}</code>, "", "", ""] };
          const d = s.st.date.find((x) => x.rule === r.rule);
          return [
            r.rule,
            <code key="p">{r.pattern}</code>,
            d ? <code key="m">{d.matched}</code> : <Tag key="m" kind="skip">no match</Tag>,
            d ? quotes(d.calc) : "",
            d ? d.result ? <code key="r">{d.result}</code> : <Tag key="r" kind="fail">null</Tag> : "",
          ];
        })}
      />
    </Panel>
  );
}

function TimePanel({ s, frame }) {
  const c = s.clock;
  const step = frame.timeAt;
  const range = c?.meridiem ? "1 ≤ hour ≤ 12" : "0 ≤ hour ≤ 23";
  return (
    <Panel title="Clock time" note="Three alternatives, tried left to right at each position: h:mm with optional am/pm · h followed by am/pm · “at” and a bare hour.">
      <div className="p-chips" style={{ marginBottom: 10 }}>
        <span className="p-dim">matches:</span>
        {s.clocks.length ? (
          s.clocks.map((m, i) => (
            <span key={i} className={`p-chip ${i === 0 ? "is-hit" : "is-dropped"}`}>
              {m[0]}
            </span>
          ))
        ) : (
          <span className="p-dim">none</span>
        )}
        {s.clocks.length > 1 && <Tag kind="fail">more than one</Tag>}
      </div>
      {c && step >= 1 && (
        <dl className="p-kv">
          <dt>matched</dt>
          <dd>“{c.matched}”</dd>
          <dt>form</dt>
          <dd>{c.form}</dd>
          <dt>hour</dt>
          <dd>{c.hour}</dd>
          <dt>minute</dt>
          <dd>{c.minute}</dd>
          <dt>meridiem</dt>
          <dd>{c.meridiem ?? "none"}</dd>
          {step >= 2 && (
            <>
              <dt>minute ≤ 59</dt>
              <dd>{c.minute <= 59 ? <Tag kind="pass">{c.minute} ≤ 59</Tag> : <Tag kind="fail">{c.minute} &gt; 59</Tag>}</dd>
              <dt>{range}</dt>
              <dd>
                {(c.meridiem ? c.hour >= 1 && c.hour <= 12 : c.hour <= 23) ? (
                  <Tag kind="pass">hour {c.hour} ok</Tag>
                ) : (
                  <Tag kind="fail">hour {c.hour} out of range</Tag>
                )}
              </dd>
              <dt>am/pm needed</dt>
              <dd>
                {s.ambiguous ? (
                  <Tag kind="fail">bare hour {c.hour} is ambiguous</Tag>
                ) : (
                  <Tag kind={s.invalidTime ? "skip" : "pass"}>{s.invalidTime ? "not checked" : "no"}</Tag>
                )}
              </dd>
            </>
          )}
        </dl>
      )}
      {c && step >= 3 && (
        <div style={{ marginTop: 10 }}>
          {c.meridiem ? (
            <Expr
              label="24-hour"
              terms={[`(${c.hour} mod 12)`, c.meridiem === "pm" ? "12" : "0"]}
              result={(c.hour % 12) + (c.meridiem === "pm" ? 12 : 0)}
            />
          ) : (
            <Expr label="24-hour" terms={[`${c.hour}`]} result={c.hour} />
          )}
          <Expr label="time" terms={[`pad(${Number(c.result?.slice(0, 2))})`, `pad(${c.minute})`]} op=":" result={`“${c.result}”`} />
        </div>
      )}
    </Panel>
  );
}

function RecurrencePanel({ s, frame }) {
  const { e } = s;
  const rows = s.checks.slice(6, 10);
  return (
    <Panel title="Recurrence">
      <dl className="p-kv" style={{ marginBottom: 10 }}>
        <dt>recurring</dt>
        <dd className={frame.recAt >= 0 ? "" : "is-pending"}>{String(e.recurring)}</dd>
        <dt>occurrences</dt>
        <dd className={frame.recAt >= 1 ? "" : "is-pending"}>{frame.recAt >= 1 ? String(e.occurrences ?? "null") : "…"}</dd>
      </dl>
      <Table className="p-table"
        head={["check", "values", "result"]}
        rows={rows.map((x) =>
          frame.recAt < 2
            ? { cls: "is-pending", cells: [x.label, "", ""] }
            : {
                cls: x.applies ? "" : "p-skipped",
                cells: [
                  x.label,
                  <code key="d">{x.detail}</code>,
                  !x.applies ? (
                    <Tag key="r" kind="skip">not checked</Tag>
                  ) : x.fired ? (
                    <Tag key="r" kind="fail">issue</Tag>
                  ) : (
                    <Tag key="r" kind="pass">ok</Tag>
                  ),
                ],
              },
        )}
      />
    </Panel>
  );
}

function IssuesPanel({ s }) {
  return (
    <Panel
      title={s.e.issues.length ? `issues (${s.e.issues.length})` : "issues: none"}
      note="Every check extract() makes, in code order. A failed check appends its message to issues."
    >
      <Table className="p-table"
        head={["#", "check", "values", "result", "message"]}
        rows={s.checks.map((x, i) => ({
          cls: x.fired ? "is-active" : x.applies ? "" : "p-skipped",
          cells: [
            i + 1,
            x.label,
            <code key="d">{x.detail}</code>,
            !x.applies ? (
              <Tag key="r" kind="skip">n/a</Tag>
            ) : x.fired ? (
              <Tag key="r" kind="fail">issue</Tag>
            ) : (
              <Tag key="r" kind="pass">ok</Tag>
            ),
            x.message ?? "",
          ],
        }))}
      />
    </Panel>
  );
}

function TitlePanel({ s, frame }) {
  const steps = s.st.title;
  const t = frame.titleAt >= 0 && frame.titleAt < steps.length ? steps[frame.titleAt] : null;
  const before = t ? t.before : frame.titleAt < 0 ? s.input : s.e.title;
  return (
    <>
      <Panel title={t ? "title before → after" : frame.titleAt < 0 ? "title = input" : "title"}>
        <div className="p-change">
          <div>
            <span>{t ? "before" : "value"}</span>
            {before ? <Chars text={before} spans={t ? hunkSpans(diff(t.before, t.after), "before") : []} /> : <p className="p-empty">(empty)</p>}
          </div>
          {t && (
            <div>
              <span>after</span>
              {t.after ? <Chars text={t.after} /> : <p className="p-empty">(empty)</p>}
            </div>
          )}
        </div>
      </Panel>
      <Panel title="Title operations, in order" note="strip() records an operation only when it changed the string.">
        <Table className="p-table"
          head={["#", "operation", "result"]}
          rows={s.ops.map((op, i) => {
            const done = op.step >= 0 ? op.step <= frame.titleAt : frame.titleAt >= steps.length;
            const current = op.step >= 0 && op.step === frame.titleAt;
            return {
              cls: current ? "is-active" : op.step < 0 ? "p-skipped" : "",
              cells: [
                i + 1,
                op.label,
                op.step >= 0 ? (
                  done ? (
                    <code key="r">“{showWs(steps[op.step].after)}”</code>
                  ) : (
                    "…"
                  )
                ) : (
                  <Tag key="r" kind="skip">no change</Tag>
                ),
              ],
            };
          })}
        />
      </Panel>
    </>
  );
}

function SlotsPanel({ slots, previous }) {
  const text = (k, v) =>
    v === undefined ? "…" : k === "keywords" ? `[${v.join(", ")}]` : typeof v === "string" ? `“${v}”` : String(v ?? "null");
  return (
    <Panel title="Slots" note="Filled in as each rule runs. “…” means not reached yet.">
      <dl className="p-kv">
        {SLOT_KEYS.map((k) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k === "issues" ? "issues.length" : k}</dt>
            <dd className={!(k in slots) ? "is-pending" : !(k in previous) || previous[k] !== slots[k] ? "is-new" : ""}>
              {text(k, slots[k])}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

// ---- Map layer ----

const SHORT_OP = (label) =>
  label
    .replace("remove the command words", "command words")
    .replace(/^remove the date /, "date ")
    .replace(/^remove the time /, "time ")
    .replace("remove “for N weeks”", "for N weeks")
    .replace("remove “reminder” and “my”", "“reminder”, “my”")
    .replace("remove symbols", "symbols")
    .replace("collapse spaces and trim a dangling to/on/at", "spaces, dangling to/on/at");
const SLOT = (key) => [[slotRow(key), 1], [slotRow(key), 2]];
const lastWords = (x) => x.replace(/^at\s+/, "");
// Checks are laid out in two column pairs of six rows.
const CK = (k) => [k % 6, k < 6 ? 1 : 3];

function cellsOf(frame, { trace }) {
  const s = study(trace);
  const { st } = s;
  const T = (text) => tokenCells(trace, text);
  const allTokens = trace.tokens.map((_, i) => [i, 1]);
  const tried = st.intent.tried;
  switch (frame.panel) {
    case "input":
      return { tokens: { source: allTokens } };
    case "command": {
      if (frame.ruleAt === -1) return { tokens: { source: s.please ? T("please") : trace.tokens.length ? [[0, 1]] : [] } };
      if (frame.line === 4)
        return { tokens: { source: s.chain ? T(s.chain[0]) : [] }, checks: { active: [CK(0)] } };
      if (frame.ruleAt >= tried.length)
        return { intents: { source: INTENT_RULES.map((_, i) => [i, 2]) }, slots: { active: SLOT("intent") } };
      // A match writes the slot; a miss writes the rule's result cell.
      const r = tried[frame.ruleAt];
      return r.matched
        ? { tokens: { source: T(s.firstWord) }, intents: { source: row(frame.ruleAt, 3) }, slots: { active: SLOT("intent") } }
        : { tokens: { source: T(s.firstWord) }, intents: { source: [[frame.ruleAt, 1]], active: [[frame.ruleAt, 2]] } };
    }
    case "date": {
      if (frame.dateAt === -1) return { tokens: { source: s.refs.flatMap((m) => T(m[0])) }, checks: { active: [CK(1)] } };
      const rule = ["relative", "explicit", "weekday"][frame.dateAt];
      const d = st.date.find((x) => x.rule === rule);
      // An impossible calendar date fails a check; otherwise the rule writes the date slot.
      if (rule === "explicit" && d && !d.result) return { tokens: { source: T(d.matched) }, checks: { active: [CK(2)] } };
      const writes = rule === "weekday" || (d && d.result);
      return {
        tokens: { source: d ? T(d.matched) : [] },
        ...(writes ? { slots: { active: SLOT("date") } } : {}),
      };
    }
    case "time": {
      const c = s.clock;
      const src = c ? T(c.matched) : [];
      if (frame.timeAt === 0)
        return {
          tokens: { source: s.clocks.flatMap((m) => T(m[0])) },
          checks: { active: [CK(3)] },
          ...(!c ? { slots: { active: SLOT("time") } } : {}),
        };
      if (frame.timeAt === 1) return { tokens: { source: src } };
      if (frame.timeAt === 2) return { tokens: { source: src }, checks: { active: [CK(4), CK(5)] } };
      return { tokens: { source: src }, slots: { active: SLOT("time") } };
    }
    case "recurrence":
      if (frame.recAt === 0) return { tokens: { source: s.everyM ? T("every") : [] }, slots: { active: SLOT("recurring") } };
      if (frame.recAt === 1) return { tokens: { source: s.countM ? T(s.countM[0]) : [] }, slots: { active: SLOT("weeks") } };
      return {
        slots: { source: [[slotRow("recurring"), 1], [slotRow("weeks"), 1]] },
        checks: { active: [6, 7, 8, 9].map(CK) },
      };
    case "issues": {
      const fired = s.checks.map((x, i) => (x.fired ? i : -1)).filter((i) => i >= 0);
      return {
        checks: { source: (fired.length ? fired : s.checks.map((_, i) => i)).map(CK) },
        slots: { active: SLOT("issues") },
      };
    }
    case "title": {
      const i = frame.titleAt;
      if (i < 0) return { tokens: { source: allTokens } };
      const t = st.title[i];
      const removed = diff(t.before, t.after)
        .map((h) => h.from.trim())
        .filter(Boolean)
        .flatMap((x) => T(x));
      return {
        tokens: { source: removed },
        titleops: { active: row(i, 2), source: i > 0 ? [[i - 1, 1]] : [] },
      };
    }
    default: {
      const n = Math.max(1, st.title.length);
      return { titleops: { source: [[n - 1, 1]] }, slots: { active: SLOT("title") } };
    }
  }
}

const tone = (v) => (v === null || v === undefined ? "muted" : undefined);

// ---- Explain a cell ----

function explainIntent(s, r, c) {
  const rule = INTENT_RULES[r];
  if (!rule) return null;
  const tried = s.st.intent.tried[r];
  const test = `/^(${rule.verbs.join("|")})\\b/`;
  if (c === 0) return { meaning: `Rule ${r + 1}: a request that starts with one of these verbs is a${rule.intent === "update" ? "n" : ""} ${rule.intent}.` };
  if (c === 1) return { meaning: `The verbs that mean ${rule.intent}. Only the first word of the request is compared.`, formula: test };
  if (c !== 2) return null;
  if (!tried) return { meaning: "Not tried: an earlier rule already matched, and the first match wins." };
  return {
    meaning: tried.matched ? `The first word is one of these verbs, so intent = ${rule.intent}.` : "The first word is not one of these verbs; the next rule is tried.",
    formula: `${test}.test(command)`,
    worked: `${test}.test(“${s.firstWord}”) = ${tried.matched}`,
  };
}

function explainSlot(s, key, c) {
  const { e, st } = s;
  if (!key) return null;
  const meaning = {
    intent: "What the request wants to do: create, update, delete or search.",
    date: "The day the reminder is for, as YYYY-MM-DD. Today is fixed at " + DEMO_TODAY + ".",
    time: "The clock time, as 24-hour HH:MM.",
    recurring: "Whether the reminder repeats every week.",
    weeks: "How many weeks a repeating reminder runs.",
    title: "What the reminder is about: the request minus every part the rules understood.",
    issues: "Problems found while reading the request. The first one becomes the planner's question.",
  }[key];
  if (c === 0) return { meaning };
  if (c !== 1 && c !== 2) return null;
  const d = st.date.filter((x) => x.result || x.rule === "explicit").at(-1);
  const clock = s.clock;
  const rule = {
    intent: ["intent = the first INTENT_RULES row whose verbs match the first word", st.intent.verb ? `“${st.intent.verb}” → ${e.intent}` : `no rule matched “${s.firstWord}” → unknown`],
    date: ["tomorrow | today | month day | (next|every) weekday", d ? `${d.rule} “${d.matched}”: ${d.calc} → ${d.result ?? "null"}` : "no date words → null"],
    time: [
      "h:mm (am|pm)? | h am/pm | at h; with am/pm, hour = (h mod 12) + (pm ? 12 : 0)",
      clock ? `“${clock.matched}”${clock.calc ? `: ${clock.calc}` : ""} → ${e.time ?? "null (invalid)"}` : "no clock words → null",
    ],
    recurring: ["recurring = /\\bevery\\b/.test(input)", `${s.everyM ? "“every” found" : "no “every”"} → ${e.recurring}`],
    weeks: ["occurrences = N from “for N weeks”", s.countM ? `“${s.countM[0]}” → ${e.occurrences}` : "no “for N weeks” → null"],
    title: ["title = input minus command words, dates, time, “for N weeks”, “reminder”, “my” and symbols", `${plural(st.title.length, "removal")} → “${e.title}”`],
    issues: ["one message per failed check", e.issues.length ? `${e.issues.length}: ${e.issues[0]}` : "every check passed → 0"],
  }[key];
  return { meaning, formula: rule[0], worked: rule[1] };
}

function explainTitleOp(s, r, c) {
  const t = s.st.title[r];
  if (!t) return c === 0 && r === 0 ? { meaning: "No rule removed anything, so the title is the whole normalized request." } : null;
  const removed = diff(t.before, t.after)
    .map((h) => `“${showWs(h.from)}”`)
    .join(", ");
  return {
    meaning: c === 0 ? `Step ${r + 1} of building the title: ${t.label}.` : `The title after step ${r + 1}.`,
    formula: "title = title.replace(part, \"\")",
    worked: `“${t.before}” − ${removed || "spaces"} → “${t.after}”`,
  };
}

function explainCheck(s, x, c) {
  if (!x) return null;
  if (c === 0) return { meaning: `A check on the request: ${x.label}.` };
  return {
    meaning: !x.applies
      ? "This check does not apply to this request."
      : x.fired
        ? `This check failed, so it adds an issue: ${x.message ?? "see the issues slot"}`
        : "This check passed.",
    formula: x.label,
    worked: `${x.detail} → ${!x.applies ? "n/a" : x.fired ? "issue" : "ok"}`,
  };
}

Object.assign(mod, {
  blocks({ trace }) {
    const s = study(trace);
    const { st, e } = s;
    const tried = st.intent.tried;
    const dateFrom = st.date.filter((d) => d.result || d.rule === "explicit").at(-1);
    const clock = s.clock;
    const slotRows = {
      intent: [
        { text: e.intent, tone: e.intent === "unknown" ? "warn" : "keyword", bold: true },
        st.intent.verb ? `“${st.intent.verb}”` : { text: "no rule matched", tone: "muted" },
      ],
      date: [
        { text: e.date ?? "null", tone: tone(e.date) },
        dateFrom ? `${dateFrom.rule} “${dateFrom.matched}”` : { text: "no date text", tone: "muted" },
      ],
      time: [
        { text: e.time ?? "null", tone: tone(e.time) },
        clock ? `“${lastWords(clock.matched)}”${e.time ? "" : " invalid"}` : { text: "no clock text", tone: "muted" },
      ],
      recurring: [String(e.recurring), s.everyM ? "“every”" : { text: "no “every”", tone: "muted" }],
      weeks: [{ text: String(e.occurrences ?? "null"), tone: tone(e.occurrences) }, s.countM ? `“${s.countM[0]}”` : { text: "—", tone: "muted" }],
      title: [{ text: e.title ? `“${e.title}”` : "“”", tone: e.title ? "keyword" : "warn", align: "left" }, `${st.title.length} removal${st.title.length === 1 ? "" : "s"}`],
      issues: [
        { text: String(e.issues.length), tone: e.issues.length ? "warn" : "good", bold: true },
        e.issues.length ? { text: e.issues[0], tone: "warn", align: "left" } : { text: "none", tone: "good" },
      ],
    };
    return [
      tableBlock({
        id: "intents",
        title: "INTENT_RULES · /^(verbs)\\b/ on the first word",
        head: ["intent", "verbs", "result"],
        widths: [1, 3.6, 1.2],
        rows: INTENT_RULES.map((r, i) => [
          { text: r.intent, tone: "keyword" },
          { text: r.verbs.join(" "), align: "left" },
          !tried[i]
            ? { text: "not tried", tone: "muted" }
            : tried[i].matched
              ? { text: "match", tone: "good", bold: true }
              : { text: "no", tone: "muted" },
        ]),
        explain: (r, c) => explainIntent(s, r, c),
      }),
      tableBlock({
        id: "slots",
        title: "slots",
        head: ["slot", "value", "from"],
        widths: [1.15, 2.5, 2.9],
        rows: Object.entries(slotRows).map(([k, v]) => [{ text: k, align: "left", dim: true }, ...v]),
        beside: true,
        explain: (r, c) => explainSlot(s, SLOT_ROWS[r], c),
      }),
      tableBlock({
        id: "titleops",
        title: "title = input minus the understood parts",
        head: ["removed", "title after"],
        widths: [2.25, 4.1],
        rows: st.title.length
          ? st.title.map((t) => [{ text: SHORT_OP(t.label), align: "left" }, { text: edgeWs(t.after) || "(empty)", align: "left" }])
          : [[{ text: "nothing to remove", tone: "muted" }, { text: edgeWs(e.title) || "(empty)", align: "left", tone: "muted" }]],
        explain: (r, c) => explainTitleOp(s, r, c),
      }),
      tableBlock({
        id: "checks",
        title: "checks → issues",
        head: ["check", "result", "check", "result"],
        widths: [2.15, 0.9, 2.15, 0.9],
        rows: Array.from({ length: 6 }, (_, r) =>
          [r, r + 6].flatMap((k) => {
            const x = s.checks[k];
            if (!x) return [null, null];
            return [
              { text: x.map, align: "left", dim: !x.applies },
              !x.applies ? { text: "n/a", tone: "muted" } : x.fired ? { text: "issue", tone: "warn", bold: true } : { text: "ok", tone: "good" },
            ];
          }),
        ),
        beside: true,
        explain: (r, c) => explainCheck(s, s.checks[c < 2 ? r : r + 6], c % 2),
      }),
    ];
  },
  output: "slots",
  state(frame, ctx) {
    const tried = study(ctx.trace).st.intent.tried.length;
    const reached = frame.panel === "command" && frame.ruleAt >= 0 ? frame.ruleAt : frame.panel === "input" || frame.ruleAt === -1 ? -1 : tried;
    return revealState(mod, frame, ctx, cellsOf, {
      intents: (r, c) => c < 2 || (r <= reached && r < tried),
      slots: (r, c) => c === 0,
      titleops: () => false,
      checks: (r, c) => c === 0 || c === 2,
    });
  },
  math(frame, { trace }) {
    const s = study(trace);
    const { st, e } = s;
    const tried = st.intent.tried;
    switch (frame.panel) {
      case "input":
        return [{ label: "input.length", terms: [String(s.input.length)] }];
      case "command": {
        if (frame.ruleAt === -1) return [{ label: "starts with “please ”", terms: [String(!!s.please)] }];
        if (frame.line === 4) return [{ label: "chained", terms: [s.chain ? `“${s.chain[0]}”` : "no match"], result: String(!!s.chain) }];
        if (frame.ruleAt >= tried.length) return [{ label: "intent", terms: ["no rule matched"], result: "unknown" }];
        const r = tried[frame.ruleAt];
        return [
          { label: `rule ${frame.ruleAt + 1}`, terms: [`/^(${r.verbs.join("|")})\\b/.test(“${s.firstWord}”)`], result: String(r.matched) },
          ...(r.matched ? [{ label: "intent", terms: [`“${r.intent}”`] }] : []),
        ];
      }
      case "date": {
        if (frame.dateAt === -1)
          return [{ label: "date references", terms: s.refs.length ? s.refs.map((m) => `“${m[0]}”`) : ["none"], op: ",", result: `${s.refs.length}${s.refs.length > 1 ? " > 1: issue" : ""}` }];
        const rule = ["relative", "explicit", "weekday"][frame.dateAt];
        const d = st.date.find((x) => x.rule === rule);
        if (!d) return [];
        if (rule === "relative") return [{ label: `“${d.matched}”`, terms: [DEMO_TODAY, d.matched === "today" ? "0 days" : "1 day"], result: d.result }];
        if (rule === "explicit") {
          const m = s.explicitM;
          const c = explicitCandidate(m);
          return [
            { label: "month", terms: [`“${m[1]}”`], result: MONTHS.indexOf(m[1]) + 1 },
            { label: "day", terms: [`“${m[2]}”`], result: +m[2] },
            { label: "year", terms: [m[3] ? `“${m[3]}”` : "reference year"], result: c.iso.slice(0, 4) },
            { label: "new Date", terms: [c.iso], result: c.back === c.iso ? `${c.back} (exists)` : `${c.back} (does not exist)` },
          ];
        }
        if (!d.result) return [{ label: "weekday", terms: [`“${d.matched}”`], result: "skipped, date already set" }];
        const target = DAYS.indexOf(s.dayM[2]);
        const delta = (target - 1 + 7) % 7 || 7;
        return [
          { label: "target day", terms: [`“${s.dayM[2]}”`], result: target },
          { label: "today", terms: [DEMO_TODAY], result: "1 (Monday)" },
          { label: "days ahead", terms: [`((${target} − 1 + 7) mod 7) || 7`], result: delta },
          { label: "date", terms: [DEMO_TODAY, `${delta} days`], result: d.result },
        ];
      }
      case "time": {
        const c = s.clock;
        if (frame.timeAt === 0)
          return [{ label: "clock matches", terms: s.clocks.length ? s.clocks.map((m) => `“${m[0]}”`) : ["none"], op: ",", result: String(s.clocks.length) }];
        if (!c) return [];
        if (frame.timeAt === 1)
          return [
            { label: "form", terms: [c.form] },
            { label: "hour", terms: [String(c.hour)] },
            { label: "minute", terms: [String(c.minute)] },
            { label: "meridiem", terms: [c.meridiem ?? "none"] },
          ];
        if (frame.timeAt === 2)
          return [
            { label: "minute ≤ 59", terms: [String(c.minute)], result: String(c.minute <= 59) },
            c.meridiem
              ? { label: "1 ≤ hour ≤ 12", terms: [String(c.hour)], result: String(c.hour >= 1 && c.hour <= 12) }
              : { label: "hour ≤ 23", terms: [String(c.hour)], result: String(c.hour <= 23) },
            { label: "bare hour 1–12", terms: [c.form], result: String(s.ambiguous) },
          ];
        const H = Number(e.time?.slice(0, 2));
        return [
          c.meridiem
            ? { label: "24-hour", terms: [`(${c.hour} mod 12)`, c.meridiem === "pm" ? "12" : "0"], result: H }
            : { label: "24-hour", terms: [String(c.hour)], result: H },
          { label: "time", terms: [`pad(${H})`, `pad(${c.minute})`], op: ":", result: `“${e.time}”` },
        ];
      }
      case "recurrence":
        if (frame.recAt === 0) return [{ label: "recurring", terms: ["/\\bevery\\b/"], result: String(e.recurring) }];
        if (frame.recAt === 1) return [{ label: "occurrences", terms: [s.countM ? `“${s.countM[0]}”` : "no match"], result: String(e.occurrences ?? "null") }];
        return s.checks.slice(6, 10).map((x) => ({ label: x.short, terms: [x.detail], result: !x.applies ? "skipped" : x.fired ? "issue" : "ok" }));
      case "issues":
        return [{ label: "issues.length", terms: [String(e.issues.length)] }];
      case "title": {
        const t = st.title[frame.titleAt];
        if (!t) return [{ label: "title", terms: [`“${s.input}”`] }];
        return [
          { label: "removed", terms: diff(t.before, t.after).map((h) => `“${showWs(h.from)}”`), op: ",", result: `“${t.after}”` },
        ];
      }
      default:
        return [
          { label: "title", terms: [`“${e.title}”`] },
          { label: "keywords", terms: [`terms(“${e.title}”)`], result: `[${e.keywords.join(", ")}]` },
        ];
    }
  },
});

const rawFrames = mod.frames;
mod.frames = (ctx) => indexed(rawFrames.call(mod, ctx));

export default mod;
