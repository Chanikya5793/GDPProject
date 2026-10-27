import { Panel, Table } from "../../kit.jsx";
import { row, tableBlock } from "../../../map/blocks.js";
import { plural, reasonOf, sampleNote, value } from "./util.js";

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Rows of the cproposal block, with the row range of each proposal.
function layout(ctx) {
  const proposals = ctx.copilot.response?.proposals ?? [];
  const rows = [];
  const ranges = proposals.map((p, i) => {
    const before = p.before ?? {};
    const after = p.after ?? {};
    const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    const start = rows.length;
    const changed = [];
    fields.forEach((f, k) => {
      const diff = !same(before[f], after[f]);
      if (diff) changed.push(f);
      rows.push([
        { text: k === 0 ? `P${i + 1}` : "", tone: "accent", bold: true },
        { text: f, align: "left", dim: !diff },
        { text: value(before[f]), tone: diff ? "warn" : "muted", full: value(before[f]) },
        { text: value(after[f]), tone: diff ? "good" : "muted", full: value(after[f]) },
      ]);
    });
    rows.push([
      { text: fields.length ? "" : `P${i + 1}`, tone: "accent", bold: true },
      { text: "revision", align: "left", dim: true },
      { text: value(p.base_revision), tone: "number" },
      { text: typeof p.base_revision === "number" ? `${p.base_revision + 1} on confirm` : "+1 on confirm", tone: "accent" },
    ]);
    return { start, end: rows.length - 1, fields, changed, revisionRow: rows.length - 1 };
  });
  return { proposals, rows, ranges };
}

function describe(p, range) {
  const b = p.before ?? {};
  const a = p.after ?? {};
  const changes = range.changed.map((f) => `${f} ${value(b[f])} → ${value(a[f])}`);
  const kept = range.fields.filter((f) => !range.changed.includes(f));
  if (p.operation === "create") return `the new values are ${changes.join(", ") || "empty"}`;
  if (p.operation === "delete") return "the record would be removed";
  return `${changes.join(", ") || "no field changes"}${kept.length ? `; ${kept.join(", ")} stay the same` : ""}`;
}

export default {
  id: "proposals",
  source: [["copilot", "canConfirm"]],
  code: [
    "for (const action of out.actions) {",
    "  const result = validate(action, record)",
    "  if (!result.ok) unavailable.push(result.reason)",
    "  else proposals.push(store({ ...result, base_revision: record.revision, ttl: \"24h\" }))",
    "}",
    "async function confirm(proposal, idempotencyKey) {",
    "  await post(`/v1/proposals/${proposal.id}/confirm`, { idempotencyKey, expected_base_revision })",
    "  transaction: if (proposal.status !== \"pending\" || record.revision !== base_revision) reject",
    "  write(proposal.after); record.revision += 1",
    "}",
  ],
  frames(ctx) {
    const res = ctx.copilot.response;
    const { proposals, ranges } = layout(ctx);
    const unavailable = res?.unavailable ?? [];
    const frames = [
      {
        phase: "Actions",
        line: [0, 1],
        say: !res
          ? "There is no reply for this message, so there are no proposals."
          : proposals.length || unavailable.length
            ? `The answer suggested ${plural(proposals.length + unavailable.length, "change")}: ${proposals.length} became ${proposals.length === 1 ? "a proposal" : "proposals"}${unavailable.length ? `, ${unavailable.length} could not` : ""}. Each is validated for its record type and kept for 24 hours; nothing is written yet.${sampleNote(ctx)}`
            : "The reply suggested no changes, so there is nothing to confirm.",
        vars: { proposals: proposals.length, unavailable: unavailable.length },
        p: -1,
        u: -1,
      },
    ];
    proposals.forEach((p, i) => {
      const r = ranges[i];
      frames.push({
        phase: "Proposal",
        line: 3,
        say: `Proposal ${i + 1}: ${p.operation} the ${p.entity_type} ${p.record_id ? `${p.record_id} ` : ""}(“${value(p.before?.title ?? p.after?.title)}”): ${describe(p, r)}.${p.rationale ? ` Reason given: “${p.rationale}”` : ""}`,
        vars: { operation: p.operation, record_id: p.record_id, changed: r.changed },
        p: i,
        u: -1,
        hold: 1,
      });
      frames.push({
        phase: "Confirm",
        line: [5, 6, 7, 8],
        say: `It was made against revision ${value(p.base_revision)}. Confirming sends that revision with an idempotency key; a Firestore transaction writes only if the proposal is still pending and the record is still at revision ${value(p.base_revision)}. Status now: ${p.status}.`,
        vars: { base_revision: p.base_revision, status: p.status },
        p: i,
        u: -1,
        confirm: true,
        hold: 0.9,
      });
    });
    unavailable.forEach((u, i) =>
      frames.push({
        phase: "Unavailable",
        line: 2,
        say: `Not turned into a proposal: ${reasonOf(u)}`,
        vars: { reason: reasonOf(u) },
        p: proposals.length,
        u: i,
      }),
    );
    frames.push({
      phase: "Done",
      line: 4,
      say: proposals.length
        ? `${plural(proposals.length, "proposal")} waiting for you. Until you confirm, your planner is unchanged.`
        : "No proposals are waiting, and your planner is unchanged.",
      vars: { pending: proposals.filter((p) => p.status === "pending").length },
      p: proposals.length,
      u: unavailable.length,
      end: true,
    });
    return frames;
  },
  blocks(ctx) {
    const { rows } = layout(ctx);
    const unavailable = ctx.copilot.response?.unavailable ?? [];
    return [
      tableBlock({
        id: "cproposal",
        title: "proposed changes: before → after",
        head: ["#", "field", "before", "after"],
        widths: [0.5, 1.4, 2.1, 2.1],
        rows: rows.length ? rows : [["", { text: "no changes suggested", tone: "muted", align: "left" }, "", ""]],
      }),
      tableBlock({
        id: "cunavailable",
        title: "not proposed",
        head: ["#", "reason"],
        widths: [0.4, 4.6],
        rows: unavailable.length
          ? unavailable.map((u, i) => [{ text: String(i + 1), dim: true }, { text: reasonOf(u), tone: "warn", align: "left", full: reasonOf(u) }])
          : [["", { text: "none", tone: "muted", align: "left" }]],
      }),
    ];
  },
  output: "cproposal",
  state(frame, ctx) {
    const { ranges } = layout(ctx);
    const r = ranges[frame.p];
    const doneRows = frame.end || frame.p >= ranges.length ? Infinity : r ? (frame.confirm ? r.end + 1 : r.revisionRow) : 0;
    const span = r ? Array.from({ length: r.revisionRow - r.start }, (_, k) => row(r.start + k, 4)).flat() : [];
    return {
      cproposal: {
        done: (i) => i < doneRows,
        active: r ? (frame.confirm ? row(r.revisionRow, 4) : span) : [],
      },
      cunavailable: {
        done: (i) => !!frame.end || i < frame.u,
        active: frame.u >= 0 && !frame.end ? row(frame.u, 2) : [],
      },
    };
  },
  math(frame, ctx) {
    const { proposals } = layout(ctx);
    const p = proposals[frame.p];
    if (!p || !frame.confirm) return [];
    return [
      {
        label: "write if",
        terms: ["record.revision", String(p.base_revision)],
        op: "===",
        result: `revision becomes ${typeof p.base_revision === "number" ? p.base_revision + 1 : "base + 1"}`,
      },
    ];
  },
  Stage({ ctx, frame }) {
    const { proposals, ranges } = layout(ctx);
    const unavailable = ctx.copilot.response?.unavailable ?? [];
    return (
      <div className="x-stack">
        {proposals.length ? (
          proposals.map((p, i) => (
            <Panel key={p.proposal_id ?? i} title={`Proposal ${i + 1}: ${p.operation} ${p.entity_type}`} note={p.rationale}>
              <Table
                head={["field", "before", "after"]}
                rows={ranges[i].fields.map((f) => [f, value(p.before?.[f]), value(p.after?.[f])]).concat([["revision", value(p.base_revision), "+1 on confirm"]])}
                active={frame.p === i ? -1 : undefined}
              />
            </Panel>
          ))
        ) : (
          <Panel title="Proposals">
            <p>No changes suggested.</p>
          </Panel>
        )}
        {unavailable.length > 0 && (
          <Panel title="Not proposed">
            <Table head={["#", "reason"]} rows={unavailable.map((u, i) => [i + 1, reasonOf(u)])} />
          </Panel>
        )}
      </div>
    );
  },
};
