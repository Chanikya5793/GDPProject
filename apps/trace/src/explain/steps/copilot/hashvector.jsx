import { Panel, Table } from "../../kit.jsx";
import { DIMENSIONS, QUERY_CHARS, VECTOR_COLS, vectorize } from "../../../engine/copilot.js";
import { row, tableBlock } from "../../../map/blocks.js";

const COLS = VECTOR_COLS;
const ROWS = DIMENSIONS / COLS;
const hashed = (ctx) => vectorize(ctx.copilot.message.trim().slice(0, QUERY_CHARS)).rows;
const cellOf = (slot) => [Math.floor(slot / COLS), slot % COLS];

export default {
  id: "hashvector",
  source: [["copilot", "slotOf"], ["copilot", "vectorize"]],
  code: [
    "const counts = countWords(tokens(query))",
    "for (const [word, count] of counts) {",
    "  const digest = sha256(word)",
    "  const slot = parseInt(digest.slice(0, 8), 16) % 768",
    "  vector[slot] += 1 + Math.log(count)",
    "}",
  ],
  frames(ctx) {
    const rows = hashed(ctx);
    const frames = [
      {
        phase: "Count",
        line: 0,
        say: `Count each search word. ${rows.length} distinct word${rows.length === 1 ? "" : "s"}; the vector starts as 768 zeros.`,
        vars: { distinct: rows.length, dimensions: DIMENSIONS },
        at: -1,
      },
    ];
    rows.forEach((r, i) => {
      frames.push({
        phase: "Hash",
        line: [1, 2, 3],
        say: `sha256(“${r.token}”) starts with ${r.digest.slice(0, 8)}. As a number that is ${r.first.toLocaleString("en-US")}, and ${r.first.toLocaleString("en-US")} mod 768 = ${r.slot}, so “${r.token}” lands in box ${r.slot}.`,
        vars: { word: r.token, "digest[0:8]": r.digest.slice(0, 8), slot: r.slot },
        at: i,
        hold: 0.9,
      });
      frames.push({
        phase: "Weigh",
        line: 4,
        say: `It appears ${r.count} time${r.count === 1 ? "" : "s"}, so box ${r.slot} gets 1 + ln(${r.count}) = ${r.weight.toFixed(3)}.`,
        vars: { word: r.token, count: r.count, weight: +r.weight.toFixed(3) },
        at: i,
        weighed: true,
        hold: 0.6,
      });
    });
    frames.push({
      phase: "Done",
      line: 5,
      say: `The query is now ${rows.length} non-zero box${rows.length === 1 ? "" : "es"} out of 768. Two different words can share a box (a hash collision); a later filter checks for a real shared word.`,
      vars: { nonzero: new Set(rows.map((r) => r.slot)).size },
      at: rows.length,
      weighed: true,
    });
    return frames;
  },
  blocks(ctx) {
    const rows = hashed(ctx);
    const weights = new Map();
    for (const r of rows) weights.set(r.slot, (weights.get(r.slot) ?? 0) + r.weight);
    return [
      tableBlock({
        id: "chashes",
        title: "slot = sha256(word)[0:4] mod 768",
        head: ["word", "sha256 …", "as number", "slot", "count", "weight"],
        widths: [1.3, 1.3, 1.6, 0.7, 0.7, 0.9],
        rows: rows.map((r) => [
          { text: r.token, tone: "keyword" },
          r.digest.slice(0, 8),
          r.first.toLocaleString("en-US"),
          { text: String(r.slot), bold: true },
          String(r.count),
          { text: r.weight.toFixed(3), value: r.weight },
        ]),
      }),
      {
        ...tableBlock({
          id: "cvector",
          title: "query vector: 768 boxes (24 × 32)",
          rows: Array.from({ length: ROWS }, (_, r) =>
            Array.from({ length: COLS }, (_, c) => {
              const w = weights.get(r * COLS + c);
              return w ? { text: w.toFixed(1), value: w } : { text: "", value: 0 };
            }),
          ),
          cellW: 0.62,
          cellH: 0.5,
          heat: "sequential",
          scale: Math.max(1, ...weights.values()),
        }),
        cols: COLS,
      },
    ];
  },
  output: "cvector",
  state(frame, ctx) {
    const rows = hashed(ctx);
    const r = rows[frame.at];
    const placed = new Set(rows.slice(0, frame.weighed ? frame.at + 1 : frame.at).map((x) => x.slot));
    return {
      ctokens: { source: r ? [[frame.at, 1]] : [] },
      chashes: {
        done: (i, c) => i < frame.at || (i === frame.at && (frame.weighed || c < 4)),
        active: r ? (frame.weighed ? [[frame.at, 5]] : row(frame.at, 4)) : [],
      },
      cvector: {
        done: (i, c) => {
          const slot = i * COLS + c;
          return !rows.some((x) => x.slot === slot) || placed.has(slot);
        },
        active: r && frame.weighed ? [cellOf(r.slot)] : [],
      },
    };
  },
  math(frame, ctx) {
    const r = hashed(ctx)[frame.at];
    if (!r) return [];
    return frame.weighed
      ? [{ label: `v[${r.slot}]`, terms: [`1 + ln(${r.count})`], op: "", result: r.weight.toFixed(4) }]
      : [
          { label: "sha256", terms: [`“${r.token}”`], op: "", result: `${r.digest.slice(0, 16)}…` },
          { label: "0x" + r.digest.slice(0, 8), terms: [r.first.toLocaleString("en-US")], op: "", result: `mod 768 = ${r.slot}` },
        ];
  },
  Stage({ ctx, frame }) {
    const rows = hashed(ctx);
    return (
      <Panel title="Words to boxes">
        <Table
          head={["word", "digest", "slot", "weight"]}
          active={frame.at}
          rows={rows.map((r, i) =>
            i <= frame.at
              ? [<code key="w">{r.token}</code>, <code key="d">{r.digest.slice(0, 8)}</code>, r.slot, r.weight.toFixed(3)]
              : { cls: "is-pending", cells: ["", "", "", ""] },
          )}
        />
      </Panel>
    );
  },
};
