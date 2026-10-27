import { Bars, Expr, Matrix, Panel, Table, Tag, fixed } from "../../kit.jsx";
import { analyzedRecords, cosineCols, indexed, paramsOf, revealState, tunedNote } from "./util.js";
import { column, row, tableBlock } from "../../../map/blocks.js";

const sq = (x) => x * x;
const num = (x) => (x ? fixed(x) : "0");

const cache = new WeakMap();
function model(ctx) {
  const hit = cache.get(ctx.trace);
  if (hit && hit.records === ctx.records && hit.data === ctx.data) return hit;
  const v = ctx.trace.vectors;
  const recs = analyzedRecords(ctx);
  const dims = v.dimensions;
  const q = v.query;
  const qMag = v.queryMagnitude;
  const rows = recs.map((r, i) => {
    const res = v.results.find((x) => x.record.id === r.id);
    const d = res?.vector ?? dims.map(() => 0);
    const c = ctx.data?.contributions?.find((x) => x.id === r.id);
    const products = q.map((x, j) => x * d[j]);
    const dot = c?.dot ?? products.reduce((s, x) => s + x, 0);
    const dMag = c?.documentMagnitude ?? Math.sqrt(d.reduce((s, x) => s + x * x, 0));
    const score = res?.score ?? (qMag * dMag ? dot / (qMag * dMag) : 0);
    return { record: r, index: i, d, products, dot, dMag, score };
  });
  const out = { records: ctx.records, data: ctx.data, recs, dims, q, qMag, rows };
  cache.set(ctx.trace, out);
  return out;
}

const squares = (v) => v.filter((x) => x).map((x) => `${fixed(x)}²`);

const mod = {
  id: "retrieve",
  source: [["pipeline", "vectorize"]],
  code: [
    "const dot = (q, d) => q.reduce((sum, v, j) => sum + v * d[j], 0)",
    "const magnitude = v => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))",
    "for (const [i, record] of records.entries()) {",
    "  const d = vectors[i]                  // products q[j] * d[j], summed by dot()",
    "  const denominator = magnitude(q) * magnitude(d)",
    "  const score = denominator ? dot(q, d) / denominator : 0",
    "}",
    "results.sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id))",
    "const candidates = results.filter(r => r.score > matchThreshold)   // a setting, default 0.08",
    "const gap = candidates.length > 1 ? candidates[0].score - candidates[1].score : null",
    "// Decide: gap < tieGap (a setting, default 0.15) means the top two are too close to pick one",
  ],
  frames(ctx) {
    const m = model(ctx);
    const p = paramsOf(ctx);
    const { matchThreshold: threshold, tieGap } = p;
    const { trace } = ctx;
    const { rows, q, qMag } = m;
    const results = trace.vectors.results;
    const resultIds = results.map((r) => r.record.id);
    const qSq = squares(q);
    const frames = [
      {
        phase: "Query length",
        line: 1,
        say: qMag
          ? `‖q‖ is computed once: the square root of the sum of squares of the query weights. ‖q‖ = √(${qSq.join(" + ")}) = √${fixed(sq(qMag))} = ${fixed(qMag)}.`
          : "Every query weight is 0, so ‖q‖ = √0 = 0. Every denominator below is 0, and the engine returns score 0 instead of dividing by zero.",
        vars: { "‖q‖²": sq(qMag), "‖q‖": qMag },
        at: -1,
        resultIds,
      },
    ];
    let done = 0;
    rows.forEach((r) => {
      const shared = r.products.map((p, j) => ({ p, j })).filter((x) => x.p);
      const id = r.record.id;
      if (shared.length) {
        frames.push({
          phase: "Scores",
          line: [0, 2, 3],
          say: `Record ${id}: the only non-zero products are where both vectors have weight: ${shared
            .map((x) => `“${m.dims[x.j].term}” ${fixed(q[x.j])} × ${fixed(r.d[x.j])} = ${fixed(x.p)}`)
            .join(", ")}. dot = ${fixed(r.dot)}.`,
          vars: { "record.id": id, "shared terms": shared.length, dot: r.dot },
          at: r.index,
          part: "dot",
          scored: done,
          id,
        });
        done += 1;
        frames.push({
          phase: "Scores",
          line: [1, 4, 5],
          say: `‖d_${id}‖ = √(${squares(r.d).join(" + ")}) = ${fixed(r.dMag)}. score = ${fixed(r.dot)} / (${fixed(qMag)} × ${fixed(r.dMag)}) = ${fixed(r.dot)} / ${fixed(qMag * r.dMag)} = ${fixed(r.score)}.`,
          vars: { "‖q‖": qMag, "‖d‖": r.dMag, denominator: qMag * r.dMag, score: r.score },
          at: r.index,
          part: "score",
          scored: done,
          id,
        });
      } else {
        done += 1;
        frames.push({
          phase: "Scores",
          line: [3, 4, 5],
          say: qMag && r.dMag
            ? `Record ${id} shares no term with the query: every product has a 0 factor, so dot = 0 and score = 0 / (${fixed(qMag)} × ${fixed(r.dMag)}) = 0.`
            : `Record ${id}: the denominator ‖q‖ × ‖d‖ = ${fixed(qMag)} × ${fixed(r.dMag)} = 0, so score = 0.`,
          vars: { "record.id": id, dot: r.dot, "‖d‖": r.dMag, score: r.score },
          at: r.index,
          part: "score",
          scored: done,
          id,
          hold: 0.8,
        });
      }
    });

    const n = rows.length;
    const ties = [];
    for (let i = 1; i < results.length; i++)
      if (results[i].score === results[i - 1].score && results[i].score > threshold)
        ties.push([results[i - 1].record.id, results[i].record.id]);
    frames.push({
      phase: "Ranking",
      line: 7,
      say: `Sort by score, highest first; equal scores are ordered by id. ${results
        .map((r) => `${r.record.id} ${fixed(r.score)}`)
        .join(", ")}.${ties.length ? ` ${ties.map(([a, b]) => `${a} and ${b}`).join("; ")} have exactly the same score, a tie, so ${ties[0][0]} comes first only because of its id.` : ""}`,
      vars: { order: resultIds },
      at: n,
      rank: 1,
      scored: n,
    });
    const cands = trace.candidates;
    frames.push({
      phase: "Ranking",
      line: 8,
      say: cands.length
        ? `Keep scores above ${threshold}${tunedNote(p, "matchThreshold")}: ${cands.join(", ")} ${cands.length === 1 ? "is a candidate" : "are candidates"} (${cands.length} of ${n}).`
        : `No score is above ${threshold}${tunedNote(p, "matchThreshold")}, so there are no candidates.`,
      vars: { matchThreshold: threshold, candidates: cands },
      at: n,
      rank: 2,
      scored: n,
    });
    const gap = trace.gap;
    const top = results.filter((r) => cands.includes(r.record.id));
    frames.push({
      phase: "Ranking",
      line: [9, 10],
      say:
        gap === null
          ? cands.length === 1
            ? `Only one candidate (${cands[0]} ${fixed(top[0].score)}), so there is no second score to compare: gap = null.`
            : "No candidates, so gap = null."
          : `gap = ${top[0].record.id} ${fixed(top[0].score)} − ${top[1].record.id} ${fixed(top[1].score)} = ${fixed(gap)}${
              gap === 0 ? " (an exact tie)" : ""
            }. ${gap < tieGap ? `${fixed(gap)} < ${tieGap}${tunedNote(p, "tieGap")}: too close to pick one, so an update or delete must ask which record you mean.` : `${fixed(gap)} ≥ ${tieGap}${tunedNote(p, "tieGap")}: ${top[0].record.id} is a clear first choice.`}`,
      vars: { gap, tieGap, "gap < tieGap": gap !== null && gap < tieGap },
      at: n,
      rank: 3,
      scored: n,
    });
    return frames;
  },
  Stage({ ctx, frame, frames, at, seek }) {
    const m = model(ctx);
    const p = paramsOf(ctx);
    const { matchThreshold: threshold, tieGap } = p;
    const thresholdNote = tunedNote(p, "matchThreshold");
    const { trace } = ctx;
    const { rows, dims, q, qMag } = m;
    const goTo = (id) => {
      for (let i = frames.length - 1; i >= 0; i--) if (frames[i].id === id) return seek(i);
    };
    const r = frame.at >= 0 && frame.at < rows.length ? rows[frame.at] : null;
    const cands = trace.candidates;
    const ranking = frame.rank > 0;
    const results = trace.vectors.results;
    const bars = ranking
      ? results.map((x, i) => {
          const isCand = cands.includes(x.record.id);
          return {
            key: x.record.id,
            label: `${i + 1}. ${x.record.id} ${x.record.title}`,
            value: x.score,
            marker: threshold,
            active: frame.rank >= 2 && isCand,
            dim: frame.rank >= 2 && !isCand,
            note:
              frame.rank >= 3 && isCand && cands.length > 1 && x.record.id === cands[1]
                ? `gap to ${cands[0]}: ${fixed(trace.gap)}${trace.gap < tieGap ? ` < ${tieGap}` : ` ≥ ${tieGap}`}`
                : undefined,
            onClick: () => goTo(x.record.id),
          };
        })
      : rows
          .filter((x) => frames.some((f, i) => f.id === x.record.id && f.part === "score" && i <= at))
          .map((x) => ({
            key: x.record.id,
            label: `${x.record.id} ${x.record.title}`,
            value: x.score,
            marker: threshold,
            active: r && x.record.id === r.record.id,
            onClick: () => goTo(x.record.id),
          }));
    return (
      <div className="x-stack">
        {r && dims.length > 0 && (
          <Matrix
            caption={`q, d_${r.record.id} and their element-wise product`}
            data={[q, r.d, r.products]}
            rowLabels={["q (query)", `d_${r.record.id}`, "q × d"]}
            colLabels={dims.map((d) => d.term)}
            heatKind="sequential"
            state={(row, c) => (r.products[c] ? "active" : row < 2 && [q, r.d][row][c] ? "done" : "dim")}
          />
        )}
        {(r || frame.at < 0) && (
          <Panel title={r ? `Record ${r.record.id}: “${r.record.title}”` : "Query length"}>
            <Expr label="‖q‖²" terms={squares(q).length ? squares(q) : ["0"]} result={fixed(sq(qMag))} />
            <Expr label="‖q‖" terms={[`√${fixed(sq(qMag))}`]} result={fixed(qMag)} />
            {r && (
              <>
                <Expr
                  label="q · d"
                  terms={r.products.filter((p) => p).length ? r.products.map((p, j) => ({ p, j })).filter((x) => x.p).map((x) => `${fixed(q[x.j])}×${fixed(r.d[x.j])}`) : ["0"]}
                  result={num(r.dot)}
                />
                {frame.part === "score" && (
                  <>
                    <Expr label="‖d‖²" terms={squares(r.d).length ? squares(r.d) : ["0"]} result={fixed(sq(r.dMag))} />
                    <Expr label="‖d‖" terms={[`√${fixed(sq(r.dMag))}`]} result={fixed(r.dMag)} />
                    <Expr
                      label="cos"
                      terms={[num(r.dot), `(${fixed(qMag)} × ${fixed(r.dMag)})`]}
                      op="÷"
                      result={fixed(r.score)}
                    />
                  </>
                )}
              </>
            )}
          </Panel>
        )}
        {bars.length > 0 && (
          <Panel
            title={ranking ? "Ranking (sorted by score, then id)" : `Scores so far (${bars.length} of ${rows.length})`}
            note={`The orange tick marks matchThreshold = ${threshold}${thresholdNote}; a record must score above it to be a candidate. Click a bar to see that record's arithmetic.`}
          >
            <Bars items={bars} max={1} />
          </Panel>
        )}
        {frame.rank >= 2 && (
          <Panel title={`Candidates (${cands.length})`}>
            {cands.length ? (
              <Table className="p-table"
                head={["rank", "record", "title", "score", "matched terms"]}
                rows={results
                  .filter((x) => cands.includes(x.record.id))
                  .map((x, i) => [
                    i + 1,
                    <strong key="id">{x.record.id}</strong>,
                    x.record.title,
                    <code key="s">{fixed(x.score)}</code>,
                    x.matched.join(", "),
                  ])}
              />
            ) : (
              <p className="p-empty">No record scored above {threshold}.</p>
            )}
            {frame.rank >= 3 && (
              <p className="x-note">
                {trace.gap === null ? (
                  "gap = null (fewer than two candidates)."
                ) : (
                  <>
                    gap = {fixed(trace.gap)} {trace.gap < tieGap ? <Tag kind="fail">&lt; {tieGap}: too close</Tag> : <Tag kind="pass">≥ {tieGap}: clear</Tag>}
                  </>
                )}
              </p>
            )}
          </Panel>
        )}
      </div>
    );
  },
};

// ---- Map layer ----

const nonZero = (v) => v.map((x, j) => (x ? j : -1)).filter((j) => j >= 0);
const rank = (ctx) => {
  const ids = ctx.trace.vectors.results.map((r) => r.record.id);
  return (id) => ids.indexOf(id) + 1;
};

function cellsOf(frame, ctx) {
  const m = model(ctx);
  const { rows, q } = m;
  const n = rows.length;
  const qCells = nonZero(q).map((j) => [0, j]);
  if (frame.at < 0) return { tfidf: { source: qCells }, qnorm: { active: [[0, 0], [0, 1]] } };
  if (frame.rank === 1) return { cosine: { source: column(3, n), active: column(4, n) } };
  if (frame.rank === 2) return { cosine: { source: column(3, n), active: column(5, n) } };
  if (frame.rank === 3) {
    const cands = ctx.trace.candidates.slice(0, 2);
    return {
      cosine: { source: rows.map((r, i) => (cands.includes(r.record.id) ? [i, 3] : null)).filter(Boolean) },
      gap: { active: row(0, 4) },
    };
  }
  const r = rows[frame.at];
  if (!r) return {};
  const i = frame.at;
  const shared = nonZero(r.products);
  const dCells = nonZero(r.d).map((j) => [i + 1, j]);
  if (frame.part === "dot")
    return { tfidf: { source: [...shared.map((j) => [0, j]), ...shared.map((j) => [i + 1, j])] }, cosine: { active: [[i, 1]] } };
  const single = !shared.length;
  return {
    tfidf: { source: single ? dCells : dCells },
    qnorm: { source: [[0, 1]] },
    cosine: { source: single ? [] : [[i, 1]], active: single ? [[i, 1], [i, 2], [i, 3]] : [[i, 2], [i, 3]] },
  };
}

// ---- Explain a cell ----

const sumOf = (xs) => (xs.length ? xs.join(" + ") : "0");

function explainQnorm(m, c) {
  const { q, qMag, dims } = m;
  const parts = q.map((x, j) => ({ x, j })).filter((p) => p.x);
  if (c === 0)
    return {
      meaning: "The sum of the squares of the query's weights: one weight per term of your request.",
      formula: "Σ q² = q₀² + q₁² + …",
      worked: parts.length
        ? `${parts.map((p) => `${fixed(p.x)}² (${dims[p.j].term})`).join(" + ")} = ${fixed(qMag * qMag)}`
        : "every query weight is 0, so Σ q² = 0",
    };
  if (c === 1)
    return {
      meaning: "The length of the query vector. Every score below divides by it.",
      formula: "‖q‖ = √(Σ q²)",
      worked: `√${fixed(qMag * qMag)} = ${fixed(qMag)}`,
    };
  return null;
}

function explainCosine(ctx, m, p, r, c) {
  const row = m.rows[r];
  if (!row) return null;
  const { q, qMag, dims } = m;
  const id = row.record.id;
  const shared = row.products.map((x, j) => ({ x, j })).filter((s) => s.x);
  const cands = ctx.trace.candidates;
  switch (c) {
    case 0:
      return {
        meaning: `Record ${id}, “${row.record.title}”. Its title terms are compared with the request's terms.`,
      };
    case 1:
      return {
        meaning: shared.length
          ? `The dot product of the query and record ${id}: only terms both share add to it.`
          : `Record ${id} shares no term with the query, so the dot product is 0.`,
        formula: "q·d = Σ q[j] × d[j]",
        worked: shared.length
          ? `${shared.map((s) => `${fixed(q[s.j])} × ${fixed(row.d[s.j])} (${dims[s.j].term})`).join(" + ")} = ${fixed(row.dot)}`
          : "every product has a 0 factor, so q·d = 0",
      };
    case 2:
      return {
        meaning: `The length of record ${id}'s vector.`,
        formula: "‖d‖ = √(Σ d²)",
        worked: `√(${sumOf(squares(row.d))}) = ${fixed(row.dMag)}`,
      };
    case 3:
      return {
        meaning: `How closely record ${id} points the same way as the query: 1 is the same direction, 0 means no shared term.`,
        formula: "cos = q·d / (‖q‖ × ‖d‖), or 0 when the bottom is 0",
        worked:
          qMag * row.dMag
            ? `${fixed(row.dot)} / (${fixed(qMag)} × ${fixed(row.dMag)}) = ${fixed(row.dot)} / ${fixed(qMag * row.dMag)} = ${fixed(row.score)}`
            : `‖q‖ × ‖d‖ = ${fixed(qMag)} × ${fixed(row.dMag)} = 0, so cos = 0`,
      };
    case 4: {
      const order = ctx.trace.vectors.results;
      const at = order.findIndex((x) => x.record.id === id);
      return {
        meaning: `Record ${id}'s place after sorting by score, highest first.`,
        formula: "sort by score descending, then by id",
        worked: `${order.map((x) => `${x.record.id} ${fixed(x.score)}`).join(", ")} → ${id} is number ${at + 1}`,
      };
    }
    case 5:
      return {
        meaning: cands.includes(id)
          ? `Record ${id} is a candidate: its score is above the match threshold.`
          : `Record ${id} is not a candidate: its score is not above the match threshold.`,
        formula: "candidate if cos > matchThreshold",
        worked: `${fixed(row.score)} ${row.score > p.matchThreshold ? ">" : "≤"} ${p.matchThreshold}${tunedNote(p, "matchThreshold")} → ${cands.includes(id) ? "yes" : "no"}`,
      };
    default:
      return null;
  }
}

function explainGap(ctx, p, top, c) {
  const gap = ctx.trace.gap;
  const note = tunedNote(p, "tieGap");
  if (c === 0 || c === 1) {
    const x = top[c];
    if (!x) return null;
    return {
      meaning: `The ${c === 0 ? "highest" : "second highest"} scoring candidate: record ${x.record.id}, “${x.record.title}”.`,
      formula: `top${c === 0 ? "₁" : "₂"} = candidates[${c}]`,
      worked: `${x.record.id} scores ${fixed(x.score)}`,
    };
  }
  if (gap === null)
    return c === 2 || c === 3
      ? {
          meaning: "With fewer than two candidates there is no second score, so there is no gap to check.",
          formula: "gap = null when candidates.length < 2",
          worked: `${top.length} candidate${top.length === 1 ? "" : "s"} → gap = null`,
        }
      : null;
  if (c === 2)
    return {
      meaning: "How far ahead the top candidate is of the second one.",
      formula: "gap = top₁ − top₂",
      worked: `${fixed(top[0].score)} − ${fixed(top[1].score)} = ${fixed(gap)}`,
    };
  if (c === 3)
    return {
      meaning:
        gap < p.tieGap
          ? "The top two are too close to pick one, so an update or delete has to ask which record you meant."
          : "The top candidate is clearly ahead, so it can be picked.",
      formula: "a tie if gap < tieGap",
      worked: `${fixed(gap)} ${gap < p.tieGap ? "<" : "≥"} ${p.tieGap}${note} → ${gap < p.tieGap ? "tie" : "clear"}`,
    };
  return null;
}

Object.assign(mod, {
  blocks(ctx) {
    const m = model(ctx);
    const p = paramsOf(ctx);
    const { tieGap } = p;
    const { rows, qMag } = m;
    const cands = ctx.trace.candidates;
    const rk = rank(ctx);
    const gap = ctx.trace.gap;
    const top = ctx.trace.vectors.results.filter((r) => cands.includes(r.record.id));
    return [
      tableBlock({
        id: "qnorm",
        title: "‖q‖ = √(Σ q²)",
        head: ["Σ q²", "‖q‖"],
        widths: [1.2, 1.2],
        rows: [[{ text: fixed(qMag * qMag), value: qMag * qMag }, { text: fixed(qMag), value: qMag, bold: true }]],
        explain: (r, c) => explainQnorm(m, c),
      }),
      tableBlock({
        id: "cosine",
        title: "cos = q·d / (‖q‖ × ‖d‖)",
        head: cosineCols(p),
        rowLabels: rows.map((r) => r.record.id),
        widths: [2.6, 0.95, 0.95, 0.95, 0.65, 0.85],
        rows: rows.map((r) => {
          const cand = cands.includes(r.record.id);
          return [
            { text: r.record.title, align: "left", dim: true },
            { text: r.dot ? fixed(r.dot) : "0", value: r.dot, dim: !r.dot },
            { text: fixed(r.dMag), value: r.dMag },
            { text: fixed(r.score), value: r.score, tone: cand ? "good" : r.score ? undefined : "muted", bold: cand },
            { text: String(rk(r.record.id)) },
            cand ? { text: "yes", tone: "good" } : { text: "no", tone: "muted" },
          ];
        }),
        explain: (r, c) => explainCosine(ctx, m, p, r, c),
      }),
      tableBlock({
        id: "gap",
        title: `gap = top₁ − top₂ · a tie if < ${tieGap}`,
        head: ["top₁", "top₂", "gap", "verdict"],
        widths: [1.3, 1.3, 0.9, 1.6],
        rows: [
          gap === null
            ? [
                top[0] ? `${top[0].record.id} ${fixed(top[0].score)}` : { text: "—", tone: "muted" },
                { text: "—", tone: "muted" },
                { text: "null", tone: "muted" },
                { text: top.length ? "one candidate" : "no candidates", tone: "muted" },
              ]
            : [
                `${top[0].record.id} ${fixed(top[0].score)}`,
                `${top[1].record.id} ${fixed(top[1].score)}`,
                { text: fixed(gap), bold: true },
                gap < tieGap ? { text: gap === 0 ? "exact tie" : "too close", tone: "warn", bold: true } : { text: "clear", tone: "good" },
              ],
        ],
        explain: (r, c) => explainGap(ctx, p, top, c),
      }),
    ];
  },
  output: "cosine",
  state(frame, ctx) {
    return revealState(mod, frame, ctx, cellsOf, {
      qnorm: () => false,
      cosine: (r, c) => c === 0,
      gap: () => false,
    });
  },
  math(frame, ctx) {
    const m = model(ctx);
    const { matchThreshold: threshold, tieGap } = paramsOf(ctx);
    const { rows, q, qMag, dims } = m;
    if (frame.at < 0)
      return [
        { label: "‖q‖²", terms: squares(q).length ? squares(q) : ["0"], result: fixed(qMag * qMag) },
        { label: "‖q‖", terms: [`√${fixed(qMag * qMag)}`], result: fixed(qMag) },
      ];
    const results = ctx.trace.vectors.results;
    if (frame.rank === 1)
      return [{ label: "sorted", terms: results.slice(0, 8).map((r) => `${r.record.id} ${fixed(r.score)}`), op: "≥" }];
    if (frame.rank === 2) {
      const c = ctx.trace.candidates;
      return [{ label: `cos > ${threshold}`, terms: c.length ? c : ["none"], op: ",", result: `${c.length} candidate${c.length === 1 ? "" : "s"}` }];
    }
    if (frame.rank === 3) {
      const gap = ctx.trace.gap;
      if (gap === null) return [{ label: "gap", terms: ["fewer than two candidates"], result: "null" }];
      const top = results.filter((r) => ctx.trace.candidates.includes(r.record.id));
      return [
        { label: "gap", terms: [fixed(top[0].score), fixed(top[1].score)], op: "−", result: fixed(gap) },
        { label: `gap < ${tieGap}`, terms: [fixed(gap)], result: String(gap < tieGap) },
      ];
    }
    const r = rows[frame.at];
    if (!r) return [];
    const shared = nonZero(r.products);
    if (frame.part === "dot")
      return [
        ...shared.slice(0, 6).map((j) => ({ label: dims[j].term, terms: [fixed(q[j]), fixed(r.d[j])], op: "×", result: fixed(r.products[j]) })),
        { label: "q·d", terms: shared.map((j) => fixed(r.products[j])), result: fixed(r.dot) },
      ];
    return [
      ...(shared.length ? [] : [{ label: "q·d", terms: ["no shared term"], result: "0" }]),
      { label: "‖d‖", terms: [`√(${squares(r.d).join(" + ") || "0"})`], result: fixed(r.dMag) },
      {
        label: "cos",
        terms: [r.dot ? fixed(r.dot) : "0", `(${fixed(qMag)} × ${fixed(r.dMag)})`],
        op: "÷",
        result: fixed(r.score),
      },
    ];
  },
});

const rawFrames = mod.frames;
mod.frames = (ctx) => indexed(rawFrames.call(mod, ctx));

export default mod;
