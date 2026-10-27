import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { cellAt, COLORS, paintBlock } from "./paint.js";
import { approach, ease } from "./camera.js";
import { cellsBox, focusOf, glideOf } from "./track.js";
import HoverCard, { freeBox, hoverable, placeCard, sameHover } from "./HoverCard.jsx";
import { createStage, SHADOW_CORE } from "./three/stage.js";
import { createColumns } from "./three/columns.js";
import { createFlows } from "./three/flows.js";
import { createLabels } from "./three/labels.js";
import { createGlow, weakGpu } from "./three/glow.js";

// The same blocks as the 2D map, as slabs on a stage. x is right, the map's
// y runs toward the viewer (+z); the camera looks down at an angle. Numeric
// cells stand as columns (height = |value|), text cells stay painted tiles.
const PITCH = THREE.MathUtils.degToRad(48);
const OVERVIEW_PITCH = THREE.MathUtils.degToRad(30);
const YAW = THREE.MathUtils.degToRad(-14);
// The overview turns the pipeline into a diagonal skyline.
const OVERVIEW_YAW = THREE.MathUtils.degToRad(-30);
const FOV = 40;
const TEX_PX = 56;
const PLATE_H = 0.22;
const LIFT = 0.5;
const DRIFT_YAW = THREE.MathUtils.degToRad(5);
const DRIFT_PITCH = THREE.MathUtils.degToRad(1.5);
const MAX_CALLOUTS = 3;

function texturePx(block, max) {
  return Math.max(16, Math.min(TEX_PX, Math.floor(max / Math.max(block.w, block.h))));
}

const cellCenter = (block, r, c) => [
  block.x + block.gx + block.offsets[c] + block.widths[c] / 2,
  block.y + block.gy + r * block.ch + block.ch / 2,
];

export default function Map3D({ track, scene, insets, follow, overviewing, onUserMove, onCell, onFail, reduced }) {
  const host = useRef(null);
  const tipRef = useRef(null);
  const [hover, setHover] = useState(null);
  const showHover = useRef(setHover);
  const props = useRef({});
  // The render loop reads the latest props from here.
  useLayoutEffect(() => {
    props.current = { track, scene, insets, follow, overviewing, onUserMove, onCell, reduced };
  });
  const api = useRef(null);

  // One renderer for the lifetime of the component (a theme change remounts it).
  useEffect(() => {
    const container = host.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      onFail?.();
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    const el = renderer.domElement;
    el.setAttribute("aria-hidden", "true");
    const maxTexture = Math.min(4096, renderer.capabilities.maxTextureSize);
    const anisotropy = renderer.capabilities.getMaxAnisotropy();

    const world = new THREE.Scene();
    const stage = createStage(renderer, world);
    const { tones } = stage;
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 800);
    const glow = createGlow(renderer, world, camera, {
      bloom: tones.dark && !props.current.reduced && !weakGpu(renderer),
    });
    const hdr = glow.bloom;
    const columns = createColumns({ env: stage.env, hdr });
    const flows = createFlows(world, { dark: tones.dark, hdr });
    const labels = createLabels(container);

    const controls = new OrbitControls(camera, el);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = THREE.MathUtils.degToRad(82);
    controls.minDistance = 4;
    controls.maxDistance = 400;
    controls.screenSpacePanning = false;
    let manual = false;
    controls.addEventListener("start", () => {
      manual = true;
      props.current.onUserMove?.();
    });

    const glowScale = () => (hdr ? 1.8 : 1);
    const sideTone = new THREE.Color(tones.side);
    const frameMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color(COLORS.active).multiplyScalar(glowScale()) });
    const activeFrame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.05, 1)), frameMaterial);
    activeFrame.visible = false;
    world.add(activeFrame);
    // Outline of the cell the hover card describes.
    const hoverMaterial = new THREE.LineBasicMaterial({ color: COLORS.text, transparent: true, opacity: 0.95 });
    const hoverFrame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), hoverMaterial);
    hoverFrame.visible = false;
    world.add(hoverFrame);

    const state = {
      track: null,
      plates: new Map(),
      links: new THREE.Group(),
      changedAt: performance.now(),
      activeFrom: null,
      activeTo: null,
      activeBlock: null,
      drawnActive: null,
      goal: null,
      lifts: new Map(),
    };
    world.add(state.links);

    function disposeGroup(group) {
      group.traverse((o) => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      group.clear();
    }
    function releasePlate(p) {
      world.remove(p.mesh, p.shadow);
      p.mesh.geometry.dispose();
      p.top.map.dispose();
      p.top.dispose();
      p.side.dispose();
      p.edge.geometry.dispose();
      p.edge.material.dispose();
      p.shadow.material.dispose();
      if (p.bars) {
        world.remove(p.bars);
        columns.release(p.bars);
      }
    }

    function build(track) {
      state.track = track;
      state.plates.forEach(releasePlate);
      state.plates.clear();
      disposeGroup(state.links);
      for (const block of track.blocks) {
        const canvas = document.createElement("canvas");
        const px = texturePx(block, maxTexture);
        canvas.width = Math.ceil(block.w * px);
        canvas.height = Math.ceil(block.h * px);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = anisotropy;
        const top = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
        const side = new THREE.MeshStandardMaterial({
          color: tones.side,
          roughness: 0.5,
          metalness: 0.05,
          envMap: stage.env,
          envMapIntensity: 0.35,
          transparent: true,
        });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(block.w, PLATE_H, block.h), [side, side, top, side, side, side]);
        mesh.position.set(block.x + block.w / 2, PLATE_H / 2, block.y + block.h / 2);
        mesh.userData.block = block;
        // The active step's slabs carry a lit accent edge.
        const hw = block.w / 2;
        const hh = block.h / 2;
        const y = PLATE_H / 2 + 0.004;
        const edge = new THREE.LineLoop(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(-hw, y, -hh),
            new THREE.Vector3(hw, y, -hh),
            new THREE.Vector3(hw, y, hh),
            new THREE.Vector3(-hw, y, hh),
          ]),
          new THREE.LineBasicMaterial({
            color: new THREE.Color(COLORS.accent).multiplyScalar(glowScale()),
            transparent: true,
            opacity: 0,
          }),
        );
        mesh.add(edge);
        world.add(mesh);
        const shadow = stage.shadow();
        shadow.position.x = mesh.position.x;
        shadow.position.z = mesh.position.z;
        world.add(shadow);
        const plate = { mesh, top, side, edge, shadow, canvas, px, key: null, lift: 0, dim: 1, fade: 1 };
        if (block.heat) {
          plate.bars = columns.make(block);
          world.add(plate.bars);
        }
        state.plates.set(block.id, plate);
      }
      // Arrows between blocks, drawn on the floor.
      for (const link of track.links) {
        const from = track.byId.get(link.from);
        const to = track.byId.get(link.to);
        const forward = to.x > from.x + from.w - 0.01;
        const y = 0.02;
        const a = forward
          ? new THREE.Vector3(from.x + from.w + 0.15, y, from.y + from.h / 2)
          : new THREE.Vector3(from.x + from.w / 2, y, from.y + from.h + 0.15);
        const b = forward
          ? new THREE.Vector3(to.x - 0.2, y, to.y + to.h / 2)
          : new THREE.Vector3(to.x + to.w / 2, y, to.y - 0.2);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const curve = forward
          ? new THREE.CubicBezierCurve3(a, new THREE.Vector3(mid.x, y, a.z), new THREE.Vector3(mid.x, y, b.z), b)
          : new THREE.CubicBezierCurve3(a, new THREE.Vector3(a.x, y, mid.z), new THREE.Vector3(b.x, y, mid.z), b);
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)),
          new THREE.LineBasicMaterial({ color: COLORS.link }),
        );
        line.userData.to = to.step;
        state.links.add(line);
      }
      labels.build(track);
    }

    // Plate top (y) for a block at this frame, once it has settled.
    const restingTop = (view) => PLATE_H + (view?.mode === "live" ? LIFT : 0);
    function cellTop(block, r, c, view) {
      const plate = state.plates.get(block.id);
      const h = plate?.bars ? columns.heightFor(plate.bars, r, c, view) : 0.02;
      const [x, z] = cellCenter(block, r, c);
      return new THREE.Vector3(x, restingTop(view) + h, z);
    }

    // Arcs from each cell read to the cells written, and the written value.
    function routeFlows(scene) {
      const written = scene.groups.find((g) => g.role === "active");
      if (!written) {
        flows.clear();
        labels.setCallouts([]);
        return;
      }
      const wView = scene.views.get(written.block.id);
      const tops = written.cells.map(([r, c]) => cellTop(written.block, r, c, wView));
      const end = tops.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / tops.length);
      end.y = Math.max(...tops.map((p) => p.y));
      const box = cellsBox(written.block, written.cells);
      const routes = [];
      for (const g of scene.groups) {
        if (g.role !== "source") continue;
        const view = scene.views.get(g.block.id);
        for (const [r, c] of g.cells) routes.push({ start: cellTop(g.block, r, c, view), end });
      }
      const floor = restingTop(wView) + 0.01;
      flows.set(routes, { point: new THREE.Vector3(box.x + box.w / 2, floor, box.y + box.h / 2), size: Math.max(box.w, box.h) });
      const shown =
        // Columns carry no text, so their value floats above them; a painted
        // tile already shows its own text, so only a lone one gets a callout.
        written.cells.length <= (written.block.heat ? MAX_CALLOUTS : 1)
          ? written.cells
              .map(([r, c], i) => {
                const cell = written.block.cell(r, c);
                const done = !wView?.done || wView.done(r, c);
                const text = cell && done ? String(cell.text ?? "") : "";
                return text ? { point: tops[i].clone().setY(tops[i].y + 0.1), text } : null;
              })
              .filter(Boolean)
          : [];
      labels.setCallouts(shown);
    }

    function goalFor() {
      const { scene, track, overviewing, insets } = props.current;
      const col = scene.column;
      if (!col) return null;
      const focus = focusOf(scene);
      const pitch = overviewing ? OVERVIEW_PITCH : PITCH;
      const yaw = overviewing ? OVERVIEW_YAW : YAW;
      const box = overviewing
        ? { x: track.bounds.x - 1, y: track.bounds.y - 2, w: track.bounds.w + 2, h: track.bounds.h + 3 }
        : (() => {
            const step = { x: col.box.x - 1, y: col.box.y - 2, w: col.box.w + 2, h: col.box.h + 3 };
            if (step.w * step.h <= 900 || !focus) return step;
            // Large steps: center on the cell being written, with its reads in view.
            const written = scene.groups.find((g) => g.role === "active" && g.block.step === scene.si);
            const anchor = written ? cellsBox(written.block, written.cells) : focus;
            const cx = anchor.x + anchor.w / 2;
            const cy = anchor.y + anchor.h / 2;
            const w = Math.min(28, Math.max(16, focus.w + 4));
            const h = Math.min(18, Math.max(10, focus.h + 4));
            return { x: cx - w / 2, y: cy - h / 2, w, h };
          })();
      // In perspective the near end of the skyline looms larger: aim a little past the middle.
      const target = new THREE.Vector3(box.x + box.w * (overviewing ? 0.56 : 0.5), 0.4, box.y + box.h / 2);
      const W = container.clientWidth || 1;
      const H = container.clientHeight || 1;
      const usable = Math.max(0.3, (W - insets.left - insets.right) / W);
      const usableH = Math.max(0.3, (H - insets.top - insets.bottom) / H);
      const vfov = THREE.MathUtils.degToRad(FOV);
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect * usable);
      // The box turned by `yaw`, then seen from `pitch` above the floor: depth
      // shrinks by sin(pitch); columns add their height times cos(pitch).
      const across = box.w * Math.cos(yaw) + box.h * Math.abs(Math.sin(yaw));
      const along = box.w * Math.abs(Math.sin(yaw)) + box.h * Math.cos(yaw);
      const depth = along * Math.sin(pitch) + 4 * Math.cos(pitch);
      const dist = Math.max(depth / 2 / Math.tan(vfov / 2) / usableH, across / 2 / Math.tan(hfov / 2), 6) * 1.05;
      // Shift the look point so the content centers in the area beside the panels.
      const shift = ((insets.left - insets.right) / W) * dist * Math.tan(hfov / 2) * 1.1;
      const lift = (((insets.bottom - insets.top) / H) * dist * Math.tan(vfov / 2)) / Math.sin(pitch);
      const look = target
        .clone()
        .add(new THREE.Vector3(-shift * Math.cos(yaw), 0, shift * Math.sin(yaw)))
        .add(new THREE.Vector3(Math.sin(yaw) * lift, 0, Math.cos(yaw) * lift));
      return { look, dist, pitch, yaw, box: col.box };
    }
    const offsetAt = (yaw, pitch, dist) =>
      new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist);
    function aimCamera(goal) {
      controls.maxDistance = Math.max(400, goal.dist * 1.6);
      camera.far = Math.max(800, goal.dist * 6);
      camera.updateProjectionMatrix();
    }

    api.current = {
      build(track) {
        if (track !== state.track) build(track);
      },
      update() {
        const { scene, follow } = props.current;
        if (follow) manual = false;
        state.goal = goalFor();
        if (state.goal) aimCamera(state.goal);
        const active = glideOf(scene);
        state.activeFrom = state.drawnActive ?? active;
        state.activeTo = active;
        state.activeBlock = scene.groups.find((g) => g.role === "active")?.block ?? null;
        state.changedAt = performance.now();
        routeFlows(scene);
      },
    };
    build(props.current.track);

    function resize() {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      glow.setSize(w, h);
      labels.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      state.goal = goalFor();
      if (state.goal) aimCamera(state.goal);
    }
    resize();
    api.current.update();
    if (state.goal) {
      controls.target.copy(state.goal.look);
      camera.position.copy(state.goal.look).add(offsetAt(state.goal.yaw, state.goal.pitch, state.goal.dist));
    }
    const observer = new ResizeObserver(resize);
    observer.observe(container);


    let raf = 0;
    let last = performance.now();
    let lost = false;
    const tmpPos = new THREE.Vector3();
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (lost || document.hidden) {
        last = now;
        return;
      }
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      glow.watch(dt);
      const { scene, track, reduced } = props.current;
      // Repaint textures whose state changed; lift the step in play, settle the
      // past lower and dimmer, ghost the future.
      for (const block of track.blocks) {
        const plate = state.plates.get(block.id);
        if (!plate) continue;
        const view = scene.views.get(block.id) ?? { mode: "done", key: "done" };
        if (plate.key !== view.key) {
          const ctx = plate.canvas.getContext("2d");
          ctx.clearRect(0, 0, plate.canvas.width, plate.canvas.height);
          paintBlock(ctx, block, { ...view, bars: !!plate.bars }, plate.px);
          plate.top.map.needsUpdate = true;
          plate.key = view.key;
        }
        const live = view.mode === "live";
        const ghost = view.mode === "ghost";
        const k = (v, t, s = 0.5) => (reduced ? t : approach(v, t, dt, s));
        plate.lift = k(plate.lift, live ? LIFT : 0);
        plate.dim = k(plate.dim, live || ghost ? 1 : tones.dark ? 0.7 : 0.9, 0.4);
        plate.fade = k(plate.fade, ghost ? 0.38 : 1, 0.4);
        plate.mesh.position.y = PLATE_H / 2 + plate.lift;
        plate.top.color.setScalar(plate.dim);
        plate.top.opacity = plate.fade;
        plate.side.color.copy(sideTone).multiplyScalar(plate.dim);
        plate.side.opacity = plate.fade;
        // A see-through plate that writes depth hides whatever sorts after it,
        // and the sort order flips as the camera drifts: flicker.
        const solid = plate.fade > 0.99;
        if (plate.top.depthWrite !== solid) plate.top.depthWrite = plate.side.depthWrite = solid;
        plate.edge.material.opacity = k(plate.edge.material.opacity, live ? 0.9 : 0, 0.3);
        plate.edge.visible = plate.edge.material.opacity > 0.01;
        // The shadow spreads and softens as the slab rises.
        const spread = 1 + plate.lift * 0.35;
        plate.shadow.scale.set((block.w / SHADOW_CORE) * spread, 1, (block.h / SHADOW_CORE) * spread);
        plate.shadow.material.opacity = tones.shadowOpacity * plate.fade * (1 - plate.lift * 0.6);
        state.lifts.set(block.id, PLATE_H + plate.lift);
        if (plate.bars) {
          plate.bars.material.color.setScalar(plate.dim);
          if (plate.bars.userData.key !== view.key) columns.aim(plate.bars, view);
          columns.grow(plate.bars, PLATE_H + plate.lift, dt, reduced);
        }
      }
      state.links.children.forEach((line) =>
        line.material.color.set(line.userData.to === scene.si ? COLORS.accent : COLORS.link),
      );
      // The amber frame glides from the last result to this one.
      if (state.activeTo) {
        const k = reduced ? 1 : ease(Math.min(1, (now - state.changedAt) / 380));
        const a = state.activeFrom ?? state.activeTo;
        const b = state.activeTo;
        const box = {
          x: a.x + (b.x - a.x) * k,
          y: a.y + (b.y - a.y) * k,
          w: a.w + (b.w - a.w) * k,
          h: a.h + (b.h - a.h) * k,
        };
        state.drawnActive = box;
        activeFrame.visible = true;
        activeFrame.scale.set(box.w + 0.12, 1, box.h + 0.12);
        const top = state.lifts.get(state.activeBlock?.id) ?? PLATE_H;
        activeFrame.position.set(box.x + box.w / 2, top + 0.03, box.y + box.h / 2);
      } else activeFrame.visible = false;
      flows.tick(now, reduced);
      stage.tick(state.goal?.box ?? props.current.track.bounds, dt, reduced);

      if (state.goal && !manual) {
        // A gentle drift once the frame has been still for a few seconds.
        const idle = reduced ? 0 : Math.min(1, Math.max(0, (now - state.changedAt) / 1000 - 3) / 3);
        const t = now / 1000;
        const yaw = state.goal.yaw + idle * DRIFT_YAW * Math.sin(t * 0.21);
        const pitch = state.goal.pitch + idle * DRIFT_PITCH * Math.sin(t * 0.13);
        tmpPos.copy(state.goal.look).add(offsetAt(yaw, pitch, state.goal.dist));
        const settle = reduced ? 0.001 : 1;
        camera.position.set(
          approach(camera.position.x, tmpPos.x, dt, settle),
          approach(camera.position.y, tmpPos.y, dt, settle),
          approach(camera.position.z, tmpPos.z, dt, settle),
        );
        controls.target.set(
          approach(controls.target.x, state.goal.look.x, dt, settle),
          approach(controls.target.y, state.goal.look.y, dt, settle),
          approach(controls.target.z, state.goal.look.z, dt, settle),
        );
      }
      controls.update();
      const distance = camera.position.distanceTo(controls.target);
      stage.fogFor(distance);
      // A near plane that follows the distance keeps depth precise far away.
      const near = Math.max(0.1, distance * 0.02);
      if (Math.abs(camera.near - near) > near * 0.05) {
        camera.near = near;
        camera.updateProjectionMatrix();
      }
      updateHover(scene);
      glow.render();
      labels.update(scene, camera, state.lifts);
      labels.render(camera);
    }
    raf = requestAnimationFrame(frame);

    // Hover and click map back to a cell: columns by instance, tiles through
    // the plate's texture coordinates.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt = null;
    function pick(clientX, clientY) {
      const rect = el.getBoundingClientRect();
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const plates = [...state.plates.values()];
      const bars = plates.map((p) => p.bars).filter((b) => b && !b.material.transparent);
      const barHit = raycaster.intersectObjects(bars, false)[0];
      const hit = raycaster.intersectObjects(plates.map((p) => p.mesh), false).find((h) => h.face?.materialIndex === 2);
      if (barHit && (!hit || barHit.distance <= hit.distance)) {
        const block = barHit.object.userData.block;
        const i = barHit.instanceId;
        return { block, cell: [Math.floor(i / block.cols), i % block.cols] };
      }
      if (!hit) return null;
      const block = hit.object.userData.block;
      const cell = cellAt(block, hit.uv.x * block.w, (1 - hit.uv.y) * block.h);
      return cell ? { block, cell } : null;
    }
    // Hover: the card always describes the cell under the pointer now. The
    // last pointer position is kept and picked again whenever the camera
    // moves (playback, damping, drift) or the frame changes under it.
    let hovered = null;
    let hotBars = null;
    let pointerAt = null;
    let seenView = "";
    let seenScene = null;
    function setHoverTo(next) {
      if (sameHover(next, hovered)) return;
      hovered = next;
      const bars = next ? state.plates.get(next.block.id)?.bars : null;
      if (hotBars && hotBars !== bars) columns.setHot(hotBars, -1);
      if (bars) columns.setHot(bars, next.r * next.block.cols + next.c);
      hotBars = bars ?? null;
      showHover.current(next);
    }
    function clearHover() {
      pointerAt = null;
      setHoverTo(null);
    }
    function updateHover(scene) {
      const p = pointerAt;
      if (!p || p.paused) {
        hoverFrame.visible = false;
        return;
      }
      const t = controls.target;
      const view = [camera.position.x, camera.position.y, camera.position.z, t.x, t.y, t.z].map((v) => v.toFixed(3)).join();
      if (p.dirty || view !== seenView || scene !== seenScene) {
        p.dirty = false;
        seenView = view;
        seenScene = scene;
        const top = el.getRootNode().elementFromPoint?.(p.cx, p.cy);
        if (top && top !== el) setHoverTo(null);
        else {
          const h = pick(p.cx, p.cy);
          el.style.cursor = h ? "pointer" : "grab";
          setHoverTo(hoverable(h, scene));
        }
      }
      hoverFrame.visible = !!hovered;
      if (!hovered) return;
      const { block, r, c } = hovered;
      const plate = state.plates.get(block.id);
      const top = state.lifts.get(block.id) ?? PLATE_H;
      const w = block.widths[c];
      const [x, z] = cellCenter(block, r, c);
      const bar = plate?.bars ? columns.shown(plate.bars, r * block.cols + c) : 0;
      const h = Math.max(0.04, bar);
      hoverFrame.scale.set(w * (bar ? 0.8 : 0.96), h, block.ch * (bar ? 0.8 : 0.96));
      hoverFrame.position.set(x, top + h / 2 + 0.005, z);
      const rect = el.getBoundingClientRect();
      placeCard(tipRef.current, p.cx - rect.left, p.cy - rect.top, freeBox(rect.width, rect.height, props.current.insets));
    }
    function move(e) {
      // While a button is held the camera is being dragged: no card.
      pointerAt = { cx: e.clientX, cy: e.clientY, dirty: true, paused: e.buttons !== 0 };
      if (e.buttons) setHoverTo(null);
    }
    const pause = () => {
      if (pointerAt) pointerAt.paused = true;
      setHoverTo(null);
    };
    const down = (e) => {
      downAt = { x: e.clientX, y: e.clientY };
      pause();
    };
    function up(e) {
      pointerAt = { cx: e.clientX, cy: e.clientY, dirty: true };
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
      const h = pick(e.clientX, e.clientY);
      if (h) props.current.onCell?.(h.block.id, ...h.cell);
    }
    const leave = () => clearHover();
    const hidden = () => document.hidden && clearHover();
    function contextLost(e) {
      e.preventDefault();
      lost = true;
      onFail?.();
    }
    el.addEventListener("pointermove", move);
    el.addEventListener("wheel", pause, { passive: true });
    window.addEventListener("blur", clearHover);
    document.addEventListener("visibilitychange", hidden);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("webglcontextlost", contextLost);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("wheel", pause);
      window.removeEventListener("blur", clearHover);
      document.removeEventListener("visibilitychange", hidden);
      el.removeEventListener("webglcontextlost", contextLost);
      controls.dispose();
      state.plates.forEach(releasePlate);
      disposeGroup(state.links);
      columns.dispose();
      flows.dispose();
      labels.dispose();
      stage.dispose();
      glow.dispose();
      hoverFrame.geometry.dispose();
      hoverMaterial.dispose();
      activeFrame.geometry.dispose();
      frameMaterial.dispose();
      renderer.dispose();
      el.remove();
      api.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.current?.build(track);
  }, [track]);
  useEffect(() => {
    api.current?.update();
  }, [scene, follow, overviewing, insets, track]);

  return (
    <div className="map" ref={host}>
      <HoverCard hover={hover} cardRef={tipRef} />
    </div>
  );
}
