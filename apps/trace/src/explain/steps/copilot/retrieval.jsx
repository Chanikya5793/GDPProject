import { Panel, Table, Tag } from "../../kit.jsx";
import { tokens } from "../../../engine/copilot.js";
import { all, row, tableBlock } from "../../../map/blocks.js";
import {
  DEFAULT_PARAMS,
  f3,
  gridOf,
  isWhatIf,
  messageOf,
  OUTCOME_TEXT,
  paramsOf,
  plural,
  retrievalOf,
  serverRows,
  serverSearchesOf,
  short,
  whatIfNote,
} from "./util.js";

const verdict = (s) => (s.reason ? `drop: ${s.reason}` : "keep");
// Whose numbers the browser's recomputation shows.
const whose = (ctx) => (isWhatIf(ctx) ? "your what-if settings" : "the server's default settings");

function funnelRows(r, p) {
  const count = (test) => r.candidates.filter((s) => s.reason && test(s.reason)).length;
  return [
    ["your records in this browser", String(r.records.length)],
    ["not approved for AI (never read)", `−${r.hidden.length}`],
    [r.known ? "type kept out by your AI settings" : "type kept out by your AI settings (not reported)", r.known ? `−${r.offType.length}` : "server only"],
    ["scored", String(r.scored.length)],
    [`${p.candidates} nearest (candidates)`, String(r.candidates.length)],
    [`over the limit of ${p.limit} (checked first)`, `−${count((x) => x.startsWith("limit"))}`],
    [`distance > ${p.maxDistance}`, `−${count((x) => x.startsWith("distance"))}`],
    ["record gone, stale revision", "server only"],
    p.requireShared
      ? ["no shared word (hash collision)", `−${count((x) => x.startsWith("no shared"))}`]
      : ["no shared word (filter off in your settings)", "off"],
    ["kept", String(r.kept.length)],
  ];
}

const FUNNEL_HELP = [
  { meaning: "Every record this page can see.", formula: "records.length" },
  { meaning: "Records you did not approve for AI. The copilot never reads them, so they are left out before scoring.", formula: "records.filter((r) => r.approvedForAi === false)" },
  { meaning: "Record types your privacy settings keep away from the assistant are never indexed. The server reports the setting with the reply.", formula: "!indexed_entity_types.includes(r.type)" },
  { meaning: "Records given a distance to the query.", formula: "readable.map((r) => distance(q, vectorize(r)))" },
  { meaning: "Only the nearest few are looked at further.", formula: "scored.sort(byDistance).slice(0, candidates)" },
  { meaning: "At most this many sources go into the prompt. The server checks this before anything else, so a far record after the limit counts here.", formula: "kept.length ≥ limit → drop" },
  { meaning: "Records too far from the query are dropped.", formula: "distance > maxDistance → drop" },
  { meaning: "Filters only the server can apply: it knows which records still exist and the revision each vector was made from.", formula: "server only" },
  { meaning: "A record can look close only because two different words share a box. This filter drops it unless a real word is shared.", formula: "requireShared && shared.length === 0 → drop" },
  { meaning: "The records that become sources for the LLM.", formula: "kept = candidates that pass every filter" },
];

// The server's citations next to the browser's kept list.
function comparison(ctx) {
  const r = retrievalOf(ctx);
  const res = ctx.copilot.response;
  const tuned = isWhatIf(ctx);
  const mine = tuned ? "your what-if" : "this browser";
  const cites = res?.citations ?? [];
  const keptIds = r.kept.map((k) => String(k.record.id));
  const matched = cites.filter((c) => keptIds.includes(String(c.record_id)));
  const missing = cites.filter((c) => !keptIds.includes(String(c.record_id)));
  const parts = [];
  if (tuned) parts.push("The server ran on its default settings, so its pick below is real and yours is a what-if.");
  if (!r.readable.length) parts.push("This browser has no readable records, so it cannot check the server's pick.");
  else if (cites.length)
    parts.push(
      matched.length
        ? `The reply cited ${matched.map((c) => `“${c.title}” (${c.citation_id})`).join(", ")}, which ${mine} also kept${matched.length === 1 ? `, at rank ${keptIds.indexOf(String(matched[0].record_id)) + 1}` : ""}.`
        : `None of the reply's citations are in ${mine}'s kept list.`,
    );
  else parts.push("The reply cited no sources.");
  if (missing.length)
    parts.push(
      tuned
        ? `${missing.map((c) => `“${c.title}”`).join(", ")} ${missing.length === 1 ? "was" : "were"} cited by the server but ${missing.length === 1 ? "is" : "are"} not kept with your settings.`
        : `${missing.map((c) => `“${c.title}”`).join(", ")} ${missing.length === 1 ? "is" : "are"} not in the browser's list: ${res.steps?.length ? "it may come from the server's own lookups, " : ""}a record or revision this browser does not have, or the server's index.`,
    );
  const opening = res?.retrieval?.searches?.[0];
  if (opening) {
    const count = opening.candidates.filter((c) => c.outcome === "kept").length;
    parts.push(
      count === r.kept.length
        ? `The server's opening search also kept ${plural(count, "record")}.`
        : `The server's opening search kept ${plural(count, "record")} (default settings); ${mine} kept ${r.kept.length}.${tuned ? "" : " The server's records or revisions can differ from the ones in this browser."}`,
    );
  }
  parts.push("Citations list only the records the answer used, and those can come from the briefing as well as the search.");
  return { say: parts.join(" "), rows: matched.map((c) => keptIds.indexOf(String(c.record_id))).map((i) => r.keptRows[i]) };
}

// The server's distance next to the browser's for one server candidate.
function serverCheck(c, tuned) {
  if (c.browser === undefined) return "";
  const same = Math.abs(c.browser - c.distance) < 5e-6;
  if (tuned) return same ? " Your settings give the same distance." : ` Your settings give ${f3(c.browser)}, a what-if; the server's ${f3(c.distance)} used the defaults.`;
  return same ? " The browser computed the same distance." : ` The browser computed ${f3(c.browser)}; the record may have changed since it was indexed.`;
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
    "const readable = records.filter((r) => r.approvedForAi !== false && indexed(r.type))",
    "for (const record of readable) {",
    "  const d = vectorize(recordText(record), record.title)",
    "  const shared = tokens(text).filter((t) => queryTokens.has(t))",
    "  const distance = 1 - dot(q, d) / (norm(q) * norm(d))",
    "}",
    "const candidates = scored.sort(byDistance).slice(0, p.candidates)",
    "for (const s of candidates) {",
    "  if (kept.length >= p.limit) drop",
    "  else if (s.distance > p.maxDistance) drop",
    "  else if (p.requireShared && !s.shared.length) drop",
    "  else kept.push(s)",
    "}",
    "return kept",
  ],
  frames(ctx) {
    const p = paramsOf(ctx);
    const r = retrievalOf(ctx);
    const tuned = isWhatIf(ctx);
    const note = whatIfNote(ctx, "retrieval");
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
        say: `Every word of the query is a stopword, so the search is skipped and no records are compared.${note}`,
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
        say: `Compare the query vector (${plural(r.q.vector.size, "non-zero box", "non-zero boxes")}, ‖q‖ = ${f3(na)}) with ${plural(r.readable.length, "record")} in this browser, nearest first.${hiddenNote}${note}`,
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
          r.scored.length > p.candidates
            ? `Sorted by distance, the ${p.candidates} nearest become candidates; the other ${r.scored.length - p.candidates} are not considered.`
            : `Sorted by distance. All ${r.scored.length} fit in the ${p.candidates} nearest, so all are candidates.`,
        vars: { candidates: n, "p.candidates": p.candidates },
        at: -1,
        scored: n,
        filtered: 0,
      });
      r.candidates.forEach((s, i) =>
        frames.push({
          phase: "Filter",
          line: !s.reason ? 12 : s.reason.startsWith("distance") ? 10 : s.reason.startsWith("no shared") ? 11 : 9,
          say: !s.reason
            ? `“${short(s.record.title, 40)}”: distance ${f3(s.distance)} ≤ ${p.maxDistance}${p.requireShared ? ", and it shares a real word" : s.shared.length ? ", and it shares a real word" : ", and the shared-word filter is off"}, so it is kept (${r.kept.indexOf(s) + 1} of at most ${p.limit}).`
            : s.reason.startsWith("distance")
              ? `“${short(s.record.title, 40)}”: distance ${f3(s.distance)} is above ${p.maxDistance}, so it is dropped.`
              : s.reason.startsWith("no shared")
                ? `“${short(s.record.title, 40)}”: its vector overlaps the query only through a hash collision, with no word in common, so it is dropped.`
                : `“${short(s.record.title, 40)}”: ${p.limit} ${p.limit === 1 ? "record is" : "records are"} already kept, so it is dropped.`,
          vars: {
            record: s.record.id,
            distance: +s.distance.toFixed(4),
            "p.maxDistance": p.maxDistance,
            shared: s.shared.length,
            kept: r.kept.filter((k) => r.candidates.indexOf(k) <= i).length,
          },
          at: i,
          scored: n,
          filtered: i + 1,
          filter: true,
          hold: 0.6,
        }),
      );
      frames.push({
        phase: "Funnel",
        line: [8, 9, 10, 11, 12],
        say: `The server checks the limit first, then distance, then a shared word. It can also drop deleted records and vectors older than their record, which only it can see.${r.known ? ` Your AI settings, reported with the reply, ${r.offType.length ? `keep ${plural(r.offType.length, "record")} of other types out` : "include every type here"}.` : " Which record types your AI settings index was not reported, so every type is assumed."}`,
        vars: { scored: r.scored.length, candidates: n, kept: r.kept.length },
        at: -1,
        ...end,
      });
      frames.push({
        phase: "Kept",
        line: 14,
        say: (r.kept.length
          ? `Kept ${r.kept.length}: ${r.kept.map((k) => `“${short(k.record.title, 30)}”`).join(", ")}. Each gets the citation id the turn has already given it (from earlier in the thread or the briefing), or the next free number.`
          : "Nothing survives the filters, so the prompt carries no search sources.") + note,
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
        line: 14,
        say: r.skipped ? `${tuned ? "Your settings skip the search." : "The server skipped the search too."} ${cmp.say}` : cmp.say,
        vars: {
          cited: (ctx.copilot.response.citations ?? []).map((c) => c.record_id),
          [tuned ? "yours (what-if)" : "browser"]: r.kept.map((k) => k.record.id),
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
        say: `Now the real thing: the server reported ${plural(searches.length, "search", "searches")} for this reply, with every candidate's distance and what the filters did. These are the server's values on its default settings, not a recomputation${tuned ? ", and your tuned settings do not change them" : ""}.`,
        vars: { searches: searches.length, candidates: rowsAll.length },
        at: -1,
        ...real,
        server: 0,
      });
      rowsAll.forEach((c, k) => {
        frames.push({
          phase: "Server",
          line: c.outcome === "kept" ? 12 : c.outcome === "too_far" ? 10 : c.outcome === "no_shared_word" ? 11 : c.outcome === "limit_reached" ? 9 : 8,
          say: `${c.search === 0 ? "Opening search" : `Lookup ${c.search}`}, rank ${c.rank}: ${c.title ? `“${short(c.title, 40)}”` : "a record the trace does not name"} at distance ${f3(c.distance)}, ${OUTCOME_TEXT[c.outcome] ?? c.outcome}.${c.citation_id ? ` Shown to the model as ${c.citation_id}.` : ""}${serverCheck(c, tuned)}`,
          vars: { rank: c.rank, "server distance": c.distance, outcome: c.outcome, ...(c.citation_id ? { citation: c.citation_id } : {}) },
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
        line: 14,
        say: kept.length
          ? `The server kept ${plural(kept.length, "record")} across these searches: ${kept.map((c) => (c.title ? `“${short(c.title, 30)}”` : c.record_id)).join(", ")}.${tuned ? ` Your what-if kept ${r.kept.length}.` : ""}`
          : "The server's searches kept nothing; the reply rests on the planner briefing or on no records.",
        vars: { kept: kept.map((c) => c.record_id) },
        at: -1,
        ...real,
      });
    }
    return frames;
  },
  blocks(ctx) {
    const p = paramsOf(ctx);
    const r = retrievalOf(ctx);
    const tuned = isWhatIf(ctx);
    const rows = r.candidates.length
      ? r.candidates.map((s) => [
          { text: short(s.record.title, 22), full: s.record.title, align: "left" },
          { text: s.record.type, dim: true },
          { text: s.shared.join(" ") || "—", tone: s.shared.length ? "keyword" : "muted" },
          { text: f3(s.distance), value: s.distance },
          { text: s.reason ? "drop" : "keep", tone: s.reason ? "muted" : "good", full: verdict(s) },
        ])
      : [[{ text: r.skipped ? "search skipped" : "no records", dim: true }, "", "", "", { text: "—", tone: "muted" }]];
    const explainScore = (i, c) => {
      const s = r.candidates[i];
      if (!s) return null;
      const by = ` Computed in your browser with ${whose(ctx)}.`;
      switch (c) {
        case 0:
          return {
            meaning: `A record compared with your query. Its text is the title plus its other fields; the title's words get +${p.titleBoost}.${by}`,
            formula: "d = vectorize(recordText(record), record.title)",
            worked: `${plural(s.d.rows.length, "distinct word")}, ${plural(s.d.vector.size, "non-zero box", "non-zero boxes")}`,
          };
        case 1:
          return { meaning: "The kind of record: task, reminder, note or event.", formula: "record.type", worked: s.record.type };
        case 2:
          return {
            meaning: "Words that appear in both the query and the record. Without one, any closeness comes from a hash collision.",
            formula: "shared = tokens(text) ∩ tokens(query)",
            worked: s.shared.length ? s.shared.join(", ") : "none",
          };
        case 3:
          return {
            meaning: `How far the record is from the query: 0 means the same direction, 1 means nothing in common.${by}`,
            formula: "distance = 1 − q·d / (‖q‖ × ‖d‖)",
            worked: `distance = 1 − ${f3(s.dot)} / (${f3(s.na)} × ${f3(s.nb)}) = ${f3(s.distance)}`,
          };
        default:
          return {
            meaning: "What the filters decided, checked in order: distance, shared word, limit.",
            formula: `distance > ${p.maxDistance} → drop; ${p.requireShared ? "no shared word → drop; " : ""}kept ≥ ${p.limit} → drop`,
            worked: s.reason
              ? `${verdict(s)}`
              : `${f3(s.distance)} ≤ ${p.maxDistance}${p.requireShared ? `, shares ${s.shared.join(", ")}` : ""}, kept ${r.kept.indexOf(s) + 1} of ${p.limit} → keep`,
          };
      }
    };
    const funnel = funnelRows(r, p);
    const explainFunnel = (i) => {
      const h = FUNNEL_HELP[i];
      if (!h) return null;
      return { meaning: `${h.meaning}${tuned && i >= 4 && i !== 7 ? " What-if: counted with your settings." : ""}`, formula: h.formula, worked: `${funnel[i][0]}: ${funnel[i][1]}` };
    };
    const server = serverSearchesOf(ctx).length ? serverRows(ctx) : [];
    const explainServer = (i, col) => {
      const c = server[i];
      if (!c) return null;
      const real = "The server's real value, sent with the reply. The server ran on its default settings.";
      switch (col) {
        case 0:
          return { meaning: "Which search: the opening one on your message, or a lookup the LLM asked for.", formula: "retrieval.searches[i]", worked: `“${short(c.query, 50)}”` };
        case 1:
          return { meaning: `Position by distance in the server's index. ${real}`, formula: "rank = position after sorting by distance", worked: `rank ${c.rank}` };
        case 2:
          return { meaning: "The record the server scored.", formula: "record_id", worked: c.title ?? "not named: the server reports dropped records without their id" };
        case 3:
          return { meaning: `Distance computed on the server. ${real}`, formula: "distance = 1 − q·d / (‖q‖ × ‖d‖)", worked: `server distance = ${f3(c.distance)}` };
        case 4:
          return c.browser === undefined
            ? null
            : {
                meaning: tuned
                  ? "The same record's distance recomputed with your settings: a what-if, not what the server did."
                  : "The same record's distance recomputed in your browser with the default settings, to check the server's arithmetic.",
                formula: "distance = 1 − q·d / (‖q‖ × ‖d‖)",
                worked: `${tuned ? "yours" : "browser"} ${f3(c.browser)} vs server ${f3(c.distance)}: ${Math.abs(c.browser - c.distance) < 5e-6 ? "same" : "differs"}`,
              };
        case 5:
          return {
            meaning: `What the server's filters did with this candidate. ${real}`,
            formula: `cutoff ${c.maxDistance ?? DEFAULT_PARAMS.maxDistance}, limit ${c.limit ?? DEFAULT_PARAMS.limit}`,
            worked: OUTCOME_TEXT[c.outcome] ?? c.outcome,
          };
        default:
          return c.citation_id
            ? { meaning: "The citation id this record carried in the prompt, so the LLM could cite it. Ids come from one ledger per turn: a record keeps the number it had earlier in the thread or in the briefing.", formula: "ledger.register(record)", worked: c.citation_id }
            : null;
      }
    };
    return [
      tableBlock({
        id: "cscores",
        title: `distance = 1 − q·d / (‖q‖ ‖d‖)${tuned ? " · what-if: your settings" : ""}`,
        head: ["record", "type", "shared words", "distance", "result"],
        widths: [2.1, 0.9, 2, 1, 0.8],
        rows,
        explain: explainScore,
      }),
      tableBlock({
        id: "cfunnel",
        title: tuned ? "filters, in the server's order (your settings)" : "filters, in the server's order",
        head: ["stage", "count"],
        widths: [3.6, 1.1],
        rows: funnel.map(([stage, count]) => [
          { text: stage, align: "left", dim: count === "server only" || count === "off" },
          { text: count, tone: count === "server only" || count === "off" ? "muted" : count.startsWith("−") ? "warn" : "number" },
        ]),
        explain: explainFunnel,
      }),
      ...(server.length
        ? [
            tableBlock({
              id: "cserver",
              title: "the server's real search (default settings): rank, distance, outcome",
              head: ["search", "rank", "record", "server", tuned ? "yours" : "browser", "outcome", "cite"],
              widths: [0.8, 0.6, 2.1, 0.9, 0.9, 1.6, 0.6],
              rows: server.map((c) => [
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
              explain: explainServer,
            }),
          ]
        : []),
    ];
  },
  output: "cscores",
  state(frame, ctx) {
    const g = gridOf(paramsOf(ctx).dimensions);
    const r = retrievalOf(ctx);
    const s = frame.at >= 0 ? r.candidates[frame.at] : null;
    const qCells = [...r.q.vector.keys()].map(g.cellOf);
    const tokenRows = (words) =>
      tokens(messageOf(ctx).query, paramsOf(ctx))
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
      cfunnel: { done: () => !!frame.funnel, active: frame.phase === "Funnel" ? all(10, 2) : [] },
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
    const p = paramsOf(ctx);
    const r = retrievalOf(ctx);
    const tuned = isWhatIf(ctx);
    if (frame.serverAt !== undefined) {
      const c = serverRows(ctx)[frame.serverAt];
      return [
        { label: "server (defaults)", terms: [`distance ${f3(c.distance)}`], op: "", result: c.outcome.replaceAll("_", " ") },
        ...(c.browser !== undefined
          ? [{ label: tuned ? "yours (what-if)" : "browser", terms: [`distance ${f3(c.browser)}`], op: "", result: Math.abs(c.browser - c.distance) < 5e-6 ? "same" : "differs" }]
          : []),
      ];
    }
    const s = frame.at >= 0 ? r.candidates[frame.at] : null;
    if (!s) return [];
    if (frame.filter)
      return [{ label: `distance ≤ ${p.maxDistance}`, terms: [f3(s.distance)], op: "", result: verdict(s) }];
    const terms = [...r.q.vector]
      .filter(([slot]) => s.d.vector.has(slot))
      .map(([slot, v]) => `${v.toFixed(2)}×${s.d.vector.get(slot).toFixed(2)}`);
    return [
      { label: "q · d", terms: terms.length ? terms : ["0"], result: f3(s.dot) },
      { label: "distance", terms: ["1", `${f3(s.dot)} / (${f3(s.na)} × ${f3(s.nb)})`], op: "−", result: f3(s.distance) },
    ];
  },
  Stage({ ctx, frame }) {
    const p = paramsOf(ctx);
    const r = retrievalOf(ctx);
    const notes = [
      r.hidden.length ? `${plural(r.hidden.length, "record")} not approved for AI ${r.hidden.length === 1 ? "is" : "are"} left out.` : "",
      whatIfNote(ctx, "retrieval").trim(),
    ].filter(Boolean);
    return (
      <div className="x-stack">
        <Panel title="Nearest records" note={notes.length ? notes.join(" ") : undefined}>
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
            <Table head={["stage", "count"]} rows={funnelRows(r, p)} />
          </Panel>
        )}
      </div>
    );
  },
};
