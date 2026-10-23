import { Panel, Table, Tag } from "../../kit.jsx";
import { applyProposal } from "../../../engine/pipeline.js";
import { analyzedRecords, decisionRow, indexed, plural, revealState } from "./util.js";
import { row, tableBlock } from "../../../map/blocks.js";

const FIELDS = ["title", "date", "time", "revision"];

// Records before and after this proposal. After a confirmed change the
// app holds only the new records, so "before" is rebuilt from them.
function plan(ctx) {
  const { trace } = ctx;
  const records = ctx.records ?? [];
  const p = trace.decision.proposal ?? null;
  if (!p) return { p, before: records, after: records, error: null, oldKnown: true };
  if (!ctx.applied) {
    let after = records;
    let error = null;
    try {
      after = applyProposal(records.map((r) => ({ ...r })), p);
    } catch (e) {
      error = e.message;
    }
    return { p, before: records, after, error, oldKnown: true };
  }
  const after = records;
  let before;
  let oldKnown = true;
  if (p.intent === "create") before = records.slice(0, Math.max(0, records.length - p.dates.length));
  else if (p.intent === "delete") before = analyzedRecords(ctx).filter(Boolean);
  else {
    const seen = trace.vectors.results.find((r) => r.record.id === p.targetId)?.record;
    oldKnown = !!seen && seen.revision === p.expectedRevision;
    before = records.map((r) =>
      r.id !== p.targetId
        ? r
        : oldKnown
          ? seen
          : { ...r, date: null, time: null, revision: p.expectedRevision, unknown: true },
    );
  }
  return { p, before, after, error: null, oldKnown };
}

const nextNumberOf = (records) => Math.max(0, ...records.map((r) => Number(r.id.replace("N", "")) || 0)) + 1;

const mod = {
  id: "respond",
  source: [["pipeline", "applyProposal"]],
  code: [
    "function applyProposal(records, proposal) {",
    '  if (!["create", "update", "delete"].includes(proposal?.intent)) throw Error("A valid proposal is required.")',
    '  if (proposal.intent === "create") {',
    '    if (!title || !dates.length || !time) throw Error("The proposal is incomplete.")',
    '    const next = Math.max(0, ...records.map(r => Number(r.id.replace("N", "")) || 0)) + 1',
    "    return [...records, ...dates.map((date, i) => ({ id: `N${next + i}`, title, date, time, revision: 1 }))]",
    "  }",
    "  const target = records.find(r => r.id === proposal.targetId)",
    '  if (!target || target.revision !== proposal.expectedRevision) throw Error("This record changed after the preview.")',
    '  if (proposal.intent === "delete") return records.filter(r => r.id !== target.id)',
    '  if (!proposal.date || !proposal.time) throw Error("The proposal is incomplete.")',
    "  return records.map(r => r.id === target.id ? { ...r, date, time, revision: r.revision + 1 } : r)",
    "}",
  ],
  frames(ctx) {
    const { trace } = ctx;
    const { decision } = trace;
    const { p, before, after, error, oldKnown } = plan(ctx);
    const frames = [];
    if (!p) {
      const next =
        decision.reason === "duplicate"
          ? "Choose one of the records in Decide; the run then repeats with that selectedId and can build a proposal."
          : decision.reason === "search"
            ? "A search only reads and ranks records."
            : "Edit the request and run it again.";
      frames.push({
        phase: "No proposal",
        line: 0,
        say: `Decide returned status “${decision.status}” (reason “${decision.reason}”), not a proposal, so applyProposal is never called. Message: “${decision.message}”`,
        vars: { status: decision.status, reason: decision.reason, proposal: null },
        stage: "before",
      });
      frames.push({
        phase: "Done",
        line: 0,
        say: `Nothing is written: the ${plural(before.length, "record")} stay exactly as they are. ${next}`,
        vars: { "records.length": before.length },
        stage: "done",
      });
      return frames;
    }
    const waiting = ctx.applied
      ? "You confirmed it, so applyProposal ran and replaced the records."
      : "Nothing is written yet. This preview runs applyProposal on a copy; the real write happens only when you confirm.";
    frames.push({
      phase: "Check",
      line: 0,
      say: `The proposal from Decide: ${
        p.intent === "create"
          ? `create “${p.title}” on ${plural(p.dates.length, "date")} at ${p.time}`
          : p.intent === "delete"
            ? `delete ${p.targetId} “${p.title}”, expecting revision ${p.expectedRevision}`
            : `move ${p.targetId} “${p.title}” to ${p.date} at ${p.time}, expecting revision ${p.expectedRevision}`
      }. ${waiting}`,
      vars: { intent: p.intent, targetId: p.targetId, expectedRevision: p.expectedRevision },
      stage: "before",
    });
    frames.push({
      phase: "Check",
      line: 1,
      say: `proposal.intent = “${p.intent}” is one of create, update, delete, so the first check passes.`,
      vars: { "proposal.intent": p.intent, valid: true },
      stage: "before",
      hold: 0.8,
    });
    if (p.intent === "create") {
      frames.push({
        phase: "Check",
        line: [2, 3],
        say: `A create needs a title, at least one date and a time: title = “${p.title}”, dates.length = ${p.dates.length}, time = “${p.time}”. All present.`,
        vars: { title: p.title, "dates.length": p.dates.length, time: p.time },
        stage: "before",
        hold: 0.9,
      });
      const ids = before.map((r) => r.id);
      const numbers = ids.map((id) => Number(id.replace("N", "")) || 0);
      const next = nextNumberOf(before);
      const named = ids.filter((id) => /^N\d+$/.test(id));
      frames.push({
        phase: "Write",
        line: 4,
        say: `Next id: remove “N” from each id and read it as a number. ${
          named.length
            ? `${named.map((id) => `${id} → ${Number(id.slice(1))}`).join(", ")}; the other ids are not numbers, so they count as 0.`
            : `${ids.join(", ")} are not numbers (NaN), so each counts as 0.`
        } max(0, ${numbers.join(", ")}) + 1 = ${next}.`,
        vars: { ids, numbers, next },
        stage: "before",
      });
      p.dates.forEach((date, i) =>
        frames.push({
          phase: "Write",
          line: 5,
          say: `New record N${next + i}: “${p.title}”, ${date}, ${p.time}, revision 1, appended after ${i ? `N${next + i - 1}` : (before.at(-1)?.id ?? "nothing")}.${
            p.dates.length > 1 ? ` Date ${i + 1} of ${p.dates.length}.` : ""
          }`,
          vars: { id: `N${next + i}`, date, time: p.time, revision: 1 },
          stage: "added",
          added: i + 1,
          hold: p.dates.length > 2 ? 0.8 : 1,
        }),
      );
    } else {
      const target = before.find((r) => r.id === p.targetId);
      frames.push({
        phase: "Check",
        line: 7,
        say: target
          ? `records.find(r => r.id === “${p.targetId}”) finds ${target.id} “${target.title}”${target.unknown ? "" : `, ${target.date} at ${target.time}`}, revision ${target.revision}.`
          : `No record has id “${p.targetId}”, so the next line throws.`,
        vars: { targetId: p.targetId, found: !!target, "target.revision": target?.revision ?? null },
        stage: "target",
      });
      const ok = !!target && target.revision === p.expectedRevision;
      frames.push({
        phase: "Check",
        line: 8,
        say: ok
          ? `Compare-and-swap: ${target.id}.revision = ${target.revision} and expectedRevision = ${p.expectedRevision} are equal, so nobody changed ${target.id} since the preview.${
              p.intent === "update" ? ` Confirming this same proposal a second time would find revision ${target.revision + 1} ≠ ${p.expectedRevision} and be refused.` : ""
            }`
          : `Compare-and-swap fails: ${target ? `${target.id}.revision = ${target.revision} ≠ expectedRevision ${p.expectedRevision}` : "the record is gone"}. applyProposal throws “${error}” and nothing is written.`,
        vars: { "target.revision": target?.revision ?? null, expectedRevision: p.expectedRevision, equal: ok },
        stage: "target",
      });
      if (ok && p.intent === "delete")
        frames.push({
          phase: "Write",
          line: 9,
          say: `records.filter(r => r.id !== “${p.targetId}”) keeps ${after.length} of ${before.length} records. ${ctx.applied ? `${p.targetId} is gone.` : `${p.targetId} is missing from the result.`}`,
          vars: { "before.length": before.length, "after.length": after.length },
          stage: "changed",
        });
      if (ok && p.intent === "update") {
        frames.push({
          phase: "Check",
          line: 10,
          say: `An update needs both values: date = “${p.date}”, time = “${p.time}”. Both present.`,
          vars: { date: p.date, time: p.time },
          stage: "target",
          hold: 0.8,
        });
        const now = after.find((r) => r.id === p.targetId);
        frames.push({
          phase: "Write",
          line: 11,
          say: oldKnown
            ? `Write ${p.targetId} as a new object: date ${target.date} → ${now.date}, time ${target.time} → ${now.time}, revision ${target.revision} → ${now.revision}. Every other record is returned unchanged.`
            : `Write ${p.targetId} as a new object: date → ${now.date}, time → ${now.time}, revision ${p.expectedRevision} → ${now.revision}. The earlier date and time are not kept once the write is done. Every other record is returned unchanged.`,
          vars: { date: now.date, time: now.time, revision: now.revision },
          stage: "changed",
        });
      }
    }
    const kinds = error ? [] : diffRows(before, after).map((r) => r.kind);
    const summary =
      ["added", "changed", "deleted"]
        .map((k) => [k, kinds.filter((x) => x === k).length])
        .filter(([, n]) => n)
        .map(([k, n]) => `${plural(n, "row")} ${k}`)
        .join(", ") || "no row changed";
    frames.push({
      phase: "Done",
      line: error ? 8 : 12,
      say: error
        ? `Nothing is written. ${error}`
        : ctx.applied
          ? `Applied. ${before.length} records → ${after.length}: ${summary}; every other record is identical.`
          : `Preview: ${before.length} records → ${after.length}: ${summary}. This waits for your confirmation; the button above runs the same function on the real records.`,
      vars: { "before.length": before.length, "after.length": after.length, applied: !!ctx.applied },
      stage: error ? "before" : "done",
    });
    return frames;
  },
  Stage({ ctx, frame }) {
    const { p, before, after, error } = plan(ctx);
    const rows = diffRows(before, after);
    const stage = frame.stage;
    const visible = rows.filter((r) => {
      if (r.kind === "added") return stage === "done" || (stage === "added" && r.order < frame.added);
      return true;
    });
    const showChange = (r) =>
      !error &&
      (stage === "done" || (stage === "changed" && r.kind !== "same") || (stage === "added" && r.kind === "added"));
    const cell = (r, f) => {
      const a = r.before?.[f];
      const b = r.after?.[f];
      if (r.kind === "changed" && showChange(r) && a !== b)
        return (
          <span key={f}>
            <span className="p-old">{r.before.unknown && (f === "date" || f === "time") ? "earlier" : String(a)}</span>
            <span className="p-new">{String(b)}</span>
          </span>
        );
      const v = r.kind === "added" ? b : a;
      return <span key={f}>{v === null || v === undefined ? "—" : String(v)}</span>;
    };
    const isTarget = (r) => p && r.id === p.targetId && (stage === "target" || stage === "changed");
    return (
      <div className="x-stack">
        {p && (
          <Panel title="proposal">
            <dl className="p-kv">
              <dt>intent</dt>
              <dd>{p.intent}</dd>
              <dt>targetId</dt>
              <dd>{p.targetId ?? "null"}</dd>
              <dt>expectedRevision</dt>
              <dd>{p.expectedRevision ?? "null"}</dd>
              <dt>title</dt>
              <dd>“{p.title}”</dd>
              <dt>date / time</dt>
              <dd>
                {p.date ?? "null"} / {p.time ?? "null"}
              </dd>
              <dt>dates</dt>
              <dd>[{p.dates.join(", ")}]</dd>
            </dl>
          </Panel>
        )}
        {!p && (
          <Panel title={`decision: ${ctx.trace.decision.status} (${ctx.trace.decision.reason})`}>
            <p className="p-message">{ctx.trace.decision.message}</p>
          </Panel>
        )}
        <Panel
          title={
            !p
              ? `Records (${before.length}, unchanged)`
              : stage === "done"
                ? `Records: before → after (${before.length} → ${after.length})`
                : `Records (${before.length})`
          }
          note={
            !p
              ? "applyProposal is not called."
              : error
                ? error
                : ctx.applied
                  ? "Applied after you confirmed."
                  : "A preview on a copy. Waiting for your confirmation."
          }
        >
          <Table className="p-table"
            head={["id", ...FIELDS, "change"]}
            rows={visible.map((r) => ({
              cls: isTarget(r)
                ? "is-active"
                : showChange(r)
                  ? r.kind === "deleted"
                    ? "p-deleted"
                    : r.kind === "added"
                      ? "p-added"
                      : r.kind === "changed"
                        ? "p-changed"
                        : ""
                  : "",
              cells: [
                <strong key="id">{r.id}</strong>,
                ...FIELDS.map((f) => cell(r, f)),
                showChange(r) && r.kind !== "same" ? (
                  <Tag key="k" kind={r.kind === "deleted" ? "dropped" : "kept"}>
                    {r.kind}
                  </Tag>
                ) : (
                  ""
                ),
              ],
            }))}
          />
        </Panel>
      </div>
    );
  },
};

// Row-by-row comparison by id: same, changed, deleted, added.
function diffRows(before, after) {
  const out = before.map((b) => {
    const a = after.find((x) => x.id === b.id);
    if (!a) return { id: b.id, kind: "deleted", before: b, after: null };
    const same = FIELDS.every((f) => a[f] === b[f]) && !b.unknown;
    return { id: b.id, kind: same ? "same" : "changed", before: b, after: a };
  });
  after
    .filter((a) => !before.some((b) => b.id === a.id))
    .forEach((a, i) => out.push({ id: a.id, kind: "added", before: null, after: a, order: i }));
  return out;
}

// ---- Map layer ----

const COLS = ["id", "title", "date", "time", "rev", "change"];
const FIELD_COL = { title: 1, date: 2, time: 3, revision: 4 };

// Rows of the "records" block and of the "applychecks" block.
const mapCache = new WeakMap();
function mapModel(ctx) {
  const hit = mapCache.get(ctx);
  if (hit) return hit;
  const pl = plan(ctx);
  const { p, before, after, error } = pl;
  const rows = error || !p ? before.map((b) => ({ id: b.id, kind: "same", before: b, after: b })) : diffRows(before, after);
  const target = p ? rows.findIndex((r) => r.id === p.targetId) : -1;
  const ok = !!p && !error;
  let checks;
  if (!p)
    checks = [
      { label: "decision.status", value: `“${ctx.trace.decision.status}”`, result: { text: "≠ proposal", tone: "warn" } },
      { label: "applyProposal", value: "not called", result: { text: "no write", tone: "muted" } },
    ];
  else {
    const valid = { label: "valid intent", value: `“${p.intent}”`, result: { text: "ok", tone: "good" } };
    if (p.intent === "create") {
      const next = nextNumberOf(before);
      checks = [
        valid,
        { label: "title, dates, time present", value: `${p.dates.length} date${p.dates.length === 1 ? "" : "s"}, ${p.time}`, result: { text: "ok", tone: "good" } },
        { label: "next id = max(N numbers) + 1", value: `max(0, …) + 1 = ${next}`, result: { text: `N${next}`, tone: "good", bold: true } },
      ];
    } else {
      const t = before.find((r) => r.id === p.targetId);
      const same = !!t && t.revision === p.expectedRevision;
      checks = [
        valid,
        { label: "find the target record", value: `id = “${p.targetId}”`, result: t ? { text: "found", tone: "good" } : { text: "missing", tone: "warn" } },
        {
          label: "revision = expectedRevision",
          value: `${t?.revision ?? "—"} = ${p.expectedRevision}`,
          result: same ? { text: "equal", tone: "good" } : { text: "changed", tone: "warn", bold: true },
        },
      ];
      if (p.intent === "update")
        checks.push({
          label: "date and time present",
          value: `${p.date} ${p.time}`,
          result: same ? { text: "ok", tone: "good" } : { text: "not reached", tone: "muted" },
        });
    }
  }
  const out = { ...pl, rows, target, ok, checks };
  mapCache.set(ctx, out);
  return out;
}
const changedCols = (r) =>
  r.kind === "added"
    ? COLS.map((_, c) => c)
    : r.kind === "deleted"
      ? [5]
      : r.kind === "changed"
        ? [...Object.entries(FIELD_COL).filter(([f]) => r.before[f] !== r.after[f]).map(([, c]) => c), 5]
        : [];

function cellsOf(frame, ctx) {
  const M = mapModel(ctx);
  const { trace } = ctx;
  const fired = trace.rules.findIndex((r) => r.hit);
  const dRow = (key) => {
    const i = decisionRow(trace, key);
    return i >= 0 ? [[i, 1]] : [];
  };
  const checkCells = (i) => (i < M.checks.length ? [[i, 1], [i, 2]] : []);
  if (!M.p)
    return frame.phase === "Done"
      ? { applychecks: { active: checkCells(1) }, records: { source: [] } }
      : { rules: { source: [[fired, 3]] }, decision: { source: dRow("status") }, applychecks: { active: checkCells(0) } };
  const line = [].concat(frame.line)[0];
  const t = M.target;
  if (frame.phase === "Done") {
    const changed = M.rows.flatMap((r, i) => (r.kind === "same" ? [] : [[i, 5]]));
    return M.error ? { applychecks: { source: checkCells(2) } } : { records: { active: changed } };
  }
  switch (line) {
    case 0:
      return { decision: { source: ["intent", "targetId", "expectedRevision", "title", "date / time", "dates"].flatMap(dRow) } };
    case 1:
      return { decision: { source: dRow("intent") }, applychecks: { active: checkCells(0) } };
    case 2:
      return { decision: { source: [...dRow("title"), ...dRow("dates"), ...dRow("date / time")] }, applychecks: { active: checkCells(1) } };
    case 4:
      return {
        records: { source: M.rows.map((r, i) => (r.kind === "added" ? null : [i, 0])).filter(Boolean) },
        applychecks: { active: checkCells(2) },
      };
    case 5: {
      const added = M.rows.map((r, i) => (r.kind === "added" ? i : -1)).filter((i) => i >= 0);
      const i = added[frame.added - 1];
      return { applychecks: { source: [[2, 2]] }, records: { active: i === undefined ? [] : row(i, COLS.length) } };
    }
    case 7:
      return { decision: { source: dRow("targetId") }, records: { source: t >= 0 ? [[t, 0]] : [] }, applychecks: { active: checkCells(1) } };
    case 8:
      return {
        decision: { source: dRow("expectedRevision") },
        records: { source: t >= 0 ? [[t, 4]] : [] },
        applychecks: { active: checkCells(2) },
      };
    case 9:
      return { applychecks: { source: checkCells(2) }, records: { active: t >= 0 ? [[t, 5]] : [] } };
    case 10:
      return { decision: { source: dRow("date / time") }, applychecks: { active: checkCells(3) } };
    case 11:
      return {
        decision: { source: dRow("date / time") },
        records: { active: t >= 0 ? changedCols(M.rows[t]).map((c) => [t, c]) : [] },
      };
    default:
      return {};
  }
}

const was = (v) => (v === null || v === undefined ? undefined : `was ${v}`);

Object.assign(mod, {
  blocks(ctx) {
    const M = mapModel(ctx);
    const status = !M.p ? "unchanged" : M.error ? "nothing written" : ctx.applied ? "applied" : "preview, waits for confirm";
    return [
      tableBlock({
        id: "applychecks",
        title: M.p ? `applyProposal(records, proposal) · ${M.p.intent}` : "applyProposal is not called",
        head: ["check", "value", "result"],
        widths: [3.2, 3, 1.3],
        rows: M.checks.map((c) => [{ text: c.label, align: "left" }, { text: c.value, align: "left" }, c.result]),
      }),
      tableBlock({
        id: "records",
        title: `records · ${status}`,
        head: COLS,
        widths: [0.5, 2.7, 1.6, 0.85, 0.5, 1.1],
        rows: M.rows.map((r) => {
          const v = r.kind === "added" ? r.after : r.before;
          const now = r.after ?? r.before;
          const cols = new Set(changedCols(r));
          const cell = (f) => {
            const changed = r.kind === "changed" && cols.has(FIELD_COL[f]);
            if (r.kind === "added") return { text: String(now[f]), tone: "good" };
            if (changed)
              return { text: String(now[f]), tone: "good", bold: true, sub: r.before.unknown && f !== "revision" ? undefined : was(r.before[f]) };
            return { text: String(v[f] ?? "—"), dim: r.kind === "deleted" };
          };
          return [
            { text: r.id, bold: true, tone: r.kind === "deleted" ? "warn" : r.kind === "same" ? undefined : "good" },
            { ...cell("title"), align: "left" },
            cell("date"),
            cell("time"),
            cell("revision"),
            r.kind === "same"
              ? { text: "—", tone: "muted" }
              : { text: r.kind, tone: r.kind === "deleted" ? "warn" : "good", bold: true },
          ];
        }),
      }),
    ];
  },
  output: "records",
  state(frame, ctx) {
    const M = mapModel(ctx);
    return revealState(mod, frame, ctx, cellsOf, {
      applychecks: (r, c) => c === 0,
      records: (r, c) => {
        const x = M.rows[r];
        return !x || !changedCols(x).includes(c);
      },
    });
  },
  math(frame, ctx) {
    const M = mapModel(ctx);
    const { trace } = ctx;
    const p = M.p;
    if (!p)
      return frame.phase === "Done"
        ? [{ label: "records", terms: [`${M.before.length} unchanged`] }]
        : [{ label: "decision.status", terms: [`“${trace.decision.status}”`], result: "not “proposal”" }];
    if (frame.phase === "Done")
      return M.error
        ? [{ label: "write", terms: ["refused"], result: "0 changes" }]
        : [{ label: "records.length", terms: [`${M.before.length} → ${M.after.length}`] }];
    const line = [].concat(frame.line)[0];
    const t = M.rows[M.target];
    switch (line) {
      case 1:
        return [{ label: "valid intent", terms: [`“${p.intent}”`], result: "true" }];
      case 2:
        return [
          { label: "title", terms: [`“${p.title}”`] },
          { label: "dates.length", terms: [String(p.dates.length)] },
          { label: "time", terms: [`“${p.time}”`] },
        ];
      case 4: {
        const ids = M.before.map((r) => r.id);
        const nums = ids.map((id) => Number(id.replace("N", "")) || 0);
        const next = nextNumberOf(M.before);
        return [
          { label: "Number(id − “N”) || 0", terms: ids.slice(0, 8).map((id, i) => `${id}→${nums[i]}`), op: "," },
          { label: "next", terms: [`max(0, ${[...new Set(nums)].join(", ")})`, "1"], result: String(next) },
        ];
      }
      case 5: {
        const next = nextNumberOf(M.before);
        const i = frame.added - 1;
        return [{ label: `N${next + i}`, terms: [p.dates[i], p.time], op: " at ", result: "revision 1" }];
      }
      case 7:
        return [{ label: "find", terms: [`r.id === “${p.targetId}”`], result: t ? `${t.id} (row ${M.target})` : "undefined" }];
      case 8:
        return [{ label: "revision check", terms: [String(t?.before?.revision ?? "—"), String(p.expectedRevision)], op: "===", result: String(!M.error) }];
      case 9:
        return [{ label: "filter", terms: [`r.id !== “${p.targetId}”`], result: `${M.after.length} of ${M.before.length} kept` }];
      case 10:
        return [{ label: "date, time", terms: [String(p.date), String(p.time)], op: "," }];
      case 11: {
        const now = t?.after;
        if (!now) return [];
        return [
          { label: "date", terms: [`${t.before.unknown ? "earlier" : t.before.date} → ${now.date}`] },
          { label: "time", terms: [`${t.before.unknown ? "earlier" : t.before.time} → ${now.time}`] },
          { label: "revision", terms: [String(t.before.revision), "1"], result: String(now.revision) },
        ];
      }
      default:
        return [];
    }
  },
});

const rawFrames = mod.frames;
mod.frames = (ctx) => indexed(rawFrames.call(mod, ctx));

export default mod;
