import { Panel, Table } from "../../kit.jsx";
import { MODEL } from "../../../engine/copilot.js";
import { all, row, tableBlock } from "../../../map/blocks.js";
import { plural, sampleNote } from "./util.js";

const stepsOf = (ctx) => ctx.copilot.response?.steps ?? [];

function loopRows(ctx) {
  const res = ctx.copilot.response;
  const t = ctx.copilot.timings;
  return [
    ["generations", `≤ ${MODEL.maxRounds}`, res ? "not returned" : "—"],
    ["lookups", `≤ ${MODEL.maxToolCalls}`, res ? String(stepsOf(ctx).length) : "—"],
    ["deadline", `${MODEL.deadlineSeconds} s`, t?.final && t?.sent ? `${((t.final - t.sent) / 1000).toFixed(1)} s total` : "—"],
  ];
}

export default {
  id: "lookups",
  source: [["copilot", "MODEL"]],
  code: [
    "let rounds = 0, calls = 0",
    "while (rounds < 3 && Date.now() < deadline) {",
    "  const out = generate(prompt)",
    "  rounds += 1",
    "  if (!out.tool_requests.length) return out",
    "  for (const req of out.tool_requests.slice(0, 4 - calls)) {",
    "    prompt.TOOL_RESULTS.push(runTool(req))",
    "    calls += 1",
    "  }",
    "}",
  ],
  frames(ctx) {
    const res = ctx.copilot.response;
    const steps = stepsOf(ctx);
    const frames = [
      {
        phase: "Loop",
        line: [0, 1],
        say: `The model has no native function calling here: it asks for a lookup by listing it in tool_requests. The server allows at most ${MODEL.maxRounds} generations and ${MODEL.maxToolCalls} lookups within ${MODEL.deadlineSeconds} seconds.${res ? sampleNote(ctx) : ""}`,
        vars: { maxRounds: MODEL.maxRounds, maxToolCalls: MODEL.maxToolCalls, deadline: `${MODEL.deadlineSeconds} s` },
        at: -1,
        limits: true,
      },
    ];
    if (!res) {
      frames.push({
        phase: "Done",
        line: 1,
        say: "There is no reply for this message yet, so there are no real lookups to show.",
        vars: { steps: null },
        at: 0,
        end: true,
      });
      return frames;
    }
    steps.forEach((s, i) =>
      frames.push({
        phase: "Lookup",
        line: [5, 6, 7],
        say: `Lookup ${i + 1} (${s.tool}): ${s.label}. Its results go into TOOL_RESULTS for the next generation.`,
        vars: { tool: s.tool, calls: i + 1 },
        at: i,
        hold: 0.9,
      }),
    );
    frames.push({
      phase: "Done",
      line: 4,
      say: steps.length
        ? `${plural(steps.length, "lookup")} of at most ${MODEL.maxToolCalls} ran before the model returned its answer.`
        : "No lookups: the model answered from the first prompt.",
      vars: { calls: steps.length },
      at: Math.max(1, steps.length),
      end: true,
    });
    return frames;
  },
  blocks(ctx) {
    const res = ctx.copilot.response;
    const steps = stepsOf(ctx);
    return [
      tableBlock({
        id: "cloop",
        title: "loop limits",
        head: ["limit", "max", "this reply"],
        widths: [1.4, 0.9, 1.6],
        rows: loopRows(ctx).map(([a, b, c]) => [{ text: a, align: "left", dim: true }, { text: b, tone: "number" }, { text: c, tone: c === "—" || c === "not returned" ? "muted" : undefined }]),
      }),
      tableBlock({
        id: "clookups",
        title: "lookups that ran",
        head: ["#", "tool", "what it did"],
        widths: [0.4, 1.7, 4],
        rows: steps.length
          ? steps.map((s, i) => [{ text: String(i + 1), dim: true }, { text: s.tool, tone: "keyword" }, { text: s.label, align: "left", full: s.label }])
          : [["", { text: res ? "none" : "no reply", tone: "muted" }, { text: res ? "answered from the first prompt" : "nothing was generated", dim: true, align: "left" }]],
      }),
    ];
  },
  output: "clookups",
  state(frame, ctx) {
    const n = stepsOf(ctx).length;
    return {
      cloop: { done: () => true, active: frame.limits ? all(3, 3) : [] },
      clookups: {
        done: (r) => !!frame.end || r <= frame.at,
        active: frame.at >= 0 && frame.at < n && !frame.end ? row(frame.at, 3) : [],
      },
    };
  },
  math(frame, ctx) {
    const s = stepsOf(ctx)[frame.at];
    if (!s || frame.end) return [];
    return [{ label: "calls", terms: [`${frame.at + 1}`, `${MODEL.maxToolCalls}`], op: "≤", result: "within the limit" }];
  },
  Stage({ ctx, frame }) {
    const steps = stepsOf(ctx);
    return (
      <div className="x-stack">
        <Panel title="Loop limits">
          <Table head={["limit", "max", "this reply"]} rows={loopRows(ctx)} />
        </Panel>
        <Panel title="Lookups" note={ctx.copilot.response ? undefined : "No reply yet."}>
          <Table
            head={["#", "tool", "what it did"]}
            active={frame.at}
            rows={steps.map((s, i) => (i <= frame.at || frame.end ? [i + 1, s.tool, s.label] : { cls: "is-pending", cells: [i + 1, "", ""] }))}
          />
        </Panel>
      </div>
    );
  },
};
