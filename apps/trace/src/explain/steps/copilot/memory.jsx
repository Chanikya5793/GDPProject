import { Panel, Table } from "../../kit.jsx";
import { row, tableBlock } from "../../../map/blocks.js";
import { plural, sampleNote, short } from "./util.js";

const TURNS = 20;
const TURN_CHARS = 4000;
const REFERS = /\b(it|that|this|them|those|these|one)\b/i;

function memoryOf(ctx) {
  const c = ctx.copilot;
  const turns = (c.history ?? []).slice(-TURNS).map((t) => ({
    kind: t.role === "assistant" ? "copilot said" : "you said",
    text: t.text,
    chars: Math.min(TURN_CHARS, t.text.length),
    proposed: t.proposed ?? [],
  }));
  const earlier = (c.earlier ?? []).map((e) => ({ kind: `source ${e.citation_id}`, text: e.title, id: e.citation_id }));
  const focus = c.focus ? [{ kind: "attached record", text: c.focus.title }] : [];
  const refers = (c.message ?? "").match(REFERS)?.[0] ?? null;
  const server = c.response?.retrieval?.turn?.history_turns;
  return { turns, earlier, focus, refers, server: typeof server === "number" ? server : null, rows: [...turns, ...earlier, ...focus] };
}

export default {
  id: "memory",
  source: [["copilot", "turnForPrompt"], ["copilot", "buildPrompt"]],
  code: [
    "const history = (thread ? thread.messages : request.history).slice(-20)",
    "  .map((t) => ({ role: t.role, text: t.text.slice(0, 4000), proposed: t.proposed }))",
    "ledger.seed(everyCitationInTheThread) // S-numbers keep their meaning",
    "const focus = request.focus ?? recordNamedBy(message) // \"S7\" or \"7\" on its own",
    "return { history, ledger, focus }",
  ],
  frames(ctx) {
    const m = memoryOf(ctx);
    const frames = [
      {
        phase: "Why",
        line: 0,
        say: `The LLM keeps nothing between messages. Whatever it should remember has to be sent again with this one.${sampleNote(ctx)}`,
        vars: { turns: m.turns.length, sources: m.earlier.length },
        at: -1,
      },
    ];
    m.turns.forEach((t, i) =>
      frames.push({
        phase: "Turns",
        line: [0, 1],
        say: `${t.kind === "you said" ? "You said" : "The copilot said"}: “${short(t.text, 90)}”. Sent again (${t.chars} characters)${t.proposed.length ? `, with the ${plural(t.proposed.length, "record")} it proposed changes on, so “it” can mean ${t.proposed[0].title ? `“${short(t.proposed[0].title, 40)}”` : "that record"}` : ""}.`,
        vars: { turn: i + 1, chars: t.chars },
        at: i,
        hold: 0.8,
      }),
    );
    m.earlier.forEach((e, i) =>
      frames.push({
        phase: "Sources",
        line: 2,
        say: `${e.id} is still “${e.text}”. Earlier sources keep their numbers: if the record appears again this turn it gets ${e.id} back, and new records are numbered after the highest one used.`,
        vars: { citation: e.id },
        at: m.turns.length + i,
        hold: 0.8,
      }),
    );
    if (m.focus.length)
      frames.push({
        phase: "Attached",
        line: 3,
        say: `You attached “${m.focus[0].text}”, so its full text goes along with this message.`,
        vars: { focus: m.focus[0].text },
        at: m.turns.length + m.earlier.length,
      });
    frames.push({
      phase: "Remembered",
      line: 4,
      say: (!m.rows.length
        ? "This is the first message of the conversation, so there is nothing earlier to remember."
        : m.refers
          ? `Your message says “${m.refers}”. The LLM works out what that means from what is remembered here: ${plural(m.turns.length, "turn")} and ${plural(m.earlier.length, "earlier source")}.`
          : `The LLM will read ${plural(m.turns.length, "earlier turn")} and ${plural(m.earlier.length, "earlier source")} alongside your message.`) + (m.server !== null && m.server !== m.turns.length ? ` The server replayed ${plural(m.server, "turn")} from the stored thread, which can differ from what this device shows.` : m.server !== null ? " The server reported replaying the same number of turns." : ""),
      vars: { remembered: m.rows.length },
      at: m.rows.length,
    });
    return frames;
  },
  blocks(ctx) {
    const m = memoryOf(ctx);
    return [
      tableBlock({
        id: "cmemory",
        title: "what the LLM will remember",
        head: ["what", "content", "chars"],
        widths: [1.4, 3.6, 0.8],
        rows: m.rows.length
          ? m.rows.map((r) => [
              { text: r.kind, tone: r.kind.startsWith("source") ? "accent" : r.kind === "you said" ? "keyword" : "context" },
              { text: short(r.text, 44), full: r.text, align: "left" },
              r.chars !== undefined ? String(r.chars) : "",
            ])
          : [[{ text: "nothing yet", tone: "muted" }, { text: "first message", dim: true }, ""]],
        explain: (r, c) => {
          const x = m.rows[r];
          if (!x) return null;
          const kind = x.kind === "attached record" ? "focus" : x.kind.startsWith("source") ? "source" : "turn";
          if (c === 2 && x.chars === undefined) return null;
          const info = {
            turn: {
              meaning: "An earlier turn, sent again because the LLM keeps nothing between messages.",
              formula: "history = turns.slice(-20), each cut to 4000 characters",
              worked: `min(4000, ${x.text.length}) = ${x.chars} characters`,
            },
            source: {
              meaning: "A record cited earlier in this conversation. It keeps its S-number, so “that one” still points at it.",
              formula: "sources = reuseCitationIds(conversation.citations)",
              worked: `${x.id} = “${x.text}”`,
            },
            focus: {
              meaning: "The record you attached. Its full text travels with this message.",
              formula: "focus = readRecord(request.focus)",
              worked: `focus = “${x.text}”`,
            },
          }[kind];
          return c === 0 ? { ...info, worked: `${x.kind}: row ${r + 1} of ${m.rows.length}` } : info;
        },
      }),
    ];
  },
  output: "cmemory",
  state(frame, ctx) {
    const m = memoryOf(ctx);
    const rows = Math.max(1, m.rows.length);
    return {
      cmemory: {
        done: (r) => r < frame.at || (frame.at >= rows ? true : r === frame.at),
        active: frame.at >= 0 && frame.at < m.rows.length ? row(frame.at, 3) : [],
      },
      cmessage: { source: frame.phase === "Remembered" && m.refers ? [[0, 1]] : [] },
    };
  },
  math(frame, ctx) {
    const m = memoryOf(ctx);
    if (frame.phase !== "Remembered") return [];
    return [
      { label: "turns", terms: [`${m.turns.length} of at most ${TURNS}`], op: "", result: `${m.turns.reduce((s, t) => s + t.chars, 0)} chars` },
      { label: "sources", terms: [m.earlier.map((e) => e.id).join(", ") || "none"], op: "", result: "same numbers" },
    ];
  },
  Stage({ ctx }) {
    const m = memoryOf(ctx);
    return (
      <Panel title="Remembered for this message">
        <Table head={["what", "content"]} rows={m.rows.map((r) => [r.kind, r.text])} />
      </Panel>
    );
  },
};
