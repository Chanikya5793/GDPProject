import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cellAt, COLORS, paintBlock } from "./paint.js";
import HoverCard, { freeBox, hoverable, placeCard, sameHover } from "./HoverCard.jsx";
import { approach, ease, framing, overview } from "./camera.js";
import { cellsBox, focusOf, glideOf } from "./track.js";

export const READABLE = 34; // px per unit where cell text is ~10px
const MAX_ZOOM = 64;
const MIN_ZOOM = 3;
const MAX_CACHE = 160;

function center(box) {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}
function curve(ctx, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Bow sideways so arrows between neighbours do not overlap the cells.
  const cx = (a.x + b.x) / 2 - dy * 0.25;
  const cy = (a.y + b.y) / 2 + dx * 0.25;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.quadraticCurveTo(cx, cy, b.x, b.y);
  return (t) => ({
    x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * cx + t * t * b.x,
    y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * cy + t * t * b.y,
  });
}

export default function Map2D({ track, scene, insets, follow, overviewing, onUserMove, onCell, reduced }) {
  const canvasRef = useRef(null);
  const tipRef = useRef(null);
  const [hover, setHover] = useState(null);
  const showHover = useRef(setHover);
  const live = useRef({
    cam: null,
    target: null,
    caches: new Map(),
    changedAt: 0,
    activeFrom: null,
    activeTo: null,
  });
  const props = useRef({});
  // The render loop reads the latest props from here.
  useLayoutEffect(() => {
    props.current = { track, scene, insets, follow, overviewing, onUserMove, onCell, reduced };
  });

  // Recompute the camera target whenever the frame or the follow mode changes.
  useEffect(() => {
    const s = live.current;
    const canvas = canvasRef.current;
    if (!canvas || !scene.column) return;
    const view = {
      w: canvas.clientWidth - insets.left - insets.right - 48,
      h: canvas.clientHeight - insets.top - insets.bottom - 48,
    };
    const active = glideOf(scene);
    const focus = focusOf(scene);
    const step = scene.column.box;
    const stepBox = { x: step.x - 1, y: step.y - 2.2, w: step.w + 2, h: step.h + 3.2 };
    s.target = overviewing
      ? overview(track.bounds, view)
      : framing({
          stepBox,
          focusBox: focus && { x: focus.x - 0.6, y: focus.y - 0.6, w: focus.w + 1.2, h: focus.h + 1.2 },
          view,
          readable: READABLE,
          maxZoom: MAX_ZOOM,
        });
    if (!s.cam) s.cam = { ...s.target };
    const written = scene.groups.find((g) => g.role === "active");
    s.flowTo = written ? cellsBox(written.block, written.cells) : null;
    s.activeFrom = s.activeTo && active ? s.drawnActive ?? s.activeTo : active;
    s.activeTo = active;
    s.changedAt = performance.now();
  }, [scene, follow, overviewing, insets, track]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const s = live.current;
    let raf = 0;
    let last = performance.now();
    let dpr = 1;
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    }
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const origin = () => {
      const { insets } = props.current;
      return {
        x: insets.left + (canvas.clientWidth - insets.left - insets.right) / 2,
        y: insets.top + (canvas.clientHeight - insets.top - insets.bottom) / 2,
      };
    };
    const toScreen = (x, y) => {
      const o = origin();
      return { x: (x - s.cam.x) * s.cam.z + o.x, y: (y - s.cam.y) * s.cam.z + o.y };
    };
    const toWorld = (x, y) => {
      const o = origin();
      return { x: (x - o.x) / s.cam.z + s.cam.x, y: (y - o.y) / s.cam.z + s.cam.y };
    };

    function blockImage(b, view, px) {
      const key = `${b.id}|${view.key}|${px}`;
      let image = s.caches.get(key);
      if (image) {
        s.caches.delete(key);
        s.caches.set(key, image);
        return image;
      }
      image = document.createElement("canvas");
      image.width = Math.ceil(b.w * px);
      image.height = Math.ceil(b.h * px);
      paintBlock(image.getContext("2d"), b, { ...view, highlights: false }, px);
      s.caches.set(key, image);
      if (s.caches.size > MAX_CACHE) s.caches.delete(s.caches.keys().next().value);
      return image;
    }

    function draw(now) {
      raf = requestAnimationFrame(draw);
      const { track, scene, follow, overviewing, reduced } = props.current;
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (!s.cam || !s.target) return;
      if (follow || overviewing) {
        const settle = reduced ? 0.001 : 0.7;
        s.cam.x = approach(s.cam.x, s.target.x, dt, settle);
        s.cam.y = approach(s.cam.y, s.target.y, dt, settle);
        s.cam.z = Math.exp(approach(Math.log(s.cam.z), Math.log(s.target.z), dt, settle));
      }
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      const z = s.cam.z;
      updateHover(scene, W, H);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, W, H);

      // Dot grid: one dot per unit up close, one per five units further out.
      const spacing = z > 22 ? 1 : 5;
      const a = toWorld(0, 0);
      const b = toWorld(W, H);
      ctx.fillStyle = COLORS.dot;
      const dot = Math.max(1, Math.min(1.6, z / 30));
      for (let gx = Math.floor(a.x / spacing) * spacing; gx <= b.x; gx += spacing)
        for (let gy = Math.floor(a.y / spacing) * spacing; gy <= b.y; gy += spacing) {
          const p = toScreen(gx, gy);
          ctx.fillRect(p.x, p.y, dot, dot);
        }

      const si = scene.si;
      const accent = COLORS.accent;
      const t = reduced ? 1 : Math.min(1, (now - s.changedAt) / 420);

      // Arrows between steps and between blocks.
      ctx.lineWidth = 1.25;
      for (const link of track.links) {
        const from = track.byId.get(link.from);
        const to = track.byId.get(link.to);
        const forward = to.x > from.x + from.w - 0.01;
        const p0 = forward
          ? toScreen(from.x + from.w + 0.15, from.y + from.h / 2)
          : toScreen(from.x + from.w / 2, from.y + from.h + 0.15);
        const p1 = forward
          ? toScreen(to.x - 0.25, to.y + to.h / 2)
          : toScreen(to.x + to.w / 2, to.y - 0.25);
        const near = to.step === si;
        ctx.strokeStyle = near ? `${accent}99` : COLORS.link;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        if (forward) {
          const mx = (p0.x + p1.x) / 2;
          ctx.bezierCurveTo(mx, p0.y, mx, p1.y, p1.x, p1.y);
        } else {
          const my = (p0.y + p1.y) / 2;
          ctx.bezierCurveTo(p0.x, my, p1.x, my, p1.x, p1.y);
        }
        ctx.stroke();
        const head = Math.max(4, Math.min(8, z * 0.18));
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        if (forward) {
          ctx.moveTo(p1.x + head, p1.y);
          ctx.lineTo(p1.x, p1.y - head * 0.6);
          ctx.lineTo(p1.x, p1.y + head * 0.6);
        } else {
          ctx.moveTo(p1.x, p1.y + head);
          ctx.lineTo(p1.x - head * 0.6, p1.y);
          ctx.lineTo(p1.x + head * 0.6, p1.y);
        }
        ctx.fill();
      }

      // Step names above their columns.
      track.columns.forEach((col, i) => {
        const p = toScreen(col.box.x, col.box.y - 0.9);
        const size = Math.max(12.5, Math.min(20, z * 0.55));
        ctx.font = `600 ${size}px Manrope, system-ui, sans-serif`;
        ctx.textBaseline = "alphabetic";
        ctx.textAlign = "left";
        // Steps not reached yet stay readable, only quieter.
        ctx.fillStyle = i === si ? accent : COLORS.label;
        ctx.globalAlpha = i > si ? 0.6 : 1;
        ctx.fillText(`${String(i + 1).padStart(2, "0")}  ${col.step.name}`, p.x, p.y);
        ctx.globalAlpha = 1;
      });

      // Blocks, from cached bitmaps at a zoom bucket close to the screen scale.
      const px = 2 ** (Math.round(Math.log2(z * dpr) * 3) / 3);
      for (const block of track.blocks) {
        const p = toScreen(block.x, block.y);
        const w = block.w * z;
        const h = block.h * z;
        if (p.x > W || p.y > H || p.x + w < 0 || p.y + h < 0) continue;
        const view = scene.views.get(block.id) ?? { mode: "done", key: "done" };
        ctx.globalAlpha = view.mode === "ghost" ? 0.55 : 1;
        if (block.w * px > 4096 || block.h * px > 4096) {
          ctx.save();
          ctx.translate(p.x, p.y);
          paintBlock(ctx, block, { ...view, highlights: false }, z);
          ctx.restore();
        } else ctx.drawImage(blockImage(block, view, px), p.x, p.y, w, h);
        ctx.globalAlpha = 1;
        // Cells that were just computed fade in.
        if (view.fresh?.length && t < 1) {
          ctx.fillStyle = `rgba(${COLORS.plateRgb.join(", ")}, ${1 - ease(t)})`;
          for (const [r, c] of view.fresh) {
            const q = toScreen(
              block.x + block.gx + block.offsets[c],
              block.y + block.gy + r * block.ch,
            );
            ctx.fillRect(q.x, q.y, block.widths[c] * z, block.ch * z);
          }
        }
      }

      // What this frame reads (blue) and writes (amber), with a flow between.
      const cellPath = (block, r, c, inset = 0.04) => {
        const q = toScreen(
          block.x + block.gx + block.offsets[c] + inset,
          block.y + block.gy + r * block.ch + inset,
        );
        ctx.beginPath();
        ctx.roundRect(q.x, q.y, (block.widths[c] - inset * 2) * z, (block.ch - inset * 2) * z, 0.1 * z);
      };
      const fade = ease(t);
      const activeBox = s.activeTo;
      const flowBox = s.flowTo;
      for (const g of scene.groups) {
        if (g.role !== "source") continue;
        ctx.strokeStyle = `rgba(${COLORS.sourceRgb.join(", ")}, ${0.9 * fade})`;
        ctx.fillStyle = `rgba(${COLORS.sourceRgb.join(", ")}, ${0.13 * fade})`;
        ctx.lineWidth = 1.5;
        for (const [r, c] of g.cells) {
          cellPath(g.block, r, c);
          ctx.fill();
          ctx.stroke();
        }
        if (!flowBox) continue;
        const from = center(cellsBox(g.block, g.cells));
        const to = center(flowBox);
        const a0 = toScreen(from.x, from.y);
        const a1 = toScreen(to.x, to.y);
        if (Math.hypot(a1.x - a0.x, a1.y - a0.y) < 12) continue;
        ctx.setLineDash([5, 6]);
        ctx.lineDashOffset = reduced ? 0 : -now / 40;
        ctx.strokeStyle = `rgba(${COLORS.sourceRgb.join(", ")}, ${0.55 * fade})`;
        ctx.lineWidth = 1.5;
        const at = curve(ctx, a0, a1);
        ctx.stroke();
        ctx.setLineDash([]);
        if (!reduced) {
          const travel = Math.min(1, (now - s.changedAt) / 650);
          if (travel < 1) {
            const q = at(ease(travel));
            ctx.fillStyle = COLORS.active;
            ctx.beginPath();
            ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      for (const g of scene.groups) {
        if (g.role !== "active") continue;
        ctx.strokeStyle = `rgba(${COLORS.activeRgb.join(", ")}, ${fade})`;
        ctx.fillStyle = `rgba(${COLORS.activeRgb.join(", ")}, ${0.16 * fade})`;
        ctx.lineWidth = 2;
        for (const [r, c] of g.cells) {
          cellPath(g.block, r, c);
          ctx.fill();
          ctx.stroke();
        }
      }
      // A frame glides from the previous result to this one.
      if (activeBox && s.activeFrom) {
        const k = ease(Math.min(1, (now - s.changedAt) / 380));
        const box = {
          x: s.activeFrom.x + (activeBox.x - s.activeFrom.x) * k,
          y: s.activeFrom.y + (activeBox.y - s.activeFrom.y) * k,
          w: s.activeFrom.w + (activeBox.w - s.activeFrom.w) * k,
          h: s.activeFrom.h + (activeBox.h - s.activeFrom.h) * k,
        };
        s.drawnActive = box;
        const q = toScreen(box.x - 0.08, box.y - 0.08);
        ctx.strokeStyle = COLORS.active;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(q.x, q.y, (box.w + 0.16) * z, (box.h + 0.16) * z, 0.16 * z);
        ctx.stroke();
      }
      // The cell the hover card describes.
      if (s.hover) {
        const { block, r, c } = s.hover;
        cellPath(block, r, c, -0.04);
        ctx.fillStyle = `${COLORS.text}14`;
        ctx.fill();
        ctx.strokeStyle = COLORS.text;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    raf = requestAnimationFrame(draw);

    // Pointer: drag to pan, wheel or pinch to zoom, click a cell to inspect.
    const pointers = new Map();
    let dragged = false;
    function hit(x, y) {
      const w = toWorld(x, y);
      for (const block of props.current.track.blocks) {
        if (w.x < block.x || w.y < block.y || w.x > block.x + block.w || w.y > block.y + block.h) continue;
        const cell = cellAt(block, w.x - block.x, w.y - block.y);
        return cell ? { block, cell } : { block };
      }
      return null;
    }
    function takeOver() {
      if (s.cam) s.target = { ...s.cam };
      props.current.onUserMove?.();
    }
    function down(e) {
      pause();
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      dragged = false;
    }
    function move(e) {
      // No button held: hovering, even if a release was missed.
      if (!e.buttons) pointers.clear();
      const prev = pointers.get(e.pointerId);
      if (!prev) return hover(e);
      const next = { x: e.offsetX, y: e.offsetY };
      if (pointers.size === 2) {
        const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)[1];
        const before = Math.hypot(prev.x - other.x, prev.y - other.y);
        const after = Math.hypot(next.x - other.x, next.y - other.y);
        if (before > 0) zoomAt((next.x + other.x) / 2, (next.y + other.y) / 2, after / before);
      } else {
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
        if (dragged) {
          s.cam.x -= dx / s.cam.z;
          s.cam.y -= dy / s.cam.z;
          takeOver();
        }
      }
      pointers.set(e.pointerId, next);
    }
    function up(e) {
      pointers.delete(e.pointerId);
      if (!pointers.size) hover(e);
      if (!dragged && !pointers.size) {
        const h = hit(e.offsetX, e.offsetY);
        if (h?.cell) props.current.onCell?.(h.block.id, ...h.cell);
      }
    }
    function zoomAt(x, y, factor) {
      const before = toWorld(x, y);
      s.cam.z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM * 1.5, s.cam.z * factor));
      const after = toWorld(x, y);
      s.cam.x += before.x - after.x;
      s.cam.y += before.y - after.y;
      takeOver();
    }
    function wheel(e) {
      e.preventDefault();
      pause();
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX))
        zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
      else {
        s.cam.x += e.deltaX / s.cam.z;
        takeOver();
      }
    }
    // Hover: the card always describes the cell under the pointer now. The
    // pointer's last position is kept, and the cell is looked up again when
    // the camera moves or the frame changes under a still mouse.
    let seenCam = "";
    let seenScene = null;
    function setHoverTo(next) {
      if (sameHover(next, s.hover)) return;
      s.hover = next;
      showHover.current(next);
    }
    function clearHover() {
      s.pointer = null;
      setHoverTo(null);
    }
    function updateHover(scene, W, H) {
      const p = s.pointer;
      if (!p || p.paused) return;
      const cam = `${s.cam.x.toFixed(4)},${s.cam.y.toFixed(4)},${s.cam.z.toFixed(4)}`;
      if (p.dirty || cam !== seenCam || scene !== seenScene) {
        p.dirty = false;
        seenCam = cam;
        seenScene = scene;
        // A panel or overlay may now cover the canvas under a still pointer.
        const root = canvas.getRootNode();
        const top = root.elementFromPoint?.(p.cx, p.cy);
        if (top && top !== canvas) return setHoverTo(null);
        const h = hit(p.x, p.y);
        canvas.style.cursor = h?.cell ? "pointer" : "grab";
        setHoverTo(hoverable(h, scene));
      }
      if (s.hover) placeCard(tipRef.current, p.x, p.y, freeBox(W, H, props.current.insets));
    }
    function hover(e) {
      s.pointer = { x: e.offsetX, y: e.offsetY, cx: e.clientX, cy: e.clientY, dirty: true };
    }
    const leave = () => clearHover();
    const pause = () => {
      if (s.pointer) s.pointer.paused = true;
      setHoverTo(null);
    };
    const hidden = () => document.hidden && clearHover();
    window.addEventListener("blur", clearHover);
    document.addEventListener("visibilitychange", hidden);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
      window.removeEventListener("blur", clearHover);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);

  // Rebuilt blocks invalidate every cached bitmap.
  useEffect(() => {
    live.current.caches.clear();
  }, [track]);

  return (
    <div className="map">
      <canvas ref={canvasRef} className="map-canvas" aria-hidden="true" />
      <HoverCard hover={hover} cardRef={tipRef} />
    </div>
  );
}
