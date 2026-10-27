// Crisp HTML labels over the 3D map: a title per step, block titles for the
// step in play when the plate's own painted title is too small to read, and
// the value being written above its cell. Text only; pointer events pass
// through to the canvas.
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { COLORS } from "../paint.js";

const SANS = "Manrope, system-ui, sans-serif";
const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace';
// Below this many pixels, the plate's painted block title is unreadable.
const PAINTED_TITLE_PX = 11;
const TITLE_FONT = 0.36;

const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${a})`;
function hexRgb(hex) {
  const c = new THREE.Color(hex);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

// Writes a style only when it changes (this runs every frame).
function style(el, key, value) {
  if (el.style[key] !== value) el.style[key] = value;
}

function tag(styles, text) {
  const el = document.createElement("div");
  Object.assign(el.style, { pointerEvents: "none", whiteSpace: "nowrap", userSelect: "none" }, styles);
  if (text !== undefined) el.textContent = text;
  return el;
}

export function createLabels(container) {
  const renderer = new CSS2DRenderer();
  Object.assign(renderer.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
  renderer.domElement.setAttribute("aria-hidden", "true");
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const plate = COLORS.plateRgb;
  const activeRgb = COLORS.activeRgb;
  const accentRgb = hexRgb(COLORS.accent);
  let steps = [];
  let blocks = [];
  let callouts = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  let width = 1;
  let height = 1;

  function clear(list) {
    list.forEach((o) => scene.remove(o.object));
    return [];
  }

  function build(track) {
    steps = clear(steps);
    blocks = clear(blocks);
    callouts = clear(callouts);
    track.columns.forEach((col, i) => {
      const el = tag({
        display: "flex",
        alignItems: "baseline",
        gap: "8px",
        overflow: "hidden",
        padding: "4px 10px 4px 8px",
        borderRadius: "8px",
        font: `600 15px/1.2 ${SANS}`,
        letterSpacing: "-0.01em",
        transition: "opacity 240ms ease, color 240ms ease, background-color 240ms ease",
      });
      const num = tag({ font: `600 11px/1 ${MONO}`, opacity: "0.8", flex: "none" }, String(i + 1).padStart(2, "0"));
      const name = tag({ overflow: "hidden", textOverflow: "ellipsis", minWidth: "0" }, col.step.name);
      el.append(num, name);
      const object = new CSS2DObject(el);
      object.center.set(0, 1);
      object.position.set(col.box.x, 0.8, col.box.y - 1.7);
      scene.add(object);
      steps.push({ object, el, name, col, i, state: "" });
    });
    for (const block of track.blocks) {
      if (!block.title) continue;
      const el = tag({
        font: `600 12.5px/1.2 ${SANS}`,
        padding: "2px 7px",
        borderRadius: "6px",
        color: COLORS.title,
        background: rgba(plate, 0.82),
        border: `1px solid ${COLORS.edge}`,
        maxWidth: "260px",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }, block.title);
      const object = new CSS2DObject(el);
      object.center.set(0, 1);
      object.visible = false;
      scene.add(object);
      blocks.push({ object, el, block });
    }
  }

  // Pixels per world unit at a point, for the current camera.
  function ppu(camera, x, y, z) {
    a.set(x, y, z).project(camera);
    b.set(x + 1, y, z).project(camera);
    if (a.z > 1 || b.z > 1) return 0;
    return (Math.abs(b.x - a.x) * width) / 2;
  }

  // lifts: Map(block id → plate top y); written: [{ point, text }].
  function update(scene3, camera, lifts) {
    for (const s of steps) {
      const { i } = s;
      const state = i === scene3.si ? "now" : i < scene3.si ? "past" : "next";
      if (state !== s.state) {
        s.state = state;
        Object.assign(s.el.style, {
          color: state === "now" ? COLORS.accent : state === "past" ? COLORS.title : COLORS.label,
          background: state === "now" ? rgba(accentRgb, 0.12) : "transparent",
          opacity: state === "next" ? "0.55" : state === "past" ? "0.8" : "1",
          fontSize: state === "now" ? "16px" : "14px",
        });
      }
      // Fit the title to the step's on-screen width so neighbours never overlap.
      const px = ppu(camera, s.col.box.x, 0, s.col.box.y) * s.col.box.w;
      s.object.visible = px > 22 || state === "now";
      style(s.name, "display", px > 70 || state === "now" ? "" : "none");
      style(s.el, "maxWidth", `${Math.max(40, Math.round(px / 8) * 8)}px`);
    }
    for (const l of blocks) {
      const top = lifts.get(l.block.id);
      const live = scene3.views.get(l.block.id)?.mode === "live";
      if (!live || top === undefined) {
        l.object.visible = false;
        continue;
      }
      l.object.position.set(l.block.x, top + 0.05, l.block.y - 0.08);
      const px = ppu(camera, l.block.x, top, l.block.y);
      l.object.visible = px * TITLE_FONT < PAINTED_TITLE_PX && px * l.block.w > 60;
      if (l.object.visible) style(l.el, "maxWidth", `${Math.max(60, Math.round((px * l.block.w) / 8) * 8)}px`);
    }
  }

  function setCallouts(list) {
    callouts = clear(callouts);
    for (const { point, text } of list) {
      const el = tag({
        font: `600 13px/1.2 ${MONO}`,
        padding: "3px 8px",
        borderRadius: "999px",
        color: COLORS.text,
        background: rgba(plate, 0.9),
        border: `1.5px solid ${rgba(activeRgb, 0.95)}`,
        boxShadow: `0 4px 14px ${rgba(activeRgb, 0.25)}`,
        maxWidth: "200px",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }, text);
      const object = new CSS2DObject(el);
      object.center.set(0.5, 1.25);
      object.position.copy(point);
      scene.add(object);
      callouts.push({ object, el });
    }
  }

  return {
    build,
    update,
    setCallouts,
    setSize(w, h) {
      width = w;
      height = h;
      renderer.setSize(w, h);
    },
    render: (camera) => renderer.render(scene, camera),
    get size() {
      return { width, height };
    },
    dispose() {
      clear(steps);
      clear(blocks);
      clear(callouts);
      renderer.domElement.remove();
    },
  };
}
