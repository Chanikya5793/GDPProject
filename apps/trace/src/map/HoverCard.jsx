// The card that follows the pointer over a map cell, shared by 2D and 3D.
// It names the block, the cell's row and column, the value, and when the
// step module provides block.explain, what the value means and how it was
// computed with this run's numbers.
import { GlossedNotes } from "../teach/Glossed.jsx";

// Whether a hit cell has something to show at this frame.
export function hoverable(hit, scene) {
  if (!hit?.cell) return null;
  const [r, c] = hit.cell;
  const cell = hit.block.cell(r, c);
  const view = scene.views.get(hit.block.id);
  if (!cell || view?.mode === "ghost" || (view?.done && !view.done(r, c))) return null;
  return { block: hit.block, r, c, cell };
}
export const sameHover = (a, b) => a === b || (!!a && !!b && a.block === b.block && a.r === b.r && a.c === b.c);

function explainOf(block, r, c) {
  if (typeof block.explain !== "function") return null;
  try {
    const e = block.explain(r, c);
    return e && typeof e === "object" && (e.meaning || e.formula || e.worked) ? e : null;
  } catch {
    return null;
  }
}

const valueText = (cell) =>
  typeof cell.value === "number"
    ? Number.isFinite(cell.value)
      ? String(Number(cell.value.toFixed(6)))
      : cell.value > 0
        ? "∞"
        : "−∞"
    : (cell.full ?? cell.text ?? "");

export default function HoverCard({ hover, cardRef }) {
  if (!hover)
    return <div ref={cardRef} className="map-tip" hidden />;
  const { block, r, c, cell } = hover;
  const where =
    [block.rowLabels?.[r], block.colLabels?.[c]].filter((v) => v !== undefined && v !== "").join(" · ") ||
    `row ${r}, column ${c}`;
  const explain = explainOf(block, r, c);
  return (
    <div ref={cardRef} className="map-tip" role="tooltip">
      <b>{block.title ?? block.id}</b>
      <span className="tip-where">{where}</span>
      <code className="tip-value">{valueText(cell)}</code>
      {explain && (
        <div className="tip-explain">
          {explain.meaning && <GlossedNotes text={explain.meaning} />}
          {explain.formula && <code className="tip-formula">{explain.formula}</code>}
          {explain.worked && <code className="tip-worked">{explain.worked}</code>}
        </div>
      )}
    </div>
  );
}

// Keep the card beside the pointer and inside the part of the map that no
// panel covers. x, y and the box are in the map's own pixels.
export function placeCard(card, x, y, box) {
  if (!card || card.hidden) return;
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  let left = x + 16;
  if (left + w > box.right) left = x - 16 - w;
  left = Math.max(box.left, Math.min(left, box.right - w));
  let top = y + 18;
  if (top + h > box.bottom) top = y - 14 - h;
  top = Math.max(box.top, Math.min(top, box.bottom - h));
  card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

// The free area of a map W × H wide with these panel insets.
export const freeBox = (W, H, insets) => ({
  left: insets.left > 0 ? insets.left - 12 : 8,
  right: W - Math.max(8, insets.right - 8),
  top: Math.max(8, insets.top - 8),
  bottom: H - Math.max(8, insets.bottom - 8),
});
