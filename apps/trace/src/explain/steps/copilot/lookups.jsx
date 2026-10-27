import { Panel, Table } from "../../kit.jsx";
import { MODEL } from "../../../engine/copilot.js";
import { all, row, tableBlock } from "../../../map/blocks.js";
import { plural, sampleNote } from "./util.js";

const stepsOf = (ctx) => ctx.copilot.response?.steps ?? [];
const turnOf = (ctx) => ctx.copilot.response?.retrieval?.turn ?? null;

function loopRows(ctx) {
  const res = ctx.copilot.response;
  const t = ctx.copilot.timings;
  const turn = turnOf(ctx);
  const took = t?.final && t?.sent ? `${((t.final - t.sent) / 1000).toFixed(1)} s total` : null;
  return [
    ["generations", `≤ ${MODEL.maxRounds}`, turn ? String(turn.rounds.length) : res ? "not reported" : "—"],
    ["lookups", `≤ ${MODEL.maxToolCalls}`, res ? String(turn ? turn.tool_calls : stepsOf(ctx).length) : "—"],
    ["deadline", `${MODEL.deadlineSeconds} s`, turn?.deadline_reached ? `reached${took ? `, ${took}` : ""}` : (took ?? (turn ? "not reached" : "—"))],
  ];
}

export default {
  id: "lookups",
  source: [["copilot", "MODEL"]],
  code: [
    "for (let round = 0; round <= 2; round++) {",
    "  const left = outOfTime() || calls >= 4 ? 0 : 2 - round",
    "  const out = generate(prompt({ TOOLS_AVAILABLE: left > 0 }))",
    "  if (!left || !out.tool_requests.length) break",
    "  for (const req of out.tool_requests.slice(0, 4 - calls)) {",
    "    if (alreadyRan(req)) continue",
    "    TOOL_RESULTS.push(runTool(req)); calls += 1",
    "  }",
    "  if (nothing new ran) break",
    "}",
  ],
  frames(ctx) {
    const res = ctx.copilot.response;
    const steps = stepsOf(ctx);
    const frames = [
      {
        phase: "Loop",
        line: [0, 1],
        say: `The model has no native function calling here: it asks for a lookup by listing it in tool_requests (search, find, agenda, workload or open_day). The server allows at most ${MODEL.maxRounds} generations and ${MODEL.maxToolCalls} lookups per reply, skips a lookup it already ran, and after ${MODEL.deadlineSeconds} seconds tells the model it has no lookups left, so the next generation must answer.${res ? sampleNote(ctx) : ""}`,
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
        line: [4, 5, 6],
        say: `Lookup ${i + 1} (${s.tool}): ${s.label}. Its results go into TOOL_RESULTS for the next generation.${(() => {
          const r = turnOf(ctx)?.rounds?.[i + 1];
          return r ? ` The prompt that followed was ${r.chars.toLocaleString("en-US")} characters.` : "";
        })()}`,
        vars: { tool: s.tool, calls: i + 1 },
        at: i,
        hold: 0.9,
      }),
    );
    const turn = turnOf(ctx);
    const gens = turn ? ` The server ran ${plural(turn.rounds.length, "generation")}${turn.deadline_reached ? " and hit the time limit" : ""}.` : "";
    frames.push({
      phase: "Done",
      line: 3,
      say: (steps.length
        ? `${plural(steps.length, "lookup")} of at most ${MODEL.maxToolCalls} ran before the model returned its answer.`
        : "No lookups: the model answered from the first prompt.") + gens,
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
        rows: loopRows(ctx).map(([a, b, c]) => [{ text: a, align: "left", dim: true }, { text: b, tone: "number" }, { text: c, tone: c === "—" || c === "not reported" ? "muted" : undefined }]),
        explain: (r, c) => {
          const x = loopRows(ctx)[r];
          if (!x) return null;
          const info = [
            { meaning: "Each generation is one full pass of the LLM over the whole prompt. More rounds mean more lookups, but also more time.", formula: `generations ≤ ${MODEL.maxRounds}` },
            { meaning: "Lookups the LLM may ask for in total, across all rounds.", formula: `calls ≤ ${MODEL.maxToolCalls}` },
            { meaning: "Once this much time has passed, no more lookups are allowed: the next generation is told TOOLS_AVAILABLE=false and must answer with what it has.", formula: `elapsed ≥ ${MODEL.deadlineSeconds} s → lookups left = 0` },
          ][r];
          return { ...info, worked: c === 2 ? `this reply: ${x[2]}` : `${x[0]}: ${x[1]}` };
        },
      }),
      tableBlock({
        id: "clookups",
        title: "lookups that ran",
        head: ["#", "tool", "what it did"],
        widths: [0.4, 1.7, 4],
        rows: steps.length
          ? steps.map((s, i) => [{ text: String(i + 1), dim: true }, { text: s.tool, tone: "keyword" }, { text: s.label, align: "left", full: s.label }])
          : [["", { text: res ? "none" : "no reply", tone: "muted" }, { text: res ? "answered from the first prompt" : "nothing was generated", dim: true, align: "left" }]],
        explain: (r) => {
          const s = steps[r];
          if (!s) return null;
          return {
            meaning: "A lookup the LLM asked for. It ran on the server and its results were added to TOOL_RESULTS before the next generation.",
            formula: "prompt.TOOL_RESULTS.push(runTool(request))",
            worked: `lookup ${r + 1} of at most ${MODEL.maxToolCalls}: ${s.tool}, ${s.label}`,
          };
        },
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
