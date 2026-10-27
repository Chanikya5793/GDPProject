// Geometry and painting for map blocks. A block is a titled grid of cells.
// Sizes are in world units; the 2D map and the 3D textures both call
// paintBlock with their own pixels-per-unit.

export const CELL_W = 1.6;
export const CELL_H = 0.8;
const PAD = 0.25;
const TITLE_H = 0.75;
// For renderers that draw block titles themselves (view.noTitle).
export const BLOCK_PAD = PAD;
export const TITLE_BAND = TITLE_H;
export const TITLE_SIZE = 0.36;
const COL_LABEL_H = 0.5;
const LABEL_FONT = 0.27;
const TITLE_FONT = 0.36;
const CELL_FONT = 0.29;
const SUB_FONT = 0.2;

// Canvas colours for both maps, per theme. setPalette() swaps them in place
// so every renderer reading COLORS / TONES follows the page's light or dark.
const PALETTES = {
  dark: {
    colors: {
      bg: "#111513",
      dot: "rgba(160, 185, 172, 0.12)",
      link: "#2c3631",
      plate: "#1a1f1d",
      plateGhost: "#151a18",
      plateRgb: [26, 31, 29],
      edge: "#2a332e",
      edgeGhost: "#212825",
      title: "#dde5e0",
      label: "#8fa69a",
      text: "#e8ede9",
      faint: "#3d4a44",
      pos: [98, 214, 190],
      neg: [240, 152, 120],
      seq: [166, 146, 255],
      active: "#ffcf7a",
      activeRgb: [255, 207, 122],
      source: "#8fb8ff",
      sourceRgb: [143, 184, 255],
      side: "#121614",
      grid: ["#1e2522", "#181d1b"],
    },
    tones: {
      keyword: { fg: "#c9b8ff", bg: "rgba(185, 160, 255, 0.16)" },
      context: { fg: "#93a0bd", bg: "rgba(147, 160, 189, 0.10)" },
      number: { fg: "#f4c09e", bg: "rgba(244, 180, 140, 0.15)" },
      punctuation: { fg: "#7d889f", bg: "rgba(125, 136, 159, 0.10)" },
      good: { fg: "#8fe3c8", bg: "rgba(110, 220, 190, 0.14)" },
      warn: { fg: "#f4c38b", bg: "rgba(244, 195, 139, 0.15)" },
      muted: { fg: "#6f8278", bg: "rgba(111, 130, 120, 0.06)" },
      accent: { fg: "#ffe2ad", bg: "rgba(255, 207, 122, 0.18)" },
    },
  },
  light: {
    colors: {
      bg: "#f3f7f5",
      dot: "rgba(6, 20, 16, 0.10)",
      link: "#c3d3cc",
      plate: "#ffffff",
      plateGhost: "#f7faf8",
      plateRgb: [255, 255, 255],
      edge: "#d2e0da",
      edgeGhost: "#e4ece8",
      title: "#061410",
      label: "#537268",
      text: "#061410",
      faint: "#c3d3cc",
      pos: [4, 150, 120],
      neg: [220, 100, 60],
      seq: [124, 58, 237],
      active: "#d97706",
      activeRgb: [217, 119, 6],
      source: "#2563eb",
      sourceRgb: [37, 99, 235],
      side: "#dfe9e4",
      grid: ["#dde7e2", "#e8efeb"],
    },
    tones: {
      keyword: { fg: "#6d28d9", bg: "rgba(109, 40, 217, 0.09)" },
      context: { fg: "#64748b", bg: "rgba(100, 116, 139, 0.08)" },
      number: { fg: "#b45309", bg: "rgba(180, 83, 9, 0.10)" },
      punctuation: { fg: "#94a3b8", bg: "rgba(148, 163, 184, 0.08)" },
      good: { fg: "#047857", bg: "rgba(4, 120, 87, 0.10)" },
      warn: { fg: "#b45309", bg: "rgba(180, 83, 9, 0.10)" },
      muted: { fg: "#8ea59b", bg: "rgba(142, 165, 155, 0.06)" },
      accent: { fg: "#92400e", bg: "rgba(217, 119, 6, 0.14)" },
    },
  },
};
export const COLORS = { ...PALETTES.dark.colors };
export const TONES = { ...PALETTES.dark.tones };
export function setPalette(mode, accent) {
  const p = PALETTES[mode === "light" ? "light" : "dark"];
  Object.assign(COLORS, p.colors, { accent: accent || (mode === "light" ? "#006a4e" : "#00c87a") });
  Object.assign(TONES, p.tones);
}
setPalette("dark");

const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';
const SANS = "Manrope, system-ui, sans-serif";
let measurer;
function measure(text, font) {
  // Tests run without a DOM; monospace glyphs are about 0.6 em wide.
  if (typeof document === "undefined") return text.length * font * 0.6;
  measurer ||= document.createElement("canvas").getContext("2d");
  measurer.font = `${font * 100}px ${MONO}`;
  return measurer.measureText(text).width / 100;
}

// Fills in derived geometry: size, column offsets, label widths.
export function shape(block) {
  const cw = block.cellW ?? CELL_W;
  const ch = block.cellH ?? CELL_H;
  const widths = Array.from({ length: block.cols }, (_, c) => (block.widths?.[c] ?? 1) * cw);
  const offsets = [];
  widths.reduce((x, w, i) => ((offsets[i] = x), x + w), 0);
  const labelW = block.rowLabels?.length
    ? Math.max(...block.rowLabels.map((l) => measure(String(l), LABEL_FONT))) + 0.35
    : 0;
  const top = (block.title ? TITLE_H : 0) + (block.colLabels ? COL_LABEL_H : 0);
  const gridW = widths.reduce((a, b) => a + b, 0);
  const titleW = block.title ? measure(block.title, TITLE_FONT * 0.92) : 0;
  return {
    ...block,
    cw,
    ch,
    widths,
    offsets,
    gx: PAD + labelW,
    gy: PAD + top,
    w: Math.max(PAD * 2 + labelW + gridW, titleW + PAD * 2),
    h: PAD * 2 + top + block.rows * ch,
  };
}

// Cell rectangle in block-local units.
export const cellRect = (b, r, c) => ({
  x: b.gx + b.offsets[c],
  y: b.gy + r * b.ch,
  w: b.widths[c],
  h: b.ch,
});

export function cellAt(b, x, y) {
  const r = Math.floor((y - b.gy) / b.ch);
  if (r < 0 || r >= b.rows) return null;
  const c = b.offsets.findIndex((o, i) => x >= b.gx + o && x < b.gx + o + b.widths[i]);
  return c < 0 ? null : [r, c];
}

function heat(kind, value, scale) {
  if (!Number.isFinite(value)) return null;
  // An exact zero is an empty slot: barely tinted, so the values stand out.
  if (value === 0) return "rgba(128, 128, 128, 0.07)";
  const a = 0.22 + Math.min(1, Math.abs(value) / (scale || 1)) * 0.6;
  const rgb = kind === "sequential" ? COLORS.seq : value >= 0 ? COLORS.pos : COLORS.neg;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a.toFixed(3)})`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fitText(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  // A decimal loses digits before it gets an ellipsis: 1.000 → 1.0 → 1.
  const decimal = /^-?\d+\.(\d+)$/.exec(text);
  if (decimal)
    for (let d = decimal[1].length - 1; d >= 0; d--) {
      const short = Number(text).toFixed(d);
      if (ctx.measureText(short).width <= max) return short;
    }
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

// view: { mode: "done" | "ghost" | "live", done(r, c), source: Set("r,c"),
//         active: Set("r,c"), highlights: boolean, noTitle?: boolean }
// The context is already translated to the block's corner and scaled so one
// unit is one pixel times `px`; text is skipped when it would be too small.
export function paintBlock(ctx, b, view, px) {
  const ghost = view.mode === "ghost";
  const minText = 6.5;
  ctx.save();
  ctx.scale(px, px);
  roundRect(ctx, 0, 0, b.w, b.h, 0.18);
  ctx.fillStyle = ghost ? COLORS.plateGhost : COLORS.plate;
  ctx.fill();
  ctx.lineWidth = 1 / px;
  ctx.strokeStyle = ghost ? COLORS.edgeGhost : COLORS.edge;
  ctx.stroke();
  ctx.textBaseline = "middle";
  if (b.title && !view.noTitle && TITLE_FONT * px >= minText) {
    ctx.font = `600 ${TITLE_FONT}px ${SANS}`;
    ctx.fillStyle = ghost ? COLORS.label : COLORS.title;
    ctx.textAlign = "left";
    ctx.fillText(fitText(ctx, b.title, b.w - PAD * 2), PAD, PAD + TITLE_H / 2 - 0.05);
  }
  if (ghost) {
    ctx.restore();
    return;
  }
  const labels = LABEL_FONT * px >= minText;
  if (b.colLabels && labels) {
    ctx.font = `${LABEL_FONT}px ${MONO}`;
    ctx.fillStyle = COLORS.label;
    ctx.textAlign = "center";
    b.colLabels.slice(0, b.cols).forEach((l, c) =>
      ctx.fillText(
        fitText(ctx, String(l), b.widths[c] - 0.08),
        b.gx + b.offsets[c] + b.widths[c] / 2,
        b.gy - COL_LABEL_H / 2,
      ),
    );
  }
  if (b.rowLabels?.length && labels) {
    ctx.font = `${LABEL_FONT}px ${MONO}`;
    ctx.fillStyle = COLORS.label;
    ctx.textAlign = "right";
    b.rowLabels.forEach((l, r) => ctx.fillText(String(l), b.gx - 0.2, b.gy + r * b.ch + b.ch / 2));
  }
  const text = CELL_FONT * px >= minText;
  const inset = 0.035;
  for (let r = 0; r < b.rows; r++)
    for (let c = 0; c < b.cols; c++) {
      const cell = b.cell(r, c);
      if (!cell) continue;
      const { x, y, w, h } = cellRect(b, r, c);
      const key = `${r},${c}`;
      const done = view.done ? view.done(r, c) : true;
      const masked = b.masked?.(r, c);
      roundRect(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, 0.08);
      if (!done) {
        ctx.strokeStyle = COLORS.faint;
        ctx.lineWidth = 1 / px;
        ctx.setLineDash([2 / px, 3 / px]);
        ctx.stroke();
        ctx.setLineDash([]);
        continue;
      }
      // In 3D, numeric cells are drawn as bars, so the plate only marks the cell.
      if (view.bars && b.heat) {
        ctx.fillStyle = "rgba(255,255,255,0.025)";
        ctx.fill();
        continue;
      }
      if (masked) {
        ctx.fillStyle = "rgba(255,255,255,0.025)";
        ctx.fill();
        if (text) {
          ctx.font = `${CELL_FONT}px ${MONO}`;
          ctx.fillStyle = COLORS.faint;
          ctx.textAlign = "center";
          ctx.fillText("−∞", x + w / 2, y + h / 2);
        }
        continue;
      }
      const tone = cell.tone && TONES[cell.tone];
      const fill = tone ? tone.bg : b.heat ? heat(b.heat, cell.value, b.scale) : "rgba(255,255,255,0.035)";
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (view.highlights && view.source?.has(key)) {
        ctx.strokeStyle = COLORS.source;
        ctx.lineWidth = 2.5 / px;
        ctx.stroke();
      }
      if (view.highlights && view.active?.has(key)) {
        ctx.strokeStyle = COLORS.active;
        ctx.lineWidth = 3 / px;
        ctx.stroke();
      }
      if (!text || cell.text === undefined || cell.text === "") continue;
      ctx.font = `${cell.bold ? 600 : 400} ${CELL_FONT}px ${MONO}`;
      ctx.fillStyle = tone ? tone.fg : cell.dim ? COLORS.label : COLORS.text;
      ctx.textAlign = cell.align ?? "center";
      const tx = ctx.textAlign === "left" ? x + 0.14 : x + w / 2;
      const ty = cell.sub ? y + h * 0.4 : y + h / 2;
      ctx.fillText(fitText(ctx, String(cell.text), w - 0.16), tx, ty);
      if (cell.sub && SUB_FONT * px >= minText - 1) {
        ctx.font = `${SUB_FONT}px ${MONO}`;
        ctx.fillStyle = COLORS.label;
        ctx.fillText(fitText(ctx, String(cell.sub), w - 0.1), tx, y + h * 0.78);
      }
    }
  ctx.restore();
}
