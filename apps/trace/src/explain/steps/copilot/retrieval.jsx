import { Panel, Table, Tag } from "../../kit.jsx";
import { CANDIDATES, MAX_DISTANCE, RETRIEVAL_LIMIT, tokens, VECTOR_COLS } from "../../../engine/copilot.js";
import { all, row, tableBlock } from "../../../map/blocks.js";
import { messageOf, OUTCOME_TEXT, plural, retrievalOf, serverRows, serverSearchesOf, short } from "./util.js";

const cellOf = (slot) => [Math.floor(slot / VECTOR_COLS), slot % VECTOR_COLS];
const f3 = (v) => v.toFixed(3);

const verdict = (s) => (s.reason ? `drop: ${s.reason}` : "keep");

function funnelRows(r) {
  const count = (test) => r.candidates.filter((s) => s.reason && test(s.reason)).length;
  return [
    ["your records in this browser", String(r.records.length)],
    ["not approved for AI (never read)", `−${r.hidden.length}`],
    ["scored", String(r.scored.length)],
    [`${CANDIDATES} nearest (candidates)`, String(r.candidates.length)],
    [`distance > ${MAX_DISTANCE}`, `−${count((x) => x.startsWith("distance"))}`],
    ["type not indexed, record gone, stale revision", "server only"],
    ["no shared word (hash collision)", `−${count((x) => x.startsWith("no shared"))}`],
    [`over the limit of ${RETRIEVAL_LIMIT}`, `−${count((x) => x.startsWith("limit"))}`],
    ["kept", String(r.kept.length)],
  ];
}

// The server's citations next to the browser's kept list.
function comparison(ctx) {
  const r = retrievalOf(ctx);
  const res = ctx.copilot.response;
  const cites = res?.citations ?? [];
  const keptIds = r.kept.map((k) => String(k.record.id));
  const matched = cites.filter((c) => keptIds.includes(String(c.record_id)));
  const missing = cites.filter((c) => !keptIds.includes(String(c.record_id)));
  const parts = [];
  if (!r.readable.length) parts.push("This browser has no readable records, so it cannot check the server's pick.");
  else if (cites.length)
    parts.push(
      matched.length
        ? `The reply cited ${matched.map((c) => `“${c.title}” (${c.citation_id})`).join(", ")}, which this browser also kept${matched.length === 1 ? `, at rank ${keptIds.indexOf(String(matched[0].record_id)) + 1}` : ""}.`
        : "None of the reply's citations are in this browser's kept list.",
    );
  else parts.push("The reply cited no sources.");
  if (missing.length)
    parts.push(
      `${missing.map((c) => `“${c.title}”`).join(", ")} ${missing.length === 1 ? "is" : "are"} not in the browser's list: ${res.steps?.length ? "it may come from the server's own lookups, " : ""}a record or revision this browser does not have, or the server's index.`,
    );
  const count = res?.retrieval?.result_count;
  if (typeof count === "number")
    parts.push(
      count === r.kept.length
        ? `The server also found ${count} result${count === 1 ? "" : "s"}.`
        : `The server reported ${count} search result${count === 1 ? "" : "s"}, this browser kept ${r.kept.length}; citations list only the sources the answer used, and the server's records or revisions can differ from these.`,
    );
  return { say: parts.join(" "), rows: matched.map((c) => keptIds.indexOf(String(c.record_id))).map((i) => r.keptRows[i]) };
}

export default {
  id: "retrieval",
  source: [
    ["copilot", "cosineDistance"],
    ["copilot", "recordText"],
    ["copilot", "retrieve"],
  ],
  code: [
    "const q = vectorize(query)",
    "const readable = records.filter((r) => r.approvedForAi !== false)",
    "for (const record of readable) {",
    "  const d = vectorize(recordText(record), record.title)",
    "  const shared = tokens(text).filter((t) => queryTokens.has(t))",
    "  const distance = 1 - dot(q, d) / (norm(q) * norm(d))",
    "}",
    "const candidates = scored.sort(byDistance).slice(0, 25)",
    "for (const s of candidates) {",
    "  if (s.distance > 0.98) drop",
    "  else if (!s.shared.length) drop",
    "  else if (kept.length < 5) kept.push(s)",
    "}",
    "return kept",
  ],
  frames(ctx) {
    const r = retrievalOf(ctx);
    const n = r.candidates.length;
    const rows = Math.max(1, n);
    const end = { scored: rows, filtered: rows, funnel: true };
    const frames = [];
    const hiddenNote = r.hidden.length
      ? ` ${plural(r.hidden.length, "record")} (${r.hidden.map((x) => `“${x.title}”`).join(", ")}) ${r.hidden.length === 1 ? "is" : "are"} not approved for AI: the copilot never reads ${r.hidden.length === 1 ? "it" : "them"}, so this page leaves ${r.hidden.length === 1 ? "it" : "them"} out too.`
      : "";
    if (r.skipped) {
      frames.push({
        phase: "Skip",
        line: 0,
        say: `Every word of the query is a stopword, so the server skips the search and no records are compared.`,
        vars: { "q.size": 0 },
        at: -1,
        ...end,
      });
    } else if (!r.readable.length) {
      frames.push({
        phase: "Query",
        line: 0,
        say: `The query vector has ${plural(r.q.vector.size, "non-zero box", "non-zero boxes")}, but there are no readable records in this browser to compare it with.${hiddenNote}`,
        vars: { "records.length": r.records.length },
        at: -1,
        ...end,
      });
    } else {
      const na = r.scored[0]?.na ?? 0;
      frames.push({
        phase: "Query",
        line: [0, 1],
        say: `Compare the query vector (${plural(r.q.vector.size, "non-zero box", "non-zero boxes")}, ‖q‖ = ${f3(na)}) with ${plural(r.readable.length, "record")} in this browser, nearest first.${hiddenNote}`,
        vars: { "q.size": r.q.vector.size, "‖q‖": +na.toFixed(4), records: r.readable.length },
        at: -1,
        scored: 0,
        filtered: 0,
        query: true,
      });
      r.candidates.forEach((s, i) =>
        frames.push({
          phase: "Score",
          line: [3, 4, 5],
          say: `“${short(s.record.title, 40)}” (${s.record.type}): ${plural(s.d.rows.length, "distinct word")}${s.shared.length ? `, sharing ${s.shared.join(", ")} with the query` : ", none shared with the query"}. dot = ${f3(s.dot)}, ‖q‖ = ${f3(s.na)}, ‖d‖ = ${f3(s.nb)}, so distance = ${f3(s.distance)}.`,
          vars: { record: s.record.id, shared: s.shared, dot: +s.dot.toFixed(4), "‖d‖": +s.nb.toFixed(4), distance: +s.distance.toFixed(4) },
          at: i,
          scored: i + 1,
          filtered: 0,
          score: true,
          hold: 0.8,
        }),
      );
      frames.push({
        phase: "Sort",
        line: 7,
        say:
          r.scored.length > CANDIDATES
            ? `Sorted by distance, the ${CANDIDATES} nearest become candidates; the other ${r.scored.length - CANDIDATES} are not considered.`
            : `Sorted by distance. All ${r.scored.length} fit in the ${CANDIDATES} nearest, so all are candidates.`,
        vars: { candidates: n },
        at: -1,
        scored: n,
        filtered: 0,
      });
      r.candidates.forEach((s, i) =>
        frames.push({
          phase: "Filter",
          line: !s.reason ? 11 : s.reason.startsWith("distance") ? 9 : s.reason.startsWith("no shared") ? 10 : 11,
          say: !s.reason
            ? `“${short(s.record.title, 40)}”: distance ${f3(s.distance)} ≤ ${MAX_DISTANCE}, approved, and it shares a real word, so it is kept (${r.kept.indexOf(s) + 1} of at most ${RETRIEVAL_LIMIT}).`
            : s.reason.startsWith("distance")
              ? `“${short(s.record.title, 40)}”: distance ${f3(s.distance)} is above ${MAX_DISTANCE}, so it is dropped.`
              : s.reason.startsWith("no shared")
                ? `“${short(s.record.title, 40)}”: its vector overlaps the query only through a hash collision, with no word in common, so it is dropped.`
                : `“${short(s.record.title, 40)}”: ${RETRIEVAL_LIMIT} records are already kept, so it is dropped.`,
          vars: { record: s.record.id, distance: +s.distance.toFixed(4), shared: s.shared.length, kept: r.kept.filter((k) => r.candidates.indexOf(k) <= i).length },
          at: i,
          scored: n,
          filtered: i + 1,
          filter: true,
          hold: 0.6,
        }),
      );
      frames.push({
        phase: "Funnel",
        line: [8, 9, 10, 11],
        say: `The server applies more filters than the browser can: index type, deleted records and stale revisions are checked there only. It also drops unapproved records after the ${CANDIDATES}-nearest cut, where this page leaves them out before scoring.`,
        vars: { scored: r.scored.length, candidates: n, kept: r.kept.length },
        at: -1,
        ...end,
      });
      frames.push({
        phase: "Kept",
        line: 13,
        say: r.kept.length
          ? `Kept ${r.kept.length}: ${r.kept.map((k) => `“${short(k.record.title, 30)}”`).join(", ")}. The server numbers its own hits S1 to S${RETRIEVAL_LIMIT} for the prompt.`
          : "Nothing survives the filters, so the prompt carries no search sources.",
        vars: { kept: r.kept.map((k) => k.record.id) },
        at: -1,
        ...end,
        kept: true,
      });
    }
    if (ctx.copilot.response) {
      const cmp = comparison(ctx);
      frames.push({
        phase: "Compare",
        line: 13,
        say: r.skipped ? `The server skipped the search too. ${cmp.say}` : cmp.say,
        vars: {
          cited: (ctx.copilot.response.citations ?? []).map((c) => c.record_id),
          browser: r.kept.map((k) => k.record.id),
        },
        at: -1,
        ...end,
        compare: true,
      });
    }
    // The server's real ranking, when the reply carried it.
    const searches = serverSearchesOf(ctx);
    if (searches.length) {
      const rowsAll = serverRows(ctx);
      const real = { ...end, server: rowsAll.length };
      frames.push({
        phase: "Server",
        line: [7, 8],
        say: `Now the real thing: the server reported ${plural(searches.length, "search", "searches")} for this reply, with every candidate's distance and what the filters did. These are the server's values, not a recomputation.`,
        vars: { searches: searches.length, candidates: rowsAll.length },
        at: -1,
        ...real,
        server: 0,
      });
      rowsAll.forEach((c, k) => {
        const same = c.browser !== undefined && Math.abs(c.browser - c.distance) < 5e-6;
        frames.push({
          phase: "Server",
          line: c.outcome === "kept" ? 11 : c.outcome === "too_far" ? 9 : c.outcome === "no_shared_word" ? 10 : 8,
          say: `${c.search === 0 ? "Opening search" : `Lookup ${c.search}`}, rank ${c.rank}: ${c.title ? `“${short(c.title, 40)}”` : "a record the trace does not name"} at distance ${f3(c.distance)} — ${OUTCOME_TEXT[c.outcome] ?? c.outcome}.${c.citation_id ? ` Shown to the model as ${c.citation_id}.` : ""}${c.browser !== undefined ? (same ? " The browser computed the same distance." : ` The browser computed ${f3(c.browser)}; the record may have changed since it was indexed.`) : ""}`,
          vars: { rank: c.rank, distance: c.distance, outcome: c.outcome, ...(c.citation_id ? { citation: c.citation_id } : {}) },
          at: -1,
          ...real,
          server: k + 1,
          serverAt: k,
          hold: 0.55,
        });
      });
      const kept = rowsAll.filter((c) => c.outcome === "kept");
      frames.push({
        phase: "Server",
        line: 13,
        say: kept.length
          ? `The server kept ${plural(kept.length, "record")} across these searches: ${kept.map((c) => (c.title ? `“${short(c.title, 30)}”` : c.record_id)).join(", ")}.`
          : "The server's searches kept nothing; the reply rests on the planner briefing or on no records.",
        vars: { kept: kept.map((c) => c.record_id) },
        at: -1,
        ...real,
      });
    }
    return frames;
  },
  blocks(ctx) {
    const r = retrievalOf(ctx);
    const rows = r.candidates.length
      ? r.candidates.map((s) => [
          { text: short(s.record.title, 22), full: s.record.title, align: "left" },
          { text: s.record.type, dim: true },
          { text: s.shared.join(" ") || "—", tone: s.shared.length ? "keyword" : "muted" },
          { text: f3(s.distance), value: s.distance },
          { text: s.reason ? "drop" : "keep", tone: s.reason ? "muted" : "good", full: verdict(s) },
        ])
      : [[{ text: r.skipped ? "search skipped" : "no records", dim: true }, "", "", "", { text: "—", tone: "muted" }]];
    return [
      tableBlock({
        id: "cscores",
        title: "distance = 1 − q·d / (‖q‖ ‖d‖)",
        head: ["record", "type", "shared words", "distance", "result"],
        widths: [2.1, 0.9, 2, 1, 0.8],
        rows,
      }),
      tableBlock({
        id: "cfunnel",
        title: "filters, in the server's order",
        head: ["stage", "count"],
        widths: [3.6, 1.1],
        rows: funnelRows(r).map(([stage, count]) => [
          { text: stage, align: "left", dim: count === "server only" },
          { text: count, tone: count === "server only" ? "muted" : count.startsWith("−") ? "warn" : "number" },
        ]),
      }),
      ...(serverSearchesOf(ctx).length
        ? [
            tableBlock({
              id: "cserver",
              title: "the server's real search: rank, distance, outcome",
              head: ["search", "rank", "record", "server", "browser", "outcome", "cite"],
              widths: [0.8, 0.6, 2.1, 0.9, 0.9, 1.6, 0.6],
              rows: serverRows(ctx).map((c) => [
                { text: c.search === 0 ? "opening" : `lookup ${c.search}`, dim: true },
                String(c.rank),
                c.title
                  ? { text: short(c.title, 24), full: c.title, align: "left" }
                  : { text: "not named", tone: "muted", full: OUTCOME_TEXT[c.outcome] },
                { text: f3(c.distance), value: c.distance },
                c.browser !== undefined ? { text: f3(c.browser), value: c.browser, dim: true } : { text: "—", tone: "muted" },
                { text: c.outcome.replaceAll("_", " "), tone: c.outcome === "kept" ? "good" : "muted", full: OUTCOME_TEXT[c.outcome] },
                c.citation_id ? { text: c.citation_id, tone: "accent" } : "",
              ]),
            }),
          ]
        : []),
    ];
  },
  output: "cscores",
  state(frame, ctx) {
    const r = retrievalOf(ctx);
    const s = frame.at >= 0 ? r.candidates[frame.at] : null;
    const qCells = [...r.q.vector.keys()].map(cellOf);
    const tokenRows = (words) =>
      tokens(messageOf(ctx).query)
        .map((t, i) => (words.includes(t) ? [i, 1] : null))
        .filter(Boolean);
    return {
      cvector: { source: frame.query || frame.score ? qCells : [] },
      ctokens: { source: frame.score && s ? tokenRows(s.shared) : [] },
      cscores: {
        done: (row_, c) => (c < 4 ? row_ < frame.scored : row_ < frame.filtered),
        active: frame.score && s ? row(frame.at, 4) : frame.filter && s ? [[frame.at, 4]] : frame.kept ? r.keptRows.map((i) => [i, 4]) : [],
        source: frame.compare ? comparison(ctx).rows.flatMap((i) => row(i, 5)) : [],
      },
      cfunnel: { done: () => !!frame.funnel, active: frame.phase === "Funnel" ? all(9, 2) : [] },
      ...(serverSearchesOf(ctx).length
        ? {
            cserver: {
              done: (r_) => frame.server === undefined ? false : r_ < frame.server || frame.server >= serverRows(ctx).length,
              active: frame.serverAt !== undefined ? row(frame.serverAt, 7) : [],
              source: (() => {
                const c = frame.serverAt !== undefined ? serverRows(ctx)[frame.serverAt] : null;
                const i = c?.record_id != null ? r.candidates.findIndex((x) => String(x.record.id) === String(c.record_id)) : -1;
                return i >= 0 ? row(i, 5) : [];
              })(),
            },
          }
        : {}),
    };
  },
  math(frame, ctx) {
    const r = retrievalOf(ctx);
    if (frame.serverAt !== undefined) {
      const c = serverRows(ctx)[frame.serverAt];
      return [
        { label: "server", terms: [`distance ${f3(c.distance)}`], op: "", result: c.outcome.replaceAll("_", " ") },
        ...(c.browser !== undefined
          ? [{ label: "browser", terms: [`distance ${f3(c.browser)}`], op: "", result: Math.abs(c.browser - c.distance) < 5e-6 ? "same" : "differs" }]
          : []),
      ];
    }
    const s = frame.at >= 0 ? r.candidates[frame.at] : null;
    if (!s) return [];
    if (frame.filter)
      return [{ label: "distance ≤ 0.98", terms: [f3(s.distance)], op: "", result: verdict(s) }];
    const terms = [...r.q.vector]
      .filter(([slot]) => s.d.vector.has(slot))
      .map(([slot, v]) => `${v.toFixed(2)}×${s.d.vector.get(slot).toFixed(2)}`);
    return [
      { label: "q · d", terms: terms.length ? terms : ["0"], result: f3(s.dot) },
      { label: "distance", terms: ["1", `${f3(s.dot)} / (${f3(s.na)} × ${f3(s.nb)})`], op: "−", result: f3(s.distance) },
    ];
  },
  Stage({ ctx, frame }) {
    const r = retrievalOf(ctx);
    return (
      <div className="x-stack">
        <Panel
          title="Nearest records"
          note={r.hidden.length ? `${plural(r.hidden.length, "record")} not approved for AI ${r.hidden.length === 1 ? "is" : "are"} left out.` : undefined}
        >
          <Table
            head={["record", "shared words", "distance", "result"]}
            active={frame.at}
            rows={r.candidates.map((s, i) =>
              i < frame.scored
                ? [
                    s.record.title,
                    s.shared.join(", ") || "—",
                    f3(s.distance),
                    i < frame.filtered ? <Tag key="t" kind={s.reason ? "dropped" : "kept"}>{verdict(s)}</Tag> : "",
                  ]
                : { cls: "is-pending", cells: ["", "", "", ""] },
            )}
          />
        </Panel>
        {frame.funnel && (
          <Panel title="Filters">
            <Table head={["stage", "count"]} rows={funnelRows(r)} />
          </Panel>
        )}
      </div>
    );
  },
};
