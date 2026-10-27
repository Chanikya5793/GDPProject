// Builders for the blocks step modules put on the map, and small helpers for
// naming cells in state(). Cell coordinates are [row, column].
//
// Every builder takes an optional `explain(r, c)` for the map's hover card:
//   → { meaning: what this value is, formula?: the rule that made it,
//       worked?: the rule with this run's numbers plugged in } | null
import { fixed } from "../explain/kit.jsx";

export function matrixBlock({
  id,
  title,
  data,
  rowLabels,
  colLabels,
  heat = "diverging",
  digits = 2,
  cellW,
  scale,
  masked,
  beside,
  explain,
}) {
  return {
    id,
    title,
    explain,
    rows: data.length,
    cols: data[0]?.length ?? 0,
    rowLabels: data.length ? rowLabels : undefined,
    colLabels: data.length ? colLabels : undefined,
    heat,
    scale,
    cellW,
    masked,
    beside,
    cell: (r, c) => {
      const v = data[r]?.[c];
      return v === undefined ? null : { text: fixed(v, digits), value: v };
    },
  };
}

// A table whose cells are strings, numbers or { text, tone, value, sub }.
export function tableBlock({ id, title, head, rows, widths, rowLabels, beside, cellW, cellH, heat, scale, explain }) {
  return {
    id,
    title,
    explain,
    rows: rows.length,
    cols: head?.length ?? rows[0]?.length ?? 0,
    colLabels: head,
    rowLabels,
    widths,
    beside,
    cellW,
    cellH,
    heat,
    scale,
    cell: (r, c) => {
      const v = rows[r]?.[c];
      if (v === undefined || v === null) return null;
      if (typeof v === "object") return v;
      return typeof v === "number" ? { text: fixed(v, 3), value: v } : { text: String(v) };
    },
  };
}

// Code points of a string laid out as a wrapped grid, each with its UTF-16
// offset underneath. at(offset) gives the cell of the code point there.
export function charGrid(text, cols = 18) {
  const chars = [];
  let offset = 0;
  for (const ch of text) {
    chars.push({ ch, offset });
    offset += ch.length;
  }
  const width = Math.max(1, Math.min(cols, chars.length));
  const index = new Map(chars.map((c, i) => [c.offset, i]));
  const cellOf = (i) => [Math.floor(i / width), i % width];
  return {
    chars,
    cols: width,
    rows: Math.max(1, Math.ceil(chars.length / width)),
    cellOf,
    // Cells covering UTF-16 range [start, end).
    span: (start, end) =>
      chars.map((c, i) => [c, i]).filter(([c]) => c.offset >= start && c.offset < end).map(([, i]) => cellOf(i)),
    at: (offset) => (index.has(offset) ? cellOf(index.get(offset)) : null),
  };
}

export function charsBlock({ id, title, text, cols = 18, tone, beside, explain }) {
  const grid = charGrid(text, cols);
  return {
    id,
    title,
    explain,
    rows: grid.rows,
    cols: grid.cols,
    cellW: 0.78,
    cellH: 1.05,
    beside,
    cell: (r, c) => {
      const item = grid.chars[r * grid.cols + c];
      if (!item) return null;
      const space = /\s/.test(item.ch);
      return {
        text: space ? "␣" : item.ch,
        sub: String(item.offset),
        dim: space,
        tone: typeof tone === "function" ? tone(item, r * grid.cols + c) : tone,
        full: `“${item.ch}” U+${item.ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")} at offset ${item.offset}`,
      };
    },
  };
}

export const row = (r, cols) => Array.from({ length: cols }, (_, c) => [r, c]);
export const column = (c, rows) => Array.from({ length: rows }, (_, r) => [r, c]);
export const all = (rows, cols) =>
  Array.from({ length: rows * cols }, (_, i) => [Math.floor(i / cols), i % cols]);
export const rowsUpTo = (last) => (r) => r <= last;
export const none = () => false;
