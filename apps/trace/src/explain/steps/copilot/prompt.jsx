import { Panel, Table } from "../../kit.jsx";
import { row, tableBlock } from "../../../map/blocks.js";
import { isWhatIf, MESSAGE_ROW, num, plural, promptOf, retrievalOf, sampleNote, short, whatIfNote } from "./util.js";

// What each section holds, in words.
function what(s, P) {
  const b = P.briefing;
  switch (s.name) {
    case "INSTRUCTIONS":
      return "how to read the sections below (fixed text)";
    case "TODAY":
      return `the date in your timezone (${P.context.today})`;
    case "PLANNER_BRIEFING":
      return `${plural(s.items ?? 0, "record")} by due day, ${plural(b.findings.length, "workload finding")}${b.truncated ? ", cut at the cap" : ""}`;
    case "UNTRUSTED_SOURCES":
      return `${plural(s.items ?? 0, "search hit")}, each ≤ 2,000 chars, flagged if it reads like an instruction`;
    case "TOOL_RESULTS":
      return "results of the lookups the model asked for";
    case "CONVERSATION":
      return `${plural(s.items ?? 0, "earlier turn")}, each ≤ 4,000 chars`;
    case "FOCUS_RECORD":
      return `“${short(P.focus?.title, 40)}”${P.fromReference ? " (you typed its citation id)" : ""}, ≤ 4,000 chars`;
    case "FOCUS_RECORD_UNAVAILABLE":
      return P.focusNote ?? "the attached record could not be used";
    case "USER_QUESTION":
      return "your message, whole";
    case "TOOLS_AVAILABLE":
      return "whether the model may still ask for lookups";
    case "REPLY_STYLE":
      return `your reply style setting (${P.context.replyStyle})`;
    default:
      return "";
  }
}

const STATUS_TONE = { exact: "good", recomputed: "warn", differs: "warn", "browser only": "muted", "server only": "muted" };
const charsText = (n) => (n === null || n === undefined ? "—" : num(n));

function narrate(s, P, ctx) {
  const vs = s.server !== null && s.status === "differs" ? ` The server's real prompt had ${num(s.server)} characters here; the difference comes from records or turns this browser does not hold exactly as the server did.` : "";
  const check = s.status === "exact" ? " The server reported exactly this size." : vs;
  switch (s.name) {
    case "INSTRUCTIONS":
      return `First a fixed paragraph telling the model how to treat each section: trust the briefing's numbers, treat record text as data, cite what it uses. ${num(s.chars)} characters.${check}`;
    case "TODAY":
      return `TODAY=${JSON.stringify(P.context.today)}: ${num(s.chars)} characters, so “Friday” and “tomorrow” resolve against your date, not the server's.${check}`;
    case "PLANNER_BRIEFING": {
      const b = P.briefing;
      const names = ["overdue", "due_today", "due_tomorrow", "schedule_ahead", "due_this_week", "unscheduled", "due_later", "notes"].filter((n) => b[n]?.length).map((n) => `${n} ${b[n].length}`);
      return `The briefing is rebuilt from your records every turn: ${plural(P.visible.length, "readable record")}, of which ${plural(s.items ?? 0, "record")} fit the cap of 40 (${names.join(", ") || "none"}), plus counts and ${plural(b.findings.length, "workload finding")} against a daily capacity of ${b.daily_capacity_minutes} minutes. ${num(s.chars)} characters.${check}`;
    }
    case "UNTRUSTED_SOURCES":
      return `${P.from === "server" ? "The server's own opening search" : isWhatIf(ctx) ? "Your what-if search" : "The browser's recomputed search"} put ${plural(s.items ?? 0, "record")} here, each with up to 2,000 characters of its text and an injection flag${P.sources.some((x) => x.injection_suspected) ? " (one of them is flagged)" : ""}. A record already in the briefing keeps its citation id. ${num(s.chars)} characters.${P.missing.length ? ` ${plural(P.missing.length, "hit")} the server kept ${P.missing.length === 1 ? "is" : "are"} not in this browser, so ${P.missing.length === 1 ? "it is" : "they are"} missing here.` : ""}${check}${whatIfNote(ctx, "prompt")}`;
    case "TOOL_RESULTS":
      return `Only in later rounds: the lookups' results, ${s.server !== null ? `${num(s.server)} characters as the server reported` : "size not known"}. The browser does not see their content.`;
    case "CONVERSATION":
      return s.items
        ? `${plural(s.items, "earlier turn")} as JSON, ${num(s.chars)} characters. A turn that proposed changes also names the records it proposed them on.${check}`
        : `No earlier turns: CONVERSATION=[] (${s.chars} characters).${check}`;
    case "FOCUS_RECORD":
      return `The record you ${P.fromReference ? "pointed at by its citation id" : "attached"}, “${short(P.focus?.title, 50)}”, with up to 4,000 characters of its text. It was issued its citation id first. ${num(s.chars)} characters.${check}`;
    case "FOCUS_RECORD_UNAVAILABLE":
      return `The attached record could not be shared, so the model is told why instead: “${P.focusNote}”.${check}`;
    case "USER_QUESTION":
      return `Your message, whole, as JSON: ${num(s.chars)} characters. It comes last among the data so the parts that change least stay at the front, where the provider can cache them.${check}`;
    case "TOOLS_AVAILABLE":
      return `The first round may still ask for lookups (at most 3 per round, 4 per turn). ${num(s.chars)} characters.${check}`;
    case "REPLY_STYLE":
      return `Your reply style, “${P.context.replyStyle}”${P.context.known ? "" : " (assumed: an older server did not say)"}. ${num(s.chars)} characters.${check}`;
    default:
      return "";
  }
}

export default {
  id: "prompt",
  source: [
    ["copilot", "buildPrompt"],
    ["copilot", "briefing"],
    ["copilot", "summarize"],
  ],
  code: [
    "const ledger = citationLedger(earlierCitations)",
    "const focus = request.focus ?? citedInMessage(message)",
    "const brief = briefing(readable, { today, capacity, items: 40, ledger })",
    "const sources = openingSearch(message).map((r) => asSource(r, ledger))",
    "const sections = [INSTRUCTIONS, TODAY, brief, sources, conversation, focus, question, toolNote, replyStyle]",
    "return sections.join(\"\\n\")",
  ],
  frames(ctx) {
    const P = promptOf(ctx);
    const lineOf = (s) =>
      ({ PLANNER_BRIEFING: 2, UNTRUSTED_SOURCES: 3, FOCUS_RECORD: 1, FOCUS_RECORD_UNAVAILABLE: 1 })[s.name] ?? 4;
    const frames = [
      {
        phase: "Order",
        line: [0, 4],
        say: `The server writes one long text, section by section, one line each. The parts that change least come first, so the provider can reuse a cached prefix. Everything below is rebuilt in this browser from your records and the server's code${P.round ? ", and checked against the sizes the server reported for this reply" : ""}.${sampleNote(ctx)}`,
        vars: { sections: P.sections.length },
        at: -1,
      },
    ];
    P.sections.forEach((s, i) =>
      frames.push({
        phase: "Section",
        line: lineOf(s),
        say: narrate(s, P, ctx),
        vars: { section: s.name, chars: s.chars ?? s.server, ...(s.server !== null ? { server: s.server } : {}) },
        at: i,
        hold: 0.8,
      }),
    );
    const sys = P.turn?.system_chars;
    frames.push({
      phase: "Done",
      line: 5,
      say: `${plural(P.sections.length, "section")}, ${num(P.chars)} characters in the first prompt${P.round ? ` (the server's: ${num(P.round.chars)})` : ""}, sent with a separate system message of ${sys ? `${num(sys)} characters` : "fixed instructions"}. That is roughly ${num(Math.round((P.chars + (sys ?? 0)) / 4))} tokens; the model illustration that follows runs on your question alone.${P.rounds.length > 1 ? ` The server then sent ${plural(P.rounds.length - 1, "more prompt")}: ${P.rounds.slice(1).map((r) => `${num(r.chars)} chars`).join(", ")}, each with the lookups' results added.` : ""}`,
      vars: { chars: P.chars, ...(P.round ? { "server chars": P.round.chars } : {}), rounds: P.rounds.length || 1 },
      at: P.sections.length,
    });
    return frames;
  },
  blocks(ctx) {
    const P = promptOf(ctx);
    const blocks = [
      tableBlock({
        id: "cprompt",
        title: P.round ? "prompt sections: rebuilt here, checked against the server" : "prompt sections, rebuilt in this browser",
        head: ["section", "contents", "chars", "server", "check"],
        widths: [2.3, 3.6, 0.8, 0.8, 1],
        rows: P.sections.map((s) => [
          { text: s.name, tone: "keyword", align: "left" },
          { text: what(s, P), align: "left", full: s.text ? short(s.text, 400) : what(s, P) },
          { text: charsText(s.chars), tone: "number" },
          { text: charsText(s.server), tone: s.server === null ? "muted" : "number" },
          { text: s.status, tone: STATUS_TONE[s.status] },
        ]),
        explain: (i, col) => {
          const s = P.sections[i];
          if (!s) return null;
          if (col === 3)
            return s.server === null
              ? { meaning: "The server did not report section sizes with this reply (an older server, or the sample).", formula: "response.retrieval.turn.rounds[0].sections", worked: "not reported" }
              : { meaning: "The size of this section in the prompt the server really sent, reported with the reply. Only its length travels, never its text.", formula: "len(section text)", worked: `${s.name}: ${num(s.server)} characters` };
          if (col === 4)
            return {
              meaning: { exact: "The browser rebuilt this section to exactly the server's length.", differs: "The browser's rebuild differs from the server's length: the server read your records and thread as they were on its side.", recomputed: "Rebuilt with the server's code in this browser; there is no server size to check it against.", "browser only": "Rebuilt here, but the server's prompt had no such section.", "server only": "The server's prompt had this section; the browser cannot rebuild it." }[s.status],
              formula: "browser chars === server chars",
              worked: `${charsText(s.chars)} vs ${charsText(s.server)}`,
            };
          if (col === 2)
            return { meaning: "Characters in this section as rebuilt here: the same JSON encoding the server uses, with non-ASCII characters escaped.", formula: "section = NAME + \"=\" + json.dumps(value)", worked: `${s.name}: ${charsText(s.chars)} characters` };
          return { meaning: col === 0 ? `Section ${i + 1} of ${P.sections.length}, in the order the server writes them.` : what(s, P), formula: "prompt = sections.join(\"\\n\")", worked: s.text ? short(s.text, 160) : s.name };
        },
      }),
    ];
    if (P.rounds.length)
      blocks.push(
        tableBlock({
          id: "crounds",
          title: "prompts the server sent for this reply",
          head: ["round", "chars", "lookups allowed", "asked", "ran"],
          widths: [0.8, 1, 1.4, 0.8, 0.8],
          rows: P.rounds.map((r, i) => [
            { text: String(i + 1), dim: true },
            { text: num(r.chars), tone: "number" },
            { text: r.tools_available ? "yes" : "no", tone: r.tools_available ? "good" : "muted" },
            String(r.tool_requests),
            String(r.tool_calls),
          ]),
          explain: (i) => {
            const r = P.rounds[i];
            if (!r) return null;
            return {
              meaning: "One generation: the prompt's length, whether lookups were still allowed, how many the model asked for and how many new ones ran. Reported by the server.",
              formula: "response.retrieval.turn.rounds[i]",
              worked: `round ${i + 1}: ${num(r.chars)} chars, asked ${r.tool_requests}, ran ${r.tool_calls}`,
            };
          },
        }),
      );
    return blocks;
  },
  output: "cprompt",
  state(frame, ctx) {
    const P = promptOf(ctx);
    const s = P.sections[frame.at];
    const r = retrievalOf(ctx);
    return {
      cprompt: { done: (i) => i <= frame.at, active: s ? row(frame.at, 5) : [] },
      ...(P.rounds.length ? { crounds: { done: () => frame.at >= P.sections.length, active: [] } } : {}),
      cscores: { source: s?.name === "UNTRUSTED_SOURCES" && P.from === "browser" ? r.keptRows.flatMap((i) => row(i, 5)) : [] },
      cmessage: {
        source: !s ? [] : s.name.startsWith("FOCUS") ? [[MESSAGE_ROW.focus, 1]] : ({ TODAY: [[MESSAGE_ROW.timezone, 1]], CONVERSATION: [[MESSAGE_ROW.history, 1]], USER_QUESTION: [[MESSAGE_ROW.length, 1]] })[s.name] ?? [],
      },
    };
  },
  math(frame, ctx) {
    const P = promptOf(ctx);
    const s = P.sections[frame.at];
    if (!s) {
      if (frame.at !== P.sections.length) return [];
      const known = P.sections.filter((x) => x.chars !== null);
      return [{ label: "prompt", terms: [...known.map((x) => String(x.chars)), `${known.length - 1} newlines`], result: `${num(P.chars)} chars` }];
    }
    return [
      { label: s.name, terms: [charsText(s.chars)], op: "", result: `${charsText(s.chars)} chars` },
      ...(s.server !== null ? [{ label: "server", terms: [num(s.server)], op: "", result: s.status }] : []),
    ];
  },
  Stage({ ctx, frame }) {
    const P = promptOf(ctx);
    return (
      <Panel title="Prompt sections" note={P.round ? "Sizes checked against the server's report for this reply." : "Rebuilt in this browser with the server's code."}>
        <Table
          head={["section", "contents", "chars", "server"]}
          active={frame.at}
          rows={P.sections.map((s, i) =>
            i <= frame.at ? [s.name, what(s, P), charsText(s.chars), charsText(s.server)] : { cls: "is-pending", cells: [s.name, "", "", ""] },
          )}
        />
      </Panel>
    );
  },
};
