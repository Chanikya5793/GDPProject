import { Expr, Matrix, Panel, Table, Tag, fixed } from "../../kit.jsx";
import { termSteps } from "../../../engine/pipeline.js";
import { analyzedRecords, idfRule, indexed, isDefault, paramsOf, plural, revealState } from "./util.js";
import { matrixBlock, row, tableBlock } from "../../../map/blocks.js";

const MAX_TERM_FRAMES = 40; // per phase; larger vocabularies are grouped

const cache = new WeakMap();
function model(ctx) {
  const key = ctx.trace;
  const hit = cache.get(key);
  if (hit && hit.records === ctx.records) return hit;
  const v = ctx.trace.vectors;
  const recs = analyzedRecords(ctx);
  const docs = v.documents;
  const dims = v.dimensions;
  const query = v.query;
  const queryTerms = ctx.trace.entities.keywords;
  const vectors = docs.map(
    (doc, i) =>
      v.results.find((r) => r.record.id === recs[i]?.id)?.vector ??
      dims.map(({ term, idf }) => doc.filter((t) => t === term).length * idf),
  );
  const union = [...new Set([...docs.flat(), ...queryTerms])];
  const holders = dims.map((d) => recs.filter((_, i) => docs[i].includes(d.term)).map((r) => r.id));
  const tfq = dims.map((d) => queryTerms.filter((t) => t === d.term).length);
  const p = paramsOf(ctx);
  const N = docs.length;
  const rule = (df) => idfRule(p, N, df);
  const out = { records: ctx.records, recs, docs, dims, query, queryTerms, vectors, union, holders, tfq, N, p, rule };
  cache.set(key, out);
  return out;
}

// Which IDF rule the settings chose, said plainly, with "(your setting…)" when tuned.
function idfSetting(p) {
  const tuned = !isDefault(p, "useIdf") || !isDefault(p, "smoothIdf");
  const mark = tuned ? " (your setting; the default is smoothed IDF)" : "";
  if (!p.useIdf) return `IDF is off${mark}: every term gets idf = 1, so a common word weighs as much as a rare one.`;
  if (!p.smoothIdf)
    return `Unsmoothed IDF${mark}: idf = ln(N / df) + 1, with df = 0 treated as 1. A term in every record gets ln(1) + 1 = 1.`;
  return `${tuned ? `Smoothed IDF${mark}. ` : ""}The +1 inside keeps df = 0 from dividing by zero; the +1 outside keeps a term found in every record above 0.`;
}

const mod = {
  id: "vectorize",
  source: [
    ["pipeline", "terms"],
    ["pipeline", "vectorize"],
  ],
  code: [
    "const documents = records.map(r => terms(r.title))   // N = records.length",
    "const queryTerms = entities.keywords",
    "const vocabulary = [...new Set([...documents.flat(), ...queryTerms])].sort()",
    "const dimensions = vocabulary.map(term => {",
    "  const df = documents.filter(doc => doc.includes(term)).length",
    "  const idf = useIdf ? (smoothIdf ? Math.log((N + 1) / (df + 1)) : Math.log(N / Math.max(df, 1))) + 1 : 1",
    "  return { term, df, idf }",
    "})",
    "const encode = words => dimensions.map(({ term, idf }) =>",
    "  words.filter(w => w === term).length * idf)        // tf × idf",
    "const query = encode(queryTerms)",
    "const vectors = documents.map(encode)",
  ],
  frames(ctx) {
    const m = model(ctx);
    const { recs, docs, dims, query, queryTerms, union, holders, tfq, N, p, rule } = m;
    const V = dims.length;
    const frames = [];
    const base = { docs: 0, vocab: 0, df: 0, idf: 0, qDims: [], rows: 0, cur: null };
    let state = { ...base };
    const push = (f, patch = {}) => {
      state = { ...state, ...patch };
      frames.push({ ...state, ...f });
    };

    // Documents
    recs.forEach((r, i) =>
      push(
        {
          phase: "Documents",
          line: 0,
          say: `Record ${r.id} “${r.title}” → terms(title) = [${docs[i].join(", ")}].${i === 0 ? " Record titles go through the same filter as the request title." : ""}`,
          vars: { i, "record.id": r.id, title: r.title, "documents[i]": docs[i] },
          hold: 0.8,
          ...(i === 0 ? { resultIds: ctx.trace.vectors.results.map((x) => x.record.id) } : {}),
        },
        { docs: i + 1, cur: { kind: "doc", index: i } },
      ),
    );
    push(
      {
        phase: "Documents",
        line: 1,
        say: queryTerms.length
          ? `The query terms come from the request: [${queryTerms.join(", ")}]. N = ${N} documents.`
          : `The request produced no terms, so queryTerms = []. N = ${N} documents.`,
        vars: { queryTerms, N },
      },
      { cur: { kind: "query" } },
    );

    // Vocabulary
    const queryOnly = queryTerms.filter((t) => !docs.some((d) => d.includes(t)));
    push(
      {
        phase: "Vocabulary",
        line: 2,
        say: `A Set keeps each term once: ${docs.flat().length} document terms plus ${queryTerms.length} query terms give ${plural(union.length, "distinct term")}.${
          queryOnly.length
            ? ` ${queryOnly.map((t) => `“${t}”`).join(", ")} ${queryOnly.length === 1 ? "is" : "are"} in no record title but still ${queryOnly.length === 1 ? "gets a dimension" : "get dimensions"}, with df = 0.`
            : ""
        }`,
        vars: { "documents.flat().length": docs.flat().length, "queryTerms.length": queryTerms.length, "set.size": union.length },
      },
      { vocab: 1, cur: { kind: "vocab" } },
    );
    push(
      {
        phase: "Vocabulary",
        line: 2,
        say: V
          ? `.sort() orders the terms by UTF-16 code units, which is alphabetical here. Dimension j is the j-th term: ${dims
              .slice(0, 6)
              .map((d, j) => `${d.term} = ${j}`)
              .join(", ")}${V > 6 ? ", and so on" : ""}. Every vector below has ${V} entries.`
          : "The vocabulary is empty, so every vector has 0 entries.",
        vars: { vocabulary: dims.map((d) => d.term), "vocabulary.length": V },
      },
      { vocab: 2, cur: { kind: "vocab" } },
    );

    const g = Math.max(1, Math.ceil(V / MAX_TERM_FRAMES));
    const groups = [];
    for (let j = 0; j < V; j += g) groups.push(Array.from({ length: Math.min(g, V - j) }, (_, k) => j + k));

    // Document frequency
    groups.forEach((js) =>
      push(
        {
          phase: "Document frequency",
          line: [3, 4],
          say: js
            .map((j) => {
              const h = holders[j];
              return h.length
                ? `“${dims[j].term}” appears in ${h.length === N ? "every record" : h.join(", ")}, so df = ${dims[j].df}.`
                : `No record title contains “${dims[j].term}” (it comes from the query), so df = 0.`;
            })
            .join(" "),
          vars: { j: js.at(-1), term: dims[js.at(-1)].term, "in records": holders[js.at(-1)], df: dims[js.at(-1)].df },
          col: js.at(-1),
          hold: g > 1 ? 1.2 : 0.75,
        },
        { df: js.at(-1) + 1, cur: { kind: "dim", index: js.at(-1), list: js } },
      ),
    );

    // IDF
    groups.forEach((js, k) =>
      push(
        {
          phase: "IDF",
          line: 5,
          say:
            js
              .map((j) => `idf(“${dims[j].term}”) = ${rule(dims[j].df).worked}.`)
              .join(" ") + (k === 0 ? ` ${idfSetting(p)}` : ""),
          vars: {
            term: dims[js.at(-1)].term,
            N,
            df: dims[js.at(-1)].df,
            ...(p.useIdf ? { [p.smoothIdf ? "(N + 1) / (df + 1)" : "N / max(df, 1)"]: rule(dims[js.at(-1)].df).ratio } : {}),
            idf: dims[js.at(-1)].idf,
          },
          col: js.at(-1),
          hold: k === 0 ? 1.6 : g > 1 ? 1.2 : 0.75,
        },
        { idf: js.at(-1) + 1, cur: { kind: "dim", index: js.at(-1), list: js } },
      ),
    );

    // Vectors
    const nz = dims.map((_, j) => j).filter((j) => tfq[j] > 0);
    const shown = [];
    nz.forEach((j) => {
      shown.push(j);
      push(
        {
          phase: "Vectors",
          line: [8, 9, 10],
          say: `Query, dimension ${j} “${dims[j].term}”: tf = ${tfq[j]} (it appears ${tfq[j] === 1 ? "once" : `${tfq[j]} times`} in the query terms) × idf ${fixed(dims[j].idf)} = ${fixed(query[j])}.`,
          vars: { j, term: dims[j].term, tf: tfq[j], idf: dims[j].idf, "query[j]": query[j] },
          col: j,
        },
        { qDims: [...shown], cur: { kind: "q", index: j } },
      );
    });
    push(
      {
        phase: "Vectors",
        line: 10,
        say: nz.length
          ? `The other ${plural(V - nz.length, "dimension")} have tf = 0 in the query, so their weight is 0. query = [${query.map((x) => (x ? fixed(x) : "0")).join(", ")}].`
          : `The query has no terms, so tf = 0 everywhere and query is ${V} zeros. No record can share a term with it.`,
        vars: { query, "non-zero": nz.length },
      },
      { qDims: dims.map((_, j) => j), cur: { kind: "qall" } },
    );
    recs.forEach((r, i) => {
      const parts = dims
        .map((d, j) => ({ d, j, tf: docs[i].filter((t) => t === d.term).length }))
        .filter((x) => x.tf > 0);
      push(
        {
          phase: "Vectors",
          line: 11,
          say: parts.length
            ? `Record ${r.id}: ${parts.map((x) => `“${x.d.term}” tf ${x.tf} × idf ${fixed(x.d.idf)} = ${fixed(m.vectors[i][x.j])}`).join(", ")}; the other ${V - parts.length} entries are 0.`
            : `Record ${r.id} has no terms, so its vector is all zeros.`,
          vars: { "record.id": r.id, [`vectors[${i}]`]: m.vectors[i] },
          id: r.id,
          hold: 0.8,
        },
        { rows: i + 1, cur: { kind: "row", index: i } },
      );
    });
    const sharing = recs.filter((_, i) => m.vectors[i].some((x, j) => x && query[j]));
    push(
      {
        phase: "Done",
        line: [10, 11],
        say: `${N + 1} vectors of length ${V}: the query and ${plural(N, "record")}. ${
          sharing.length
            ? `${sharing.map((r) => r.id).join(", ")} ${sharing.length === 1 ? "shares" : "share"} at least one non-zero column with the query; every other record will score 0 in the next step.`
            : "No record shares a non-zero column with the query, so every score in the next step will be 0."
        }`,
        vars: { rows: N + 1, columns: V },
      },
      { cur: null },
    );
    return frames;
  },
  Stage({ ctx, frame, frames, seek }) {
    const m = model(ctx);
    const { recs, docs, dims, holders, tfq, N } = m;
    const cur = frame.cur ?? {};
    const curTerm = cur.kind === "dim" ? dims[cur.index]?.term : null;
    const inVectors = frame.phase === "Vectors" || frame.phase === "Done";
    return (
      <div className="x-stack">
        {!inVectors && (
          <Panel title={`Documents (N = ${N})`} note={curTerm ? `Rows that contain “${curTerm}” are highlighted.` : undefined}>
            <Table className="p-table"
              head={["#", "record", "title", "terms(title)"]}
              active={cur.kind === "doc" ? cur.index : undefined}
              rows={recs.map((r, i) =>
                i < frame.docs
                  ? {
                      cls: curTerm && docs[i].includes(curTerm) ? "p-hit" : "",
                      cells: [
                        i,
                        <strong key="id">{r.id}</strong>,
                        r.title,
                        <span key="t" className="p-chips">
                          {docs[i].map((t, k) => (
                            <span key={k} className={`p-chip ${t === curTerm ? "is-hit" : ""}`}>
                              {t}
                            </span>
                          ))}
                        </span>,
                      ],
                    }
                  : { cls: "is-pending", cells: [i, r.id, r.title, "…"] },
              )}
            />
            {frame.docs >= N && (
              <div className="p-chips" style={{ marginTop: 10 }}>
                <span className="p-dim">queryTerms:</span>
                {m.queryTerms.length ? (
                  m.queryTerms.map((t, k) => (
                    <span key={k} className={`p-chip is-kept ${t === curTerm ? "is-hit" : ""}`}>
                      {t}
                    </span>
                  ))
                ) : (
                  <span className="p-dim">[]</span>
                )}
              </div>
            )}
          </Panel>
        )}
        {frame.vocab === 1 && (
          <Panel title={`new Set(…) — ${m.union.length} terms, first-seen order`}>
            <div className="p-chips">
              {m.union.map((t) => (
                <span key={t} className={`p-chip ${m.queryTerms.includes(t) ? "is-kept" : ""}`}>
                  {t}
                </span>
              ))}
            </div>
          </Panel>
        )}
        {inVectors && <Vectors m={m} frame={frame} />}
        {frame.vocab === 2 && (
          <Panel
            title={`Dimensions (${dims.length})`}
            note={`df: how many record titles contain the term. ${m.rule(0).formula}. Click a row to jump to its IDF frame.`}
          >
            {dims.length ? (
              <Table className="p-table"
                head={["j", "term", "records containing it", "tf in query", "df", "idf"]}
                active={cur.kind === "dim" || cur.kind === "q" ? cur.index : undefined}
                onRow={(j) => {
                  const at = frames.findIndex((f) => f.phase === "IDF" && f.cur?.list?.includes(j));
                  if (at >= 0) seek(at);
                }}
                rows={dims.map((d, j) => [
                  j,
                  <code key="t">{d.term}</code>,
                  j < frame.df ? (
                    holders[j].length ? (
                      holders[j].join(", ")
                    ) : (
                      <Tag key="h" kind="skip">none (query only)</Tag>
                    )
                  ) : (
                    "…"
                  ),
                  tfq[j] || "",
                  j < frame.df ? d.df : "…",
                  j < frame.idf ? fixed(d.idf) : "…",
                ])}
              />
            ) : (
              <p className="p-empty">No dimensions.</p>
            )}
          </Panel>
        )}
        {frame.phase === "IDF" && cur.kind === "dim" && (
          <Panel title="Inverse document frequency">
            {cur.list.map((j) => {
              const x = m.rule(dims[j].df);
              if (!m.p.useIdf) return <Expr key={j} label={`idf(${dims[j].term})`} terms={["IDF off"]} result="1" />;
              return (
                <div key={j}>
                  <Expr label={`idf(${dims[j].term})`} terms={[x.expr, "1"]} result={`ln(${fixed(x.ratio)}) + 1`} />
                  <Expr label="" terms={[fixed(x.ln), "1"]} result={fixed(dims[j].idf)} />
                </div>
              );
            })}
          </Panel>
        )}
      </div>
    );
  },
};

function Vectors({ m, frame }) {
  const { recs, dims, query, vectors, tfq } = m;
  const cur = frame.cur ?? {};
  if (!dims.length)
    return (
      <Panel title="Vectors">
        <p className="p-empty">The vocabulary is empty, so every vector has length 0.</p>
      </Panel>
    );
  const data = [query, ...vectors];
  const q = new Set(frame.qDims);
  const state = (r, c) => {
    if (r === 0) {
      if (!q.has(c)) return "pending";
      if (cur.kind === "q" && cur.index === c) return "active";
      return data[r][c] ? "done" : "dim";
    }
    if (r - 1 >= frame.rows) return "pending";
    if (cur.kind === "row" && cur.index === r - 1) return data[r][c] ? "active" : "dim";
    return data[r][c] ? "done" : "dim";
  };
  const row = cur.kind === "row" ? cur.index : null;
  return (
    <>
      <Matrix
        caption="tf × idf vectors (rows: the query, then each record; columns: the vocabulary)"
        data={data}
        rowLabels={["query", ...recs.map((r) => r.id)]}
        colLabels={dims.map((d) => d.term)}
        heatKind="sequential"
        state={state}
      />
      {cur.kind === "q" && (
        <Panel title={`query[${cur.index}]`}>
          <Expr label={dims[cur.index].term} terms={[`tf ${tfq[cur.index]}`, `idf ${fixed(dims[cur.index].idf)}`]} op="×" result={fixed(query[cur.index])} />
        </Panel>
      )}
      {row !== null && (
        <Panel title={`Record ${recs[row].id}: “${recs[row].title}”`}>
          {dims
            .map((d, j) => ({ d, j, tf: m.docs[row].filter((t) => t === d.term).length }))
            .filter((x) => x.tf)
            .map((x) => (
              <Expr key={x.j} label={x.d.term} terms={[`tf ${x.tf}`, `idf ${fixed(x.d.idf)}`]} op="×" result={fixed(vectors[row][x.j])} />
            ))}
          {!m.docs[row].length && <p className="p-empty">No terms: all zeros.</p>}
        </Panel>
      )}
    </>
  );
}

// ---- Map layer ----

function cellsOf(frame, ctx) {
  const m = model(ctx);
  const { docs, dims, queryTerms, holders, recs } = m;
  const V = dims.length;
  const cur = frame.cur ?? {};
  const termRow = (t) => queryTerms.indexOf(t);
  const docCells = (pred) => docs.map((d, i) => (pred(d, i) ? [i, 2] : null)).filter(Boolean);
  switch (cur.kind) {
    case "doc":
      return { docs: { source: [[cur.index, 1]], active: [[cur.index, 2]] } };
    case "query":
      return { terms: { source: queryTerms.map((_, k) => [k, 1]) } };
    case "vocab":
      return { docs: { source: docCells(() => true) }, terms: { source: queryTerms.map((_, k) => [k, 1]) } };
    case "dim": {
      const js = cur.list ?? [cur.index];
      if (frame.phase === "IDF") return { idf: { source: js.map((j) => [0, j]), active: js.map((j) => [1, j]) } };
      const ids = new Set(js.flatMap((j) => holders[j]));
      return {
        docs: { source: docCells((d, i) => ids.has(recs[i].id)) },
        idf: { active: js.map((j) => [0, j]) },
      };
    }
    case "q": {
      const k = termRow(dims[cur.index].term);
      return {
        idf: { source: [[1, cur.index]] },
        terms: { source: k >= 0 ? [[k, 1]] : [] },
        tfidf: { active: [[0, cur.index]] },
      };
    }
    case "qall":
      return { tfidf: { active: row(0, V) } };
    case "row": {
      const i = cur.index;
      const cols = dims.map((d, j) => (docs[i].includes(d.term) ? j : -1)).filter((j) => j >= 0);
      return {
        docs: { source: [[i, 2]] },
        idf: { source: cols.map((j) => [1, j]) },
        tfidf: { active: row(i + 1, V) },
      };
    }
    default:
      return {};
  }
}

// ---- Explain a cell ----

function explainDoc(m, r, c) {
  const rec = m.recs[r];
  if (!rec) return null;
  if (c === 0) return { meaning: `Record ${rec.id}, one of the N = ${m.N} saved reminders. Each one is a document.` };
  if (c === 1) return { meaning: `The title of record ${rec.id}, exactly as saved.` };
  if (c !== 2) return null;
  const steps = termSteps(rec.title, m.p);
  const dropped = steps.filter((x) => !x.kept);
  return {
    meaning: `The search terms of record ${rec.id}'s title. Record titles go through the same filter as your request.`,
    formula: "terms(title) = keywords of the title, minus stop words and dates, with aliases applied",
    worked: `terms(“${rec.title}”) = [${m.docs[r].join(", ")}]${
      dropped.length ? `; dropped ${dropped.map((x) => `“${x.token}” (${x.reason})`).join(", ")}` : ""
    }`,
  };
}

function explainIdf(m, r, c) {
  const d = m.dims[c];
  if (!d) return null;
  const holders = m.holders[c];
  if (r === 0)
    return {
      meaning: `Document frequency of “${d.term}”: how many record titles contain it.`,
      formula: "df = number of documents that contain the term",
      worked: holders.length
        ? `“${d.term}” is in ${holders.join(", ")} → df = ${d.df}`
        : `no record title contains “${d.term}” (it comes from your request) → df = 0`,
    };
  if (r === 1) {
    const x = m.rule(d.df);
    return {
      meaning: m.p.useIdf
        ? `How rare “${d.term}” is across the ${m.N} titles. Rarer terms get a bigger weight because they say more about which record you mean.`
        : `IDF is turned off, so “${d.term}” weighs the same as every other term.`,
      formula: x.formula,
      worked: `idf(${d.term}) = ${x.worked}`,
    };
  }
  return null;
}

function explainWeight(m, r, c) {
  const d = m.dims[c];
  if (!d) return null;
  const words = r === 0 ? m.queryTerms : m.docs[r - 1];
  const rec = r === 0 ? null : m.recs[r - 1];
  if (!words) return null;
  const tf = words.filter((t) => t === d.term).length;
  const v = r === 0 ? m.query[c] : m.vectors[r - 1][c];
  const who = r === 0 ? "the query" : `record ${rec?.id}`;
  return {
    meaning: tf
      ? `The weight of “${d.term}” in ${who}: how often it appears there, times how rare it is.`
      : `“${d.term}” does not appear in ${who}, so its weight is 0.`,
    formula: "weight = tf × idf",
    worked: `${tf} × ${fixed(d.idf)} = ${fixed(v)}`,
  };
}

Object.assign(mod, {
  blocks(ctx) {
    const m = model(ctx);
    const { recs, docs, dims, query, vectors, N } = m;
    const labels = dims.map((d) => d.term);
    return [
      tableBlock({
        id: "docs",
        title: `documents = terms(record.title) · N = ${N}`,
        head: ["id", "title", "terms"],
        widths: [0.5, 2.8, 3.1],
        rows: recs.map((r, i) => [
          { text: r.id, bold: true },
          { text: r.title, align: "left", dim: true },
          docs[i].length ? { text: docs[i].join(" "), align: "left" } : { text: "(none)", tone: "muted" },
        ]),
        explain: (r, c) => explainDoc(m, r, c),
      }),
      tableBlock({
        id: "idf",
        title: m.rule(0).formula,
        head: labels,
        rowLabels: ["df", "idf"],
        rows: [
          dims.map((d) => ({ text: String(d.df), tone: d.df === 0 ? "warn" : undefined })),
          dims.map((d) => ({ text: fixed(d.idf, 3), value: d.idf })),
        ],
        explain: (r, c) => explainIdf(m, r, c),
      }),
      matrixBlock({
        id: "tfidf",
        title: "tf × idf · row 0 is the query",
        data: [query, ...vectors],
        rowLabels: ["query", ...recs.map((r) => r.id)],
        colLabels: labels,
        heat: "sequential",
        digits: 2,
        explain: (r, c) => explainWeight(m, r, c),
      }),
    ];
  },
  output: "tfidf",
  state(frame, ctx) {
    return revealState(mod, frame, ctx, cellsOf, {
      docs: (r, c) => c < 2,
      idf: () => false,
      tfidf: () => false,
    });
  },
  math(frame, ctx) {
    const m = model(ctx);
    const { recs, docs, dims, query, queryTerms, union, holders, tfq, N } = m;
    const cur = frame.cur ?? {};
    switch (cur.kind) {
      case "doc": {
        const r = recs[cur.index];
        return [{ label: r.id, terms: [`terms(“${r.title}”)`], result: `[${docs[cur.index].join(", ")}]` }];
      }
      case "query":
        return [{ label: "queryTerms", terms: queryTerms.length ? queryTerms : ["[]"], op: "," }];
      case "vocab":
        return frame.vocab === 1
          ? [{ label: "new Set", terms: [`${docs.flat().length} document terms`, `${queryTerms.length} query terms`], result: `${union.length} distinct` }]
          : [{ label: "sort()", terms: [`${dims.length} terms`], result: `dimensions 0 … ${Math.max(0, dims.length - 1)}` }];
      case "dim": {
        const js = (cur.list ?? [cur.index]).slice(0, 4);
        if (frame.phase === "IDF")
          return js.flatMap((j) => {
            const d = dims[j];
            const x = m.rule(d.df);
            if (!m.p.useIdf) return [{ label: `idf(${d.term})`, terms: ["IDF off"], result: "1" }];
            return [
              { label: `idf(${d.term})`, terms: [x.expr, "1"], result: fixed(d.idf) },
              { label: "", terms: [`ln(${fixed(x.ratio)}) = ${fixed(x.ln)}`, "1"], result: fixed(d.idf) },
            ];
          });
        return js.map((j) => ({ label: `df(${dims[j].term})`, terms: holders[j].length ? holders[j] : ["no record"], op: ",", result: String(dims[j].df) }));
      }
      case "q": {
        const j = cur.index;
        return [{ label: `q[${dims[j].term}]`, terms: [`tf ${tfq[j]}`, `idf ${fixed(dims[j].idf)}`], op: "×", result: fixed(query[j]) }];
      }
      case "qall": {
        const nz = dims.map((d, j) => (query[j] ? `${d.term} ${fixed(query[j])}` : null)).filter(Boolean);
        return [{ label: "query", terms: nz.length ? nz : ["all zero"], op: ",", result: `${dims.length - nz.length} zeros` }];
      }
      case "row": {
        const i = cur.index;
        const parts = dims.map((d, j) => ({ d, j, tf: docs[i].filter((t) => t === d.term).length })).filter((x) => x.tf);
        return parts.slice(0, 8).map((x) => ({
          label: `${recs[i].id}[${x.d.term}]`,
          terms: [`tf ${x.tf}`, `idf ${fixed(x.d.idf)}`],
          op: "×",
          result: fixed(m.vectors[i][x.j]),
        }));
      }
      default:
        return [{ label: "matrix", terms: [`${N + 1} rows × ${dims.length} columns`] }];
    }
  },
});

const rawFrames = mod.frames;
mod.frames = (ctx) => indexed(rawFrames.call(mod, ctx));

export default mod;
