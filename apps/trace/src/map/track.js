// A track is every step of one mode laid out left to right on one map, plus
// one flat list of frames. Each step module contributes:
//   blocks(ctx)        → the data it draws (see paint.js for the block shape)
//   state(frame, ctx)  → { [blockId]: { done?(r, c), active?: [[r, c]], source?: [[r, c]] } }
//   math(frame, ctx)   → [{ label, terms, op?, result }] arithmetic for the guide
//   links?(ctx)        → [{ from, to }] extra arrows; the previous step's
//                        output block always links to this step's first block
//   output?            → id of the block later steps read (default: last)
import { shape } from "./paint.js";

const BLOCK_GAP = 1.1;
const COLUMN_GAP = 5;

function layoutColumn(blocks, x) {
  const rows = [];
  for (const b of blocks) {
    if (b.beside && rows.length) rows.at(-1).push(b);
    else rows.push([b]);
  }
  const rowSizes = rows.map((row) => ({
    w: row.reduce((s, b) => s + b.w, 0) + BLOCK_GAP * (row.length - 1),
    h: Math.max(...row.map((b) => b.h)),
  }));
  const width = Math.max(4, ...rowSizes.map((r) => r.w));
  const height = rowSizes.reduce((s, r) => s + r.h, 0) + BLOCK_GAP * (rows.length - 1);
  let y = -height / 2;
  rows.forEach((row, i) => {
    let bx = x;
    row.forEach((b) => {
      b.x = bx;
      b.y = y;
      bx += b.w + BLOCK_GAP;
    });
    y += rowSizes[i].h + BLOCK_GAP;
  });
  return { x, y: -height / 2, w: width, h: height };
}

export function buildTrack(steps, modules, ctx) {
  let x = 0;
  const byId = new Map();
  const frames = [];
  const columns = steps.map((step, si) => {
    const module = modules[step.id];
    const local = module ? module.frames(ctx) : [{ say: step.summary, phase: "", vars: {} }];
    const blocks = (module?.blocks?.(ctx) ?? []).map((b) => ({ ...shape(b), step: si }));
    blocks.forEach((b) => byId.set(b.id, b));
    const box = layoutColumn(blocks, x);
    x += box.w + COLUMN_GAP;
    const start = frames.length;
    local.forEach((frame, fi) => frames.push({ si, fi, frame }));
    return {
      step,
      module,
      blocks,
      box,
      start,
      count: local.length,
      output: module?.output ?? blocks.at(-1)?.id,
    };
  });
  const links = [];
  columns.forEach((col, si) => {
    const prev = columns[si - 1];
    if (prev?.output && col.blocks[0])
      links.push({ from: prev.output, to: col.blocks[0].id, between: true });
    for (const l of col.module?.links?.(ctx) ?? [])
      if (byId.has(l.from) && byId.has(l.to)) links.push(l);
  });
  const all = columns.flatMap((c) => c.blocks);
  const bounds = all.length
    ? {
        x: Math.min(...all.map((b) => b.x)),
        y: Math.min(...all.map((b) => b.y)),
        w: Math.max(...all.map((b) => b.x + b.w)) - Math.min(...all.map((b) => b.x)),
        h: Math.max(...all.map((b) => b.y + b.h)) - Math.min(...all.map((b) => b.y)),
      }
    : { x: 0, y: 0, w: 1, h: 1 };
  return { columns, blocks: all, byId, links, frames, bounds, ctx };
}

const keys = (cells) => new Set((cells ?? []).map(([r, c]) => `${r},${c}`));

// Everything a renderer needs for global frame `g`.
export function sceneAt(track, g) {
  const at = track.frames[Math.max(0, Math.min(g, track.frames.length - 1))];
  if (!at) return { views: new Map(), groups: [], si: 0 };
  const col = track.columns[at.si];
  const state = col.module?.state?.(at.frame, track.ctx) ?? {};
  const prevAt = track.frames[g - 1];
  const prevState =
    prevAt && prevAt.si === at.si ? (col.module?.state?.(prevAt.frame, track.ctx) ?? {}) : null;
  const views = new Map();
  const groups = [];
  for (const b of track.blocks) {
    const s = state[b.id];
    if (b.step > at.si && !s) {
      views.set(b.id, { mode: "ghost", key: "ghost" });
      continue;
    }
    const live = b.step === at.si || s;
    const view = {
      mode: live ? "live" : "done",
      key: live ? `${g}` : "done",
      done: s?.done,
      active: keys(s?.active),
      source: keys(s?.source),
      highlights: true,
    };
    if (live && s?.done) {
      const before = prevState?.[b.id]?.done;
      view.fresh = [];
      for (let r = 0; r < b.rows; r++)
        for (let c = 0; c < b.cols; c++)
          if (s.done(r, c) && !(before ? before(r, c) : g === col.start ? false : true))
            view.fresh.push([r, c]);
    }
    views.set(b.id, view);
    if (s?.active?.length) groups.push({ block: b, cells: s.active, role: "active" });
    if (s?.source?.length) groups.push({ block: b, cells: s.source, role: "source" });
  }
  return { views, groups, si: at.si, fi: at.fi, frame: at.frame, column: col };
}

export function cellsBox(block, cells) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [r, c] of cells) {
    const x = block.x + block.gx + block.offsets[c];
    const y = block.y + block.gy + r * block.ch;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + block.widths[c]);
    y1 = Math.max(y1, y + block.ch);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function union(boxes) {
  const list = boxes.filter(Boolean);
  if (!list.length) return null;
  const x = Math.min(...list.map((b) => b.x));
  const y = Math.min(...list.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(...list.map((b) => b.x + b.w)) - x,
    h: Math.max(...list.map((b) => b.y + b.h)) - y,
  };
}

// The cells this frame reads and writes inside its own step: what the camera
// frames. Reads from earlier steps only draw flow lines.
export function focusOf(scene) {
  return union(
    scene.groups.filter((g) => g.block.step === scene.si).map((g) => cellsBox(g.block, g.cells)),
  );
}

// The box the amber frame glides to: the first written group, if its cells
// fill most of their bounding box (scattered cells get no frame).
export function glideOf(scene) {
  const g = scene.groups.find((x) => x.role === "active");
  if (!g) return null;
  const box = cellsBox(g.block, g.cells);
  const area = g.cells.reduce((s, [, c]) => s + g.block.widths[c] * g.block.ch, 0);
  return area >= box.w * box.h * 0.5 ? box : null;
}

export const stepIndexOf = (track, si) => track.columns[si]?.start ?? 0;
