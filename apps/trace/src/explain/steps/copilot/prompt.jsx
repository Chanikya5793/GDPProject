import { Panel, Table } from "../../kit.jsx";
import { promptSections } from "../../../engine/copilot.js";
import { row, tableBlock } from "../../../map/blocks.js";
import { isWhatIf, MESSAGE_ROW, messageOf, num, plural, retrievalOf, whatIfNote } from "./util.js";

const NOT_KNOWN = "size not known in the browser";

function sectionsOf(ctx) {
  const c = ctx.copilot;
  const m = messageOf(ctx);
  const r = retrievalOf(ctx);
  const base = promptSections({ message: m.trimmed, history: m.history, focus: m.focus, hits: r.kept, today: c.today });
  return [
    ...base.map((s) => ({
      ...s,
      known: s.chars === null ? "no" : s.name === "UNTRUSTED_SOURCES" || s.name === "TODAY" ? "estimate" : "yes",
    })),
  ];
}

function narrate(s, ctx) {
  const c = ctx.copilot;
  const r = retrievalOf(ctx);
  const m = messageOf(ctx);
  switch (s.name) {
    case "Preamble":
      return `First come the system instructions. They exist and are the same for every request, but this page does not show them; ${NOT_KNOWN}.`;
    case "TODAY":
      return `TODAY: ${c.today ?? "the date"} in ${c.timezone ?? "your timezone"}, about ${s.chars} characters, so “Friday” and “tomorrow” can be resolved.`;
    case "PLANNER_BRIEFING":
      return `A briefing of your planner built the same way every time: overdue, today and this week, at most 40 records. It is assembled on the server; ${NOT_KNOWN}.`;
    case "UNTRUSTED_SOURCES": {
      const count = c.response?.retrieval?.result_count;
      const server = typeof count === "number" && (count !== r.kept.length || isWhatIf(ctx)) ? `; the server, on its default settings, reported ${plural(count, "hit")}` : "";
      return (r.kept.length
        ? `The ${plural(r.kept.length, "search hit")}, each cut to 2,000 characters and wrapped as untrusted: text inside is checked for injected instructions and treated as data. About ${num(s.chars)} characters, estimated from this browser's recomputed hits${server}.`
        : `No search hits, so this section is empty${server}.`) + whatIfNote(ctx, "prompt");
    }
    case "TOOL_RESULTS":
      return `Empty in the first prompt. If the model asks for lookups, their results go here and the prompt is sent again; ${NOT_KNOWN}.`;
    case "CONVERSATION":
      return m.history.length
        ? `${plural(m.history.length, "earlier turn")}, ${num(s.chars)} characters (each turn capped at 4,000).`
        : "No earlier turns, so the conversation section is empty.";
    case "USER_QUESTION":
      return `Your message itself, ${num(s.chars)} characters, after all the context it may need.`;
    case "TOOLS_AVAILABLE":
      return `The lookups the model may request, described in text: it asks for them in its JSON reply rather than through native function calling. ${NOT_KNOWN[0].toUpperCase()}${NOT_KNOWN.slice(1)}.`;
    case "Reply style":
      return `A short note on reply style closes the prompt. Like the preamble it is part of the instructions and is not shown; ${NOT_KNOWN}.`;
    default:
      return m.focus
        ? `The attached record “${m.focus.title}”, ${num(s.chars)} characters (cap 4,000).`
        : "No record is attached, so the focus section is empty.";
  }
}

const sourceRows = {
  TODAY: () => [[MESSAGE_ROW.timezone, 1]],
  CONVERSATION: () => [[MESSAGE_ROW.history, 1]],
  USER_QUESTION: () => [[MESSAGE_ROW.length, 1]],
};

export default {
  id: "prompt",
  source: [["copilot", "promptSections"]],
  code: [
    "const sections = [preamble, today(tz), briefing(records, 40)]",
    "sections.push(untrusted(hits.map((h) => h.text.slice(0, 2000))))",
    "sections.push(toolResults, conversation(history), focusRecord(focus))",
    "sections.push(question(message), toolsAvailable, replyStyle)",
    "return sections.join(\"\\n\\n\")",
  ],
  frames(ctx) {
    const sections = sectionsOf(ctx);
    const lineOf = (i) => (i <= 2 ? 0 : i === 3 ? 1 : i <= 6 ? 2 : 3);
    const frames = [
      {
        phase: "Order",
        line: 0,
        say: "The server packs the prompt in a fixed order. The parts that change least come first, so consecutive requests share a prefix the provider can cache; limits are character caps, not token counts.",
        vars: { sections: sections.length },
        at: -1,
      },
    ];
    sections.forEach((s, i) =>
      frames.push({
        phase: "Section",
        line: lineOf(i),
        say: narrate(s, ctx),
        vars: { section: s.name, chars: s.chars },
        at: i,
        hold: 0.8,
      }),
    );
    const known = sections.filter((s) => s.chars !== null).reduce((a, s) => a + s.chars, 0);
    frames.push({
      phase: "Done",
      line: 4,
      say: `${sections.length} sections. The parts this browser can size add up to about ${num(known)} characters; the instructions, briefing and tool list add more that it cannot see.`,
      vars: { "known chars": known },
      at: sections.length,
    });
    return frames;
  },
  blocks(ctx) {
    const sections = sectionsOf(ctx);
    return [
      tableBlock({
        id: "cprompt",
        title: "prompt sections, in order",
        head: ["section", "contents", "chars", "known?"],
        widths: [2.2, 3.4, 0.9, 0.9],
        rows: sections.map((s) => [
          { text: s.name, tone: s.real ? "keyword" : "context", align: "left" },
          { text: s.what, align: "left", full: s.what, dim: !s.real },
          s.chars === null ? { text: "?", tone: "muted" } : { text: num(s.chars), tone: "number" },
          { text: s.known, tone: s.known === "yes" ? "good" : s.known === "no" ? "muted" : "warn" },
        ]),
        explain: (i, col) => {
          const s = sections[i];
          if (!s) return null;
          if (col === 2 || col === 3) {
            if (s.chars === null)
              return { meaning: "This section exists, but the browser cannot see it, so its size is not known.", formula: "not known in the browser", worked: `${s.name}: ?` };
            if (s.name === "UNTRUSTED_SOURCES") {
              const hits = retrievalOf(ctx).kept;
              return {
                meaning: `An estimate: each kept hit's text, cut to 2,000 characters, plus about 120 for its label.${isWhatIf(ctx) ? " What-if: the hits are the ones your settings keep." : ""}`,
                formula: "Σ min(2000, hit.text.length) + 120",
                worked: hits.length ? `${hits.map((h) => `min(2000, ${h.text.length}) + 120`).join(" + ")} = ${num(s.chars)}` : "no hits = 0",
              };
            }
            return { meaning: `The size of ${s.name}, in characters. Limits are character caps, not token counts.`, formula: "chars = section text length (capped)", worked: `${num(s.chars)} characters` };
          }
          return { meaning: col === 0 ? `Section ${i + 1} of ${sections.length}, in the fixed order the server writes them.` : s.what, formula: "prompt = sections.join(\"\\n\\n\")", worked: `${s.name}: ${s.what}` };
        },
      }),
    ];
  },
  output: "cprompt",
  state(frame, ctx) {
    const sections = sectionsOf(ctx);
    const s = sections[frame.at];
    const r = retrievalOf(ctx);
    return {
      cprompt: { done: (i) => i <= frame.at, active: s ? row(frame.at, 4) : [] },
      cscores: { source: s?.name === "UNTRUSTED_SOURCES" ? r.keptRows.flatMap((i) => row(i, 5)) : [] },
      cmessage: {
        source: !s ? [] : s.name.startsWith("FOCUS") ? (ctx.copilot.focus ? [[MESSAGE_ROW.focus, 1]] : []) : (sourceRows[s.name]?.() ?? []),
      },
    };
  },
  math(frame, ctx) {
    const s = sectionsOf(ctx)[frame.at];
    if (!s) return [];
    if (s.name === "UNTRUSTED_SOURCES") {
      const hits = retrievalOf(ctx).kept;
      return [
        {
          label: "sources",
          terms: hits.length ? hits.map((h) => `min(2000, ${h.text.length}) + 120`) : ["0"],
          result: `≈ ${s.chars}`,
        },
      ];
    }
    return [{ label: s.name, terms: [s.chars === null ? "not known" : String(s.chars)], op: "", result: s.chars === null ? "?" : `${s.chars} chars` }];
  },
  Stage({ ctx, frame }) {
    const sections = sectionsOf(ctx);
    return (
      <Panel title="Prompt sections" note="The system instructions are part of the prompt but are not shown here.">
        <Table
          head={["section", "contents", "chars"]}
          active={frame.at}
          rows={sections.map((s, i) =>
            i <= frame.at ? [s.name, s.what, s.chars === null ? "not known" : num(s.chars)] : { cls: "is-pending", cells: [s.name, "", ""] },
          )}
        />
      </Panel>
    );
  },
};
