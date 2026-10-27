import { Panel, Table } from "../../kit.jsx";
import { MESSAGE_CHARS, QUERY_CHARS, serverContextOf } from "../../../engine/copilot.js";
import { all, charGrid, charsBlock, row, tableBlock } from "../../../map/blocks.js";
import { MESSAGE_ROW, messageOf, num, paramsOf, plural, sampleNote, short } from "./util.js";

const QUERY_COLS = 25;
const MAX_TURNS = 20;
const TURN_CHARS = 4000;

const fieldRows = (ctx) => {
  const m = messageOf(ctx);
  const okLength = m.trimmed.length >= 1 && m.trimmed.length <= MESSAGE_CHARS;
  const sc = serverContextOf(ctx.copilot);
  const replayed = sc.turn?.history_turns;
  return [
    ["message length", `${num(m.trimmed.length)} chars`, okLength ? "1 to 8,000" : "rejected"],
    ["history turns", typeof replayed === "number" && replayed !== m.history.length ? `${m.history.length} here, ${replayed} on the server` : String(m.history.length), "≤ 20 × 4,000"],
    ["focus", m.focus ? `“${m.focus.title}”` : "none", "optional"],
    ["timezone", ctx.copilot.timezone ?? "—", sc.today ? `today ${sc.today}${sc.known ? " (server)" : ""}` : ""],
    ["query", `${num(m.query.length)} chars`, `first ${num(paramsOf(ctx).queryChars)}`],
  ];
};

// The cut is the server's 500 unless the query length setting is tuned.
const cutNote = (ctx) => {
  const n = paramsOf(ctx).queryChars;
  return n === QUERY_CHARS ? "" : ` What-if: you set the query length to ${num(n)}; the server cuts at ${QUERY_CHARS}.`;
};

const FIELD_HELP = [
  {
    meaning: "How long your message is after trimming spaces at both ends.",
    formula: "1 ≤ message.trim().length ≤ 8000",
    worked: (m) => `${num(m.trimmed.length)} ${m.trimmed.length >= 1 && m.trimmed.length <= MESSAGE_CHARS ? "is" : "is not"} between 1 and 8,000`,
  },
  {
    meaning: "Earlier turns of this conversation sent along with the message.",
    formula: "history.length ≤ 20, each turn ≤ 4000 characters",
    worked: (m) => `${m.history.length} ≤ 20`,
  },
  {
    meaning: "A record you attached, so the copilot knows what “it” means.",
    formula: "focus = request.focus ?? null",
    worked: (m) => (m.focus ? `focus = “${m.focus.title}”` : "focus = null"),
  },
  {
    meaning: "Your timezone, used to work out what “today” and “Friday” mean.",
    formula: "today = date in your timezone",
    worked: (m, ctx) => `${ctx.copilot.timezone ?? "unknown"} → today ${ctx.copilot.today ?? "unknown"}`,
  },
  {
    meaning: "The part of your message that is searched. The rest still reaches the LLM as your question.",
    formula: "query = message.trim().slice(0, queryChars)",
    worked: (m, ctx) => `min(${num(m.trimmed.length)}, ${num(paramsOf(ctx).queryChars)}) = ${num(m.query.length)} characters`,
  },
];

export default {
  id: "message",
  source: [
    ["copilot", "MESSAGE_CHARS"],
    ["copilot", "QUERY_CHARS"],
  ],
  code: [
    "const message = body.message.trim()",
    "if (message.length < 1 || message.length > 8000) reject(422)",
    "if (body.history.length > 20 || body.history.some((t) => t.text.length > 4000)) reject(422)",
    "const focus = body.focus ?? null",
    "replayIfSeen(body.request_id); checkRateLimit(user, 20 per hour)",
    "const query = message.slice(0, p.queryChars)",
  ],
  frames(ctx) {
    const m = messageOf(ctx);
    const c = ctx.copilot;
    const len = m.trimmed.length;
    const ok = len >= 1 && len <= MESSAGE_CHARS;
    const frames = [
      {
        phase: "Receive",
        line: 0,
        say: `Your message arrives with ${plural(m.raw.length, "character")}${m.raw !== m.trimmed ? `, ${num(len)} after trimming spaces at the ends` : ""}.${sampleNote(ctx)}`,
        vars: { "message.length": len },
        row: MESSAGE_ROW.length,
        filled: 0,
      },
      {
        phase: "Check",
        line: 1,
        say: ok
          ? `${num(len)} is between 1 and 8,000, so the message passes.`
          : `${num(len)} is outside 1 to 8,000, so the server would reject this request.`,
        vars: { "message.length": len, MESSAGE_CHARS, ok },
        row: MESSAGE_ROW.length,
        filled: 1,
        check: true,
      },
    ];
    if (!m.history.length)
      frames.push({
        phase: "History",
        line: 2,
        say: "No earlier turns travel with this message, so the model sees only this one.",
        vars: { "history.length": 0 },
        row: MESSAGE_ROW.history,
        filled: 2,
      });
    m.history.slice(0, MAX_TURNS).forEach((t, i, list) =>
      frames.push({
        phase: "History",
        line: 2,
        say: `Earlier turn ${i + 1} of ${m.history.length} (${t.role}): ${num(t.text.length)} chars, ${t.text.length <= TURN_CHARS ? "within" : "over"} the 4,000 limit: “${short(t.text, 70)}”.`,
        vars: { turn: i + 1, role: t.role, "text.length": t.text.length },
        row: MESSAGE_ROW.history,
        filled: i === list.length - 1 ? 2 : 1,
        hold: 0.7,
      }),
    );
    frames.push({
      phase: "Focus",
      line: 3,
      say: m.focus
        ? `A record is attached as focus: the ${m.focus.type} “${m.focus.title}”. It travels with the message so the model can refer to it.`
        : "No record is attached as focus.",
      vars: { focus: m.focus ? m.focus.title : null },
      row: MESSAGE_ROW.focus,
      filled: 3,
    });
    frames.push({
      phase: "Limits",
      line: 4,
      say: `Timezone ${c.timezone ?? "unknown"}${c.today ? `, so today is ${c.today}` : ""}. The server also checks the 20-requests-an-hour limit and replays a stored reply if it has seen this request_id; the browser does not see either check.`,
      vars: { timezone: c.timezone ?? null, today: c.today ?? null },
      row: MESSAGE_ROW.timezone,
      filled: 4,
    });
    const cut = paramsOf(ctx).queryChars;
    frames.push({
      phase: "Query",
      line: 5,
      say:
        (len > cut
          ? `The search query is the first ${num(cut)} characters of the message; the other ${num(len - cut)} still reach the model as your question.`
          : `The message is ${num(len)} characters, not more than ${num(cut)}, so the whole of it becomes the search query.`) + cutNote(ctx),
      vars: { "query.length": m.query.length, "p.queryChars": cut },
      row: MESSAGE_ROW.query,
      filled: 5,
      cut: true,
    });
    return frames;
  },
  blocks(ctx) {
    const m = messageOf(ctx);
    return [
      tableBlock({
        id: "cmessage",
        title: "validated request",
        head: ["field", "value", "rule"],
        widths: [1.4, 2.4, 1.5],
        rows: fieldRows(ctx).map(([f, v, rule], r) => [
          { text: f, dim: true, align: "left" },
          { text: v, tone: r === MESSAGE_ROW.query ? "keyword" : undefined, full: r === MESSAGE_ROW.focus ? v : undefined },
          { text: rule, tone: rule === "rejected" ? "warn" : "muted" },
        ]),
        explain: (r, c) => {
          const h = FIELD_HELP[r];
          if (!h) return null;
          const head = ["field", "value", "rule"][c];
          return { meaning: `${head === "rule" ? "The rule for: " : ""}${h.meaning}`, formula: h.formula, worked: h.worked(m, ctx) };
        },
      }),
      charsBlock({
        id: "cquery",
        title: `query = message.trim().slice(0, ${paramsOf(ctx).queryChars})`,
        text: m.query || " ",
        cols: QUERY_COLS,
        tone: "keyword",
        explain: (r, c) => {
          const grid = charGrid(m.query || " ", QUERY_COLS);
          const item = grid.chars[r * grid.cols + c];
          if (!item || !m.query) return null;
          return {
            meaning: `One character of the search query, at offset ${item.offset}. Only these characters are turned into search words.`,
            formula: "query = message.trim().slice(0, queryChars)",
            worked: `offset ${item.offset} < ${num(paramsOf(ctx).queryChars)}, so “${item.ch}” is part of the query`,
          };
        },
      }),
    ];
  },
  output: "cquery",
  state(frame, ctx) {
    const m = messageOf(ctx);
    const grid = charGrid(m.query || " ", QUERY_COLS);
    return {
      cmessage: { done: (r) => r < frame.filled, active: row(frame.row, 3) },
      cquery: {
        done: () => !!frame.cut,
        active: frame.cut ? all(grid.rows, grid.cols).filter(([r, c]) => r * grid.cols + c < grid.chars.length) : [],
      },
    };
  },
  math(frame, ctx) {
    const m = messageOf(ctx);
    if (frame.check)
      return [{ label: "1 ≤ length ≤ 8000", terms: [String(m.trimmed.length)], op: "", result: String(m.trimmed.length >= 1 && m.trimmed.length <= MESSAGE_CHARS) }];
    if (frame.cut)
      return [{ label: "query", terms: [`message.slice(0, ${paramsOf(ctx).queryChars})`], op: "", result: `${m.query.length} chars` }];
    return [];
  },
  Stage({ ctx, frame }) {
    const m = messageOf(ctx);
    return (
      <div className="x-stack">
        <Panel title="Validated request">
          <Table
            head={["field", "value", "rule"]}
            active={frame.row}
            rows={fieldRows(ctx).map((r, i) => (i < frame.filled || i === frame.row ? r : { cls: "is-pending", cells: [r[0], "", ""] }))}
          />
        </Panel>
        {frame.cut && (
          <Panel title="Search query" note={`${m.query.length} of at most ${num(paramsOf(ctx).queryChars)} characters.${cutNote(ctx)}`}>
            <code>{m.query}</code>
          </Panel>
        )}
      </div>
    );
  },
};
