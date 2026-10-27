import { Panel, Table } from "../../kit.jsx";
import { vectorize } from "../../../engine/copilot.js";
import { row, tableBlock } from "../../../map/blocks.js";
import { gridOf, messageOf, num, paramsOf, plural, weightText, whatIfNote } from "./util.js";

const hashed = (ctx) => vectorize(messageOf(ctx).query, "", paramsOf(ctx)).rows;
const weighing = (p) => (p.logWeight ? "1 + ln(count)" : "count");

export default {
  id: "hashvector",
  source: [["copilot", "slotOf"], ["copilot", "vectorize"]],
  code: [
    "const counts = countWords(tokens(query))",
    "for (const [word, count] of counts) {",
    "  const digest = sha256(word)",
    "  const slot = parseInt(digest.slice(0, 8), 16) % p.dimensions",
    "  vector[slot] += p.logWeight ? 1 + Math.log(count) : count",
    "}",
  ],
  frames(ctx) {
    const p = paramsOf(ctx);
    const D = num(p.dimensions);
    const rows = hashed(ctx);
    const frames = [
      {
        phase: "Count",
        line: 0,
        say: `Count each search word. ${plural(rows.length, "distinct word")}; the vector starts as ${D} zeros.`,
        vars: { distinct: rows.length, "p.dimensions": p.dimensions },
        at: -1,
      },
    ];
    rows.forEach((r, i) => {
      frames.push({
        phase: "Hash",
        line: [1, 2, 3],
        say: `sha256(“${r.token}”) starts with ${r.digest.slice(0, 8)}. As a number that is ${num(r.first)}, and ${num(r.first)} mod ${D} = ${r.slot}, so “${r.token}” lands in box ${r.slot}.`,
        vars: { word: r.token, "digest[0:8]": r.digest.slice(0, 8), slot: r.slot },
        at: i,
        hold: 0.9,
      });
      frames.push({
        phase: "Weigh",
        line: 4,
        say: p.logWeight
          ? `It appears ${plural(r.count, "time")}, so box ${r.slot} gets 1 + ln(${r.count}) = ${r.weight.toFixed(3)}.`
          : `It appears ${plural(r.count, "time")}. With damping off, box ${r.slot} gets the plain count, ${r.weight}.`,
        vars: { word: r.token, count: r.count, weight: +r.weight.toFixed(3) },
        at: i,
        weighed: true,
        hold: 0.6,
      });
    });
    const used = new Set(rows.map((r) => r.slot)).size;
    frames.push({
      phase: "Done",
      line: 5,
      say:
        `The query is now ${plural(used, "non-zero box", "non-zero boxes")} out of ${D}. ` +
        (used < rows.length
          ? `${rows.length - used} of the ${rows.length} words share a box with another word: a hash collision. A later filter checks for a real shared word.`
          : "Two different words can share a box (a hash collision); a later filter checks for a real shared word.") +
        whatIfNote(ctx, "hashvector"),
      vars: { nonzero: used },
      at: rows.length,
      weighed: true,
    });
    return frames;
  },
  blocks(ctx) {
    const p = paramsOf(ctx);
    const D = num(p.dimensions);
    const g = gridOf(p.dimensions);
    const rows = hashed(ctx);
    const weights = new Map();
    for (const r of rows) weights.set(r.slot, (weights.get(r.slot) ?? 0) + r.weight);
    const explainHash = (i, c) => {
      const r = rows[i];
      if (!r) return null;
      switch (c) {
        case 0:
          return { meaning: "A search word from the previous step.", formula: "counts = countWords(tokens(query))", worked: `“${r.token}” appears ${plural(r.count, "time")}` };
        case 1:
          return {
            meaning: "The first 8 hex digits (4 bytes) of the word's SHA-256 fingerprint. The same word always gives the same fingerprint.",
            formula: "sha256(word).slice(0, 8)",
            worked: `sha256(“${r.token}”) = ${r.digest.slice(0, 16)}…`,
          };
        case 2:
          return { meaning: "Those 4 bytes read as one whole number.", formula: "parseInt(digest.slice(0, 8), 16)", worked: `0x${r.digest.slice(0, 8)} = ${num(r.first)}` };
        case 3:
          return {
            meaning: `The box this word goes into: the remainder after dividing by the number of boxes (${D}).`,
            formula: "slot = number mod dimensions",
            worked: `slot = 0x${r.digest.slice(0, 8)} mod ${D} = ${r.slot}`,
          };
        case 4:
          return { meaning: "How many times the word appears in the query.", formula: "count(word)", worked: `count(“${r.token}”) = ${r.count}` };
        default:
          return {
            meaning: p.logWeight ? "The weight added to the box. Repeats count less and less." : "The weight added to the box: the plain count, since damping is off.",
            formula: `weight = ${weighing(p)}`,
            worked: `${weightText(p, r.count)} = ${r.weight.toFixed(3)}`,
          };
      }
    };
    const explainSlot = (i, c) => {
      const slot = g.slotAt(i, c);
      if (slot >= p.dimensions) return null;
      const here = rows.filter((x) => x.slot === slot);
      if (!here.length)
        return { meaning: `Box ${slot} of ${D}. No search word hashed here, so it stays 0.`, formula: "v[slot] = Σ weights of words in this slot", worked: `v[${slot}] = 0` };
      return {
        meaning: here.length > 1
          ? `Box ${slot} of ${D}. ${here.length} different words landed here: a hash collision, so they look alike to the search.`
          : `Box ${slot} of ${D}, holding the word “${here[0].token}”.`,
        formula: `v[slot] = Σ ${weighing(p)} for each word with sha256(word) mod ${D} = slot`,
        worked: `v[${slot}] = ${here.map((x) => `${x.weight.toFixed(3)} (“${x.token}”)`).join(" + ")} = ${weights.get(slot).toFixed(3)}`,
      };
    };
    return [
      tableBlock({
        id: "chashes",
        title: `slot = sha256(word)[0:4] mod ${D}`,
        head: ["word", "sha256 …", "as number", "slot", "count", "weight"],
        widths: [1.3, 1.3, 1.6, 0.7, 0.7, 0.9],
        rows: rows.map((r) => [
          { text: r.token, tone: "keyword" },
          r.digest.slice(0, 8),
          num(r.first),
          { text: String(r.slot), bold: true },
          String(r.count),
          { text: r.weight.toFixed(3), value: r.weight },
        ]),
        explain: explainHash,
      }),
      {
        ...tableBlock({
          id: "cvector",
          title: `query vector: ${D} boxes (${g.rows} × ${g.cols})`,
          rows: Array.from({ length: g.rows }, (_, r) =>
            Array.from({ length: g.cols }, (_, c) => {
              const slot = g.slotAt(r, c);
              if (slot >= p.dimensions) return null;
              const w = weights.get(slot);
              return w ? { text: w.toFixed(1), value: w } : { text: "", value: 0 };
            }),
          ),
          cellW: g.cellW,
          cellH: g.cellH,
          heat: "sequential",
          scale: Math.max(1, ...weights.values()),
          explain: explainSlot,
        }),
        cols: g.cols,
      },
    ];
  },
  output: "cvector",
  state(frame, ctx) {
    const g = gridOf(paramsOf(ctx).dimensions);
    const rows = hashed(ctx);
    const r = rows[frame.at];
    const slots = new Set(rows.map((x) => x.slot));
    const placed = new Set(rows.slice(0, frame.weighed ? frame.at + 1 : frame.at).map((x) => x.slot));
    return {
      ctokens: { source: r ? [[frame.at, 1]] : [] },
      chashes: {
        done: (i, c) => i < frame.at || (i === frame.at && (frame.weighed || c < 4)),
        active: r ? (frame.weighed ? [[frame.at, 5]] : row(frame.at, 4)) : [],
      },
      cvector: {
        done: (i, c) => {
          const slot = g.slotAt(i, c);
          return !slots.has(slot) || placed.has(slot);
        },
        active: r && frame.weighed ? [g.cellOf(r.slot)] : [],
      },
    };
  },
  math(frame, ctx) {
    const p = paramsOf(ctx);
    const r = hashed(ctx)[frame.at];
    if (!r) return [];
    return frame.weighed
      ? [{ label: `v[${r.slot}]`, terms: [weightText(p, r.count)], op: "", result: r.weight.toFixed(4) }]
      : [
          { label: "sha256", terms: [`“${r.token}”`], op: "", result: `${r.digest.slice(0, 16)}…` },
          { label: "0x" + r.digest.slice(0, 8), terms: [num(r.first)], op: "", result: `mod ${p.dimensions} = ${r.slot}` },
        ];
  },
  Stage({ ctx, frame }) {
    const rows = hashed(ctx);
    return (
      <Panel title="Words to boxes" note={`${num(paramsOf(ctx).dimensions)} boxes.${whatIfNote(ctx, "hashvector")}`}>
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
