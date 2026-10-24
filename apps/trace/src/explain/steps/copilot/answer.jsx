import { Panel, Table } from "../../kit.jsx";
import { MODEL } from "../../../engine/copilot.js";
import { all, row, tableBlock } from "../../../map/blocks.js";
import { num, plural, reasonOf, sampleNote, short, wrap } from "./util.js";

const WIDTH = 48;
const MAX_TEXT_FRAMES = 6;

function view(ctx) {
  const c = ctx.copilot;
  const res = c.response;
  const lines = res ? wrap(res.answer, WIDTH) : [];
  const chunk = Math.max(1, Math.ceil(lines.length / MAX_TEXT_FRAMES));
  const t = c.timings;
  return {
    res,
    lines,
    chunk,
    cites: res?.citations ?? [],
    model: MODEL.name,
    firstText: t?.firstText && t?.sent ? t.firstText - t.sent : null,
    total: t?.final && t?.sent ? t.final - t.sent : null,
  };
}

function shapeRows(v) {
  const res = v.res;
  return [
    ["tool_requests", "≤ 3 per generation", res ? ((res.steps ?? []).length ? `${plural(res.steps.length, "lookup")} in earlier rounds` : "none") : "—"],
    ["answer", "≤ 8,000 chars", res ? `${num(res.answer.length)} chars` : "—"],
    ["citation_ids", "issued source ids", res ? v.cites.map((c) => c.citation_id).join(" ") || "none" : "—"],
    ["needs_clarification", "true or false", res ? "not returned" : "—"],
    ["actions", "suggested changes", res ? `${(res.proposals ?? []).length} proposed, ${(res.unavailable ?? []).length} unavailable` : "—"],
  ];
}

function disclosureRows(v) {
  const r = v.res?.retrieval;
  const ms = (x) => (x === null ? "not measured" : `${num(Math.round(x))} ms`);
  return [
    ["attempted", r ? String(r.attempted) : "—"],
    ["result_count", r ? String(r.result_count) : "—"],
    ["entity_types", r ? (r.entity_types ?? []).join(", ") || "none" : "—"],
    ["abstained", r ? `${r.abstained}${r.reason ? ` (${r.reason})` : ""}` : "—"],
    ["time to first text", ms(v.firstText)],
    ["total time", ms(v.total)],
  ];
}

const FIELD_NOTES = {
  tool_requests: "lookups the model wants before it answers; empty in the final reply.",
  answer: "the text you read.",
  citation_ids: "which issued sources (S1 to S5) the answer relies on.",
  needs_clarification: "true when the model needs to ask you something back; this flag is not returned to the browser.",
  actions: "changes it suggests; they become proposals in the next step.",
};

export default {
  id: "answer",
  source: [["copilot", "MODEL"], ["copilot", "citationCheck"]],
  code: [
    "const out = GeneratedAnswer.parse(generate(prompt))",
    "out.answer = out.answer.replace(/\\[S\\d+\\]/g, \"\")",
    "const issued = new Set(sources.map((s) => s.citation_id))",
    "if (out.citation_ids.some((id) => !issued.has(id)) && !out.actions.length) out = abstain()",
    "const citations = sources.filter((s) => out.citation_ids.includes(s.citation_id))",
    "return { answer: out.answer, citations, retrieval, proposals }",
  ],
  frames(ctx) {
    const v = view(ctx);
    const frames = [
      {
        phase: "Schema",
        line: 0,
        say: `The LLM (temperature ${MODEL.temperature}) must reply with JSON that fits the GeneratedAnswer schema exactly.${v.res ? sampleNote(ctx) : ""}`,
        vars: { temperature: MODEL.temperature },
        stage: "schema",
        field: -1,
      },
    ];
    if (!v.res) {
      frames.push({
        phase: "Nothing yet",
        line: 0,
        say: "No reply exists for this message, so nothing was generated: the answer, citations and disclosure below stay empty.",
        vars: { response: null },
        stage: "end",
      });
      return frames;
    }
    shapeRows(v).forEach(([field, rule, value], i) =>
      frames.push({
        phase: "Field",
        line: 0,
        say: `${field} (${rule}): ${FIELD_NOTES[field]} Here: ${value}.`,
        vars: { field, value },
        stage: "schema",
        field: i,
        hold: 0.7,
      }),
    );
    const markers = /\[S\d+\]/.test(v.res.answer);
    frames.push({
      phase: "Markers",
      line: 1,
      say: markers
        ? "Inline markers such as [S2] are normally removed; this text still has some, so it was not cleaned the usual way."
        : "Inline markers such as [S2] are removed from the text; citations travel separately. The reply you got has none left.",
      vars: { markers },
      stage: "text",
      upTo: -1,
    });
    for (let start = 0; start < v.lines.length; start += v.chunk) {
      const end = Math.min(v.lines.length, start + v.chunk) - 1;
      frames.push({
        phase: "Answer",
        line: 5,
        say: `${start === end ? `Line ${start + 1}` : `Lines ${start + 1}–${end + 1}`} of ${v.lines.length}: “${short(v.lines.slice(start, end + 1).join(" "), 140)}”`,
        vars: { "answer.length": v.res.answer.length, lines: v.lines.length },
        stage: "text",
        from: start,
        upTo: end,
        hold: 0.9,
      });
    }
    frames.push({
      phase: "Check",
      line: [2, 3, 4],
      say: `${plural(v.cites.length, "citation")} came back${v.cites.length ? `: ${v.cites.map((c) => c.citation_id).join(", ")}` : ""}. An answer that cited ids never issued would have been replaced by an abstention unless it also proposed changes, and only the sources the answer used are returned.`,
      vars: { citations: v.cites.map((c) => c.citation_id) },
      stage: "cites",
      cite: -1,
    });
    v.cites.forEach((c, i) =>
      frames.push({
        phase: "Citation",
        line: 4,
        say: `${c.citation_id}: the ${c.entity_type} “${c.title}” at revision ${c.revision}. Excerpt: “${short(c.excerpt, 100)}”.`,
        vars: { citation_id: c.citation_id, record_id: c.record_id, revision: c.revision },
        stage: "cites",
        cite: i,
        hold: 0.8,
      }),
    );
    const r = v.res.retrieval;
    frames.push({
      phase: "Disclosure",
      line: 5,
      say: r
        ? `The server discloses its search: attempted ${r.attempted}, ${plural(r.result_count, "result")}${r.entity_types?.length ? ` (${r.entity_types.join(", ")})` : ""}, abstained ${r.abstained}${r.reason ? `: ${reasonOf(r.reason)}` : ""}.`
        : "The reply carries no retrieval disclosure.",
      vars: { ...(r ?? {}) },
      stage: "disclose",
    });
    frames.push({
      phase: "Timing",
      line: 5,
      say:
        v.total !== null
          ? `Measured in your browser: first text after ${num(Math.round(v.firstText ?? v.total))} ms, the whole reply after ${num(Math.round(v.total))} ms.`
          : "No client timings were recorded for this exchange.",
      vars: { firstText: v.firstText, total: v.total },
      stage: "end",
    });
    return frames;
  },
  blocks(ctx) {
    const v = view(ctx);
    return [
      tableBlock({
        id: "cshape",
        title: "GeneratedAnswer (strict JSON schema)",
        head: ["field", "rule", "in this reply"],
        widths: [1.9, 1.7, 2.3],
        rows: shapeRows(v).map(([f, rule, value]) => [
          { text: f, tone: "keyword", align: "left" },
          { text: rule, dim: true },
          { text: value, tone: value === "—" || value === "not returned" ? "muted" : undefined, full: value },
        ]),
      }),
      tableBlock({
        id: "canswer",
        title: "answer",
        head: ["#", "text"],
        widths: [0.4, 5.6],
        rows: v.lines.length
          ? v.lines.map((l, i) => [{ text: String(i + 1), dim: true }, { text: l, align: "left", full: l }])
          : [["", { text: "nothing was generated", tone: "muted", align: "left" }]],
      }),
      tableBlock({
        id: "ccitations",
        title: "citations (only the sources the answer used)",
        head: ["id", "type", "title", "rev", "excerpt"],
        widths: [0.5, 0.8, 2, 0.5, 3.6],
        rows: v.cites.length
          ? v.cites.map((c) => [
              { text: c.citation_id, tone: "accent", bold: true },
              { text: c.entity_type, dim: true },
              { text: c.title, align: "left", full: c.title },
              { text: String(c.revision), tone: "number" },
              { text: c.excerpt, align: "left", full: c.excerpt },
            ])
          : [["", "", { text: v.res ? "no citations" : "no reply", tone: "muted" }, "", ""]],
      }),
      tableBlock({
        id: "cdisclose",
        title: "retrieval disclosure and timing",
        head: ["field", "value"],
        widths: [1.9, 2.4],
        rows: disclosureRows(v).map(([f, val]) => [
          { text: f, align: "left", dim: true },
          { text: val, tone: val === "—" || val === "not measured" ? "muted" : "number", full: val },
        ]),
      }),
    ];
  },
  output: "canswer",
  state(frame, ctx) {
    const v = view(ctx);
    const order = ["schema", "text", "cites", "disclose", "end"];
    const past = (s) => order.indexOf(frame.stage) > order.indexOf(s);
    const end = frame.stage === "end";
    return {
      cshape: {
        done: (r) => past("schema") || r <= frame.field,
        active: frame.stage === "schema" && frame.field >= 0 ? row(frame.field, 3) : [],
      },
      canswer: {
        done: (r) => past("text") || (frame.stage === "text" && r <= frame.upTo),
        active:
          frame.stage === "text" && frame.upTo >= 0
            ? Array.from({ length: frame.upTo - frame.from + 1 }, (_, k) => row(frame.from + k, 2)).flat()
            : [],
      },
      ccitations: {
        done: (r) => past("cites") || (frame.stage === "cites" && r <= frame.cite),
        active: frame.stage === "cites" && frame.cite >= 0 ? row(frame.cite, 5) : [],
      },
      cdisclose: {
        done: (r) => end || (frame.stage === "disclose" && r < 4),
        active: frame.stage === "disclose" ? all(4, 2) : end && v.total !== null ? [[4, 1], [5, 1]] : [],
      },
    };
  },
  math(frame, ctx) {
    const v = view(ctx);
    if (frame.stage === "cites" && frame.cite < 0 && v.res)
      return [{ label: "citations", terms: ["issued", "cited by the answer"], op: "∩", result: v.cites.map((c) => c.citation_id).join(", ") || "none" }];
    if (frame.stage === "end" && v.total !== null)
      return [
        { label: "first text", terms: ["firstText", "sent"], op: "−", result: `${Math.round(v.firstText ?? v.total)} ms` },
        { label: "total", terms: ["final", "sent"], op: "−", result: `${Math.round(v.total)} ms` },
      ];
    return [];
  },
  Stage({ ctx, frame }) {
    const v = view(ctx);
    return (
      <div className="x-stack">
        <Panel title="GeneratedAnswer">
          <Table head={["field", "rule", "in this reply"]} active={frame.stage === "schema" ? frame.field : -1} rows={shapeRows(v)} />
        </Panel>
        <Panel title="Answer" note={v.res ? undefined : "Nothing was generated."}>
          {v.res && <p>{v.res.answer}</p>}
        </Panel>
        {v.cites.length > 0 && (
          <Panel title="Citations">
            <Table
              head={["id", "record", "rev", "excerpt"]}
              active={frame.stage === "cites" ? frame.cite : -1}
              rows={v.cites.map((c) => [c.citation_id, c.title, c.revision, c.excerpt])}
            />
          </Panel>
        )}
        <Panel title="Disclosure">
          <Table head={["field", "value"]} rows={disclosureRows(v)} />
        </Panel>
      </div>
    );
  },
};
