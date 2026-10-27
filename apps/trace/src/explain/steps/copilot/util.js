// Helpers shared by the copilot step modules.
import { buildPrompt, COPILOT_DEFAULTS, retrieve, serverContextOf } from "../../../engine/copilot.js";
import { changed, SETTINGS } from "../../../tune/schema.js";

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
export const short = (text, n = 60) => {
  const s = String(text ?? "");
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
export const num = (n) => Number(n).toLocaleString("en-US");

// The copilot search settings this ctx runs with. Contexts built without
// params (tests, older callers) run on the server's defaults.
export const paramsOf = (ctx) => ctx.params?.copilot ?? COPILOT_DEFAULTS;
export const DEFAULT_PARAMS = COPILOT_DEFAULTS;

// Changed copilot settings: keys, and their labels for prose.
export const tunedKeys = (ctx) => changed("copilot", paramsOf(ctx));
export const isWhatIf = (ctx) => tunedKeys(ctx).length > 0;
// Labels of the changed settings that reach a step (all of them without one).
export const tunedLabels = (ctx, stepId) => {
  const keys = new Set(tunedKeys(ctx));
  return SETTINGS.copilot
    .filter((s) => keys.has(s.key) && (!stepId || s.steps.includes(stepId)))
    .map((s) => s.label.toLowerCase());
};
// A sentence for narration when this step is a what-if, else "".
export const whatIfNote = (ctx, stepId) => {
  const labels = tunedLabels(ctx, stepId);
  return labels.length ? ` What-if: these numbers use your settings (${labels.join(", ")}), not the server's.` : "";
};

// The validated message and the search query cut from it.
export function messageOf(ctx) {
  const c = ctx.copilot;
  const raw = c.message ?? "";
  const trimmed = raw.trim();
  const p = paramsOf(ctx);
  return { raw, trimmed, query: trimmed.slice(0, p.queryChars), history: c.history ?? [], focus: c.focus ?? null };
}

// The query vector drawn as a grid: about 4 columns for every 3 rows, a
// multiple of 8 wide, cells shrinking as the grid grows.
export function gridOf(dimensions) {
  const cols = Math.min(64, Math.max(8, Math.round(Math.sqrt((dimensions * 4) / 3) / 8) * 8));
  const rows = Math.ceil(dimensions / cols);
  const shrink = Math.min(1, 32 / cols);
  return {
    cols,
    rows,
    cellOf: (slot) => [Math.floor(slot / cols), slot % cols],
    slotAt: (r, c) => r * cols + c,
    cellW: 0.62 * Math.max(0.5, shrink),
    cellH: 0.5 * Math.max(0.5, shrink),
  };
}

// Number formats for worked arithmetic.
export const f3 = (v) => Number(v).toFixed(3);
export const weightText = (p, count) => (p.logWeight ? `1 + ln(${count})` : `${count}`);

// Rows of the "cmessage" block, read by later steps.
export const MESSAGE_ROW = { length: 0, history: 1, focus: 2, timezone: 3, query: 4 };

export const sampleNote = (ctx) => (ctx.copilot.demo ? " This is the sample exchange, not one you sent." : "");

// The browser's retrieval. Records not approved for AI are left out before
// scoring: the copilot never reads them, and neither does this page.
// Cached per exchange and per settings object, so a tuned ctx and its
// baseline never share a result.
const cache = new WeakMap();
export function retrievalOf(ctx) {
  const c = ctx.copilot;
  const p = paramsOf(ctx);
  let byParams = cache.get(c);
  if (!byParams) cache.set(c, (byParams = new WeakMap()));
  let r = byParams.get(p);
  if (!r) {
    const records = c.records ?? [];
    const hidden = records.filter((x) => x.approvedForAi === false);
    const sc = serverContextOf(c);
    const result = retrieve(c.message ?? "", records, p, { types: sc.types, attachments: sc.attachments });
    const candidates = result.candidates ?? [];
    r = {
      ...result,
      records,
      hidden,
      readable: result.excluded ? records.filter((x) => !result.excluded.includes(x)) : records,
      // Readable, but of a type the privacy settings keep out of the index.
      offType: (result.excluded ?? []).filter((x) => x.approvedForAi !== false),
      // Whether the server reported the privacy settings these filters use.
      known: sc.known,
      candidates,
      keptRows: result.kept.map((k) => candidates.indexOf(k)),
    };
    byParams.set(p, r);
  }
  return r;
}

// Word wrap for the answer block.
export function wrap(text, width = 48) {
  const lines = [];
  for (const para of String(text ?? "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
      while (line.length > width) {
        lines.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    lines.push(line);
  }
  return lines;
}

export const value = (v) =>
  v === undefined || v === null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

export const reasonOf = (u) => (typeof u === "string" ? u : (u?.reason ?? JSON.stringify(u)));

// The server's own searches for this reply, when the backend reported them
// (retrieval.searches): each candidate's rank, distance and outcome.
export const serverSearchesOf = (ctx) => ctx.copilot.response?.retrieval?.searches ?? [];

export const OUTCOME_TEXT = {
  kept: "kept",
  too_far: "too far (distance over the cutoff)",
  type_not_indexed: "type not indexed in your planner's AI settings",
  type_filtered: "not the type this lookup asked for",
  missing: "record no longer exists",
  not_approved: "not approved for AI",
  stale_revision: "vector older than the record (stale revision)",
  no_shared_word: "no shared word (hash collision)",
  limit_reached: "the limit of sources was already reached",
};

// Every server candidate as one row, across all of the turn's searches.
export function serverRows(ctx) {
  const titles = new Map((ctx.copilot.records ?? []).map((r) => [String(r.id), r.title]));
  const browser = new Map((retrievalOf(ctx).scored ?? []).map((s) => [String(s.record.id), s.distance]));
  return serverSearchesOf(ctx).flatMap((search, si) =>
    search.candidates.map((c) => ({
      ...c,
      search: si,
      query: search.query,
      limit: search.limit,
      maxDistance: search.max_distance,
      title: c.record_id === null || c.record_id === undefined
        ? null
        : titles.get(String(c.record_id)) ?? `record ${c.record_id} (not in this browser)`,
      browser: c.record_id != null ? browser.get(String(c.record_id)) : undefined,
    })),
  );
}

// The prompt of the first generation, rebuilt in the browser (buildPrompt).
// Its sources are the server's opening search when the reply carried it and
// no setting is tuned; otherwise the browser's own pick, a what-if when tuned.
const prompts = new WeakMap();
export function promptOf(ctx) {
  const c = ctx.copilot;
  const p = paramsOf(ctx);
  let byParams = prompts.get(c);
  if (!byParams) prompts.set(c, (byParams = new WeakMap()));
  let out = byParams.get(p);
  if (!out) {
    const opening = serverSearchesOf(ctx)[0];
    const byId = new Map((c.records ?? []).map((r) => [String(r.id), r]));
    let kept;
    let missing = [];
    let from = "browser";
    if (opening && !isWhatIf(ctx)) {
      const ids = opening.candidates.filter((x) => x.outcome === "kept").map((x) => String(x.record_id));
      kept = ids.map((id) => byId.get(id)).filter(Boolean);
      missing = ids.filter((id) => !byId.has(id));
      from = "server";
    } else kept = retrievalOf(ctx).kept.map((k) => k.record);
    const built = buildPrompt(c, { kept });
    const round = c.response?.retrieval?.turn?.rounds?.[0] ?? null;
    const server = new Map((round?.sections ?? []).map((s) => [s.name, s]));
    const sections = built.sections.map((s) => {
      const real = server.get(s.name);
      const status = !real ? (round ? "browser only" : "recomputed") : real.chars === s.chars ? "exact" : "differs";
      return { ...s, server: real?.chars ?? null, serverItems: real?.items ?? null, status };
    });
    // A section the server sent that the browser did not rebuild.
    for (const [name, real] of server)
      if (!sections.some((s) => s.name === name)) sections.push({ name, text: "", chars: null, items: real.items, server: real.chars, serverItems: real.items, status: "server only" });
    out = { ...built, sections, from, missing, round, rounds: c.response?.retrieval?.turn?.rounds ?? [], turn: c.response?.retrieval?.turn ?? null };
    byParams.set(p, out);
  }
  return out;
}
