// Numeric blocks as columns: one rounded bar per cell in an InstancedMesh.
// Height is |value| over the block's scale (its largest magnitude unless the
// block sets one); colour is the value's sign and strength, or the frame's
// role for the cell (read = blue, written = amber). Future steps show their
// real heights as faint ghosts; unwritten cells have no column.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { COLORS } from "../paint.js";
import { approach } from "../camera.js";

export const BAR_MIN = 0.05;
export const BAR_MAX = 1.6;
const ZERO_H = 0.015;
const FOOT = 0.72;
const HOT_LIFT = 0.12;
const rgb = ([r, g, b]) => new THREE.Color(`rgb(${r}, ${g}, ${b})`);

export function createColumns({ env, hdr }) {
  const geometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.08);
  geometry.translate(0, 0.5, 0);
  const neutral = new THREE.Color(COLORS.plate).lerp(new THREE.Color(COLORS.faint), 0.5);
  const tone = {
    pos: rgb(COLORS.pos),
    neg: rgb(COLORS.neg),
    seq: rgb(COLORS.seq),
    active: new THREE.Color(COLORS.active).multiplyScalar(hdr ? 1.12 : 1),
    source: new THREE.Color(COLORS.source),
    masked: new THREE.Color(COLORS.edgeGhost),
    ghost: new THREE.Color(COLORS.faint),
  };
  const tmp = new THREE.Object3D();
  const tint = new THREE.Color();
  const white = new THREE.Color("#ffffff");

  function make(block) {
    const count = block.rows * block.cols;
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.42,
      metalness: 0.08,
      envMap: env,
      envMapIntensity: 0.4,
    });
    const bars = new THREE.InstancedMesh(geometry, material, count);
    // Drawn after the plates, so faded plates never hide or re-sort over them.
    bars.renderOrder = 1;
    const values = [];
    for (let r = 0; r < block.rows; r++)
      for (let c = 0; c < block.cols; c++) values.push(block.cell(r, c)?.value);
    const finite = values.filter(Number.isFinite).map(Math.abs);
    const scale = block.scale ?? Math.max(1e-9, ...finite);
    bars.userData = {
      block,
      values,
      scale,
      height: new Float32Array(count),
      goal: new Float32Array(count),
      colors: new Float32Array(count * 3),
      hot: -1,
      key: null,
    };
    bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < count; i++) bars.setColorAt(i, neutral);
    return bars;
  }

  // The full height a cell's column reaches once written.
  function full(bars, i) {
    const { values, scale } = bars.userData;
    const v = values[i];
    if (v === 0) return ZERO_H;
    return BAR_MIN + (Number.isFinite(v) ? Math.min(1, Math.abs(v) / scale) : 0) * BAR_MAX;
  }

  function valueTone(block, v, scale, out) {
    if (v === 0) return out.copy(neutral);
    const t = Number.isFinite(v) ? Math.min(1, Math.abs(v) / scale) : 0;
    const hue = block.heat === "sequential" ? tone.seq : v < 0 ? tone.neg : tone.pos;
    return out.copy(neutral).lerp(hue, 0.35 + 0.65 * Math.sqrt(t));
  }

  function aim(bars, view) {
    const { block, values, scale, goal, colors } = bars.userData;
    const ghost = view.mode === "ghost";
    for (let r = 0; r < block.rows; r++)
      for (let c = 0; c < block.cols; c++) {
        const i = r * block.cols + c;
        const key = `${r},${c}`;
        const done = !ghost && (view.done ? view.done(r, c) : true);
        const masked = block.masked?.(r, c);
        if (ghost) {
          goal[i] = masked ? BAR_MIN : full(bars, i);
          tint.copy(tone.ghost);
        } else if (!done) {
          goal[i] = 0;
          tint.copy(neutral);
        } else if (masked) {
          goal[i] = BAR_MIN;
          tint.copy(tone.masked);
        } else {
          goal[i] = full(bars, i);
          if (view.active?.has(key)) tint.copy(tone.active);
          else if (view.source?.has(key)) tint.copy(tone.source);
          else valueTone(block, values[i], scale, tint);
        }
        tint.toArray(colors, i * 3);
        bars.setColorAt(i, tint);
      }
    if (bars.userData.hot >= 0) lighten(bars, bars.userData.hot);
    bars.instanceColor.needsUpdate = true;
    const material = bars.material;
    if (material.transparent !== ghost) {
      material.transparent = ghost;
      material.depthWrite = !ghost;
      material.needsUpdate = true;
    }
    material.opacity = ghost ? 0.16 : 1;
    bars.userData.key = view.key;
  }

  function lighten(bars, i) {
    tint.fromArray(bars.userData.colors, i * 3).lerp(white, 0.35);
    bars.setColorAt(i, tint);
  }

  // The hovered column rises a little and lightens.
  function setHot(bars, i) {
    const d = bars.userData;
    if (d.hot === i) return;
    if (d.hot >= 0) bars.setColorAt(d.hot, tint.fromArray(d.colors, d.hot * 3));
    if (i >= 0) lighten(bars, i);
    d.hot = i;
    d.placed = false;
    bars.instanceColor.needsUpdate = true;
  }

  function grow(bars, top, dt, reduced) {
    const d = bars.userData;
    const { block, height, goal } = d;
    let moving = d.top !== top || !d.placed;
    for (let i = 0; i < height.length; i++) {
      const next = reduced ? goal[i] : approach(height[i], goal[i], dt, 0.5);
      if (Math.abs(next - height[i]) > 1e-4) moving = true;
      height[i] = Math.abs(next - goal[i]) < 1e-4 ? goal[i] : next;
    }
    if (!moving) return;
    d.top = top;
    d.placed = true;
    for (let r = 0; r < block.rows; r++)
      for (let c = 0; c < block.cols; c++) {
        const i = r * block.cols + c;
        const h = height[i] + (i === d.hot ? HOT_LIFT : 0);
        const foot = h < 0.004 ? 0 : FOOT;
        tmp.position.set(
          block.x + block.gx + block.offsets[c] + block.widths[c] / 2,
          top,
          block.y + block.gy + r * block.ch + block.ch / 2,
        );
        tmp.scale.set(block.widths[c] * foot, Math.max(h, 0.0001), block.ch * foot);
        tmp.updateMatrix();
        bars.setMatrixAt(i, tmp.matrix);
      }
    bars.instanceMatrix.needsUpdate = true;
    bars.boundingSphere = null;
    bars.boundingBox = null;
  }

  // Height the column will have at this view (for flow endpoints).
  function heightFor(bars, r, c, view) {
    const i = r * bars.userData.block.cols + c;
    if (view.mode === "ghost") return 0;
    if (view.done && !view.done(r, c)) return 0;
    if (bars.userData.block.masked?.(r, c)) return BAR_MIN;
    return full(bars, i);
  }

  function release(bars) {
    bars.material.dispose();
    bars.dispose();
  }

  return {
    make,
    aim,
    grow,
    setHot,
    heightFor,
    shown: (bars, i) => bars.userData.height[i] + (i === bars.userData.hot ? HOT_LIFT : 0),
    release,
    dispose: () => geometry.dispose(),
  };
}
