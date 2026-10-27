import { useEffect, useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { cellAt, COLORS, paintBlock } from "./paint.js";
import { approach, ease } from "./camera.js";
import { cellsBox, focusOf, glideOf } from "./track.js";

// The same blocks as the 2D map, as plates on a floor. x is right, the map's
// y runs toward the viewer (+z); the camera looks down at an angle.
const PITCH = THREE.MathUtils.degToRad(46);
const YAW = THREE.MathUtils.degToRad(-14);
const FOV = 40;
// Bars: numeric cells rise by |value|; the block's largest value reaches BAR_MAX.
const BAR_MAX = 1.5;
const BAR_MIN = 0.06;
const TEX_PX = 56;
const LIFT = 0.18;

function texturePx(block, max) {
  return Math.max(16, Math.min(TEX_PX, Math.floor(max / Math.max(block.w, block.h))));
}

function labelTexture(text, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.font = "600 64px Manrope, system-ui, sans-serif";
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 8, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, width: Math.min(1024, ctx.measureText(text).width + 16) / 1024 };
}

export default function Map3D({ track, scene, insets, follow, overviewing, onUserMove, onCell, onFail, reduced }) {
  const host = useRef(null);
  const tipRef = useRef(null);
  const props = useRef({});
  // The render loop reads the latest props from here.
  useLayoutEffect(() => {
    props.current = { track, scene, insets, follow, overviewing, onUserMove, onCell, reduced };
  });
  const api = useRef(null);

  // One renderer for the lifetime of the component.
  useEffect(() => {
    const container = host.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      onFail?.();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(COLORS.bg);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute("aria-hidden", "true");
    const maxTexture = Math.min(4096, renderer.capabilities.maxTextureSize);
    const anisotropy = renderer.capabilities.getMaxAnisotropy();

    const world = new THREE.Scene();
    world.fog = new THREE.Fog(COLORS.bg, 60, 160);
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 600);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = THREE.MathUtils.degToRad(80);
    controls.minDistance = 4;
    controls.maxDistance = 260;
    controls.screenSpacePanning = false;
    let manual = false;
    controls.addEventListener("start", () => {
      manual = true;
      props.current.onUserMove?.();
    });

    const grid = new THREE.GridHelper(600, 120, COLORS.grid[0], COLORS.grid[1]);
    grid.position.y = -0.02;
    world.add(grid);
    world.add(new THREE.HemisphereLight("#ffffff", COLORS.bg, 1.4));
    const sun = new THREE.DirectionalLight("#ffffff", 1.6);
    sun.position.set(-20, 40, 30);
    world.add(sun);
    const barGeometry = new THREE.BoxGeometry(1, 1, 1);
    barGeometry.translate(0, 0.5, 0);
    const COLOR = {
      pos: new THREE.Color("rgb(98, 214, 190)"),
      neg: new THREE.Color("rgb(240, 152, 120)"),
      seq: new THREE.Color("rgb(166, 146, 255)"),
      active: new THREE.Color(COLORS.active),
      source: new THREE.Color(COLORS.source),
      pending: new THREE.Color(COLORS.faint),
      masked: new THREE.Color(COLORS.edgeGhost),
    };
    const tmp = new THREE.Object3D();
    const tint = new THREE.Color();

    const state = {
      plates: new Map(),
      links: new THREE.Group(),
      labels: new THREE.Group(),
      overlay: new THREE.Group(),
      particles: [],
      changedAt: 0,
      activeFrom: null,
      activeTo: null,
      goal: null,
    };
    world.add(state.links, state.labels, state.overlay);
    const sideMaterial = new THREE.MeshBasicMaterial({ color: COLORS.side });
    const frameMaterial = new THREE.LineBasicMaterial({ color: COLORS.active });
    const activeFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.05, 1)),
      frameMaterial,
    );
    world.add(activeFrame);
    activeFrame.visible = false;

    function disposeGroup(group) {
      group.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) {
          o.material.map?.dispose();
          o.material.dispose();
        }
      });
      group.clear();
    }

    function build(track) {
      state.plates.forEach((p) => {
        p.mesh.geometry.dispose();
        p.top.map.dispose();
        p.top.dispose();
        world.remove(p.mesh);
        if (p.bars) {
          p.bars.material.dispose();
          p.bars.dispose();
          world.remove(p.bars);
        }
      });
      state.plates.clear();
      disposeGroup(state.links);
      disposeGroup(state.labels);
      for (const block of track.blocks) {
        const canvas = document.createElement("canvas");
        const px = texturePx(block, maxTexture);
        canvas.width = Math.ceil(block.w * px);
        canvas.height = Math.ceil(block.h * px);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = anisotropy;
        const top = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(block.w, 0.16, block.h), [
          sideMaterial,
          sideMaterial,
          top,
          sideMaterial,
          sideMaterial,
          sideMaterial,
        ]);
        mesh.position.set(block.x + block.w / 2, 0.08, block.y + block.h / 2);
        mesh.userData.block = block;
        world.add(mesh);
        const plate = { mesh, top, canvas, px, key: null, lift: 0 };
        if (block.heat) plate.bars = makeBars(block);
        state.plates.set(block.id, plate);
      }
      // Arrows between blocks, drawn on the floor.
      for (const link of track.links) {
        const from = track.byId.get(link.from);
        const to = track.byId.get(link.to);
        const forward = to.x > from.x + from.w - 0.01;
        const a = forward
          ? new THREE.Vector3(from.x + from.w + 0.15, 0.03, from.y + from.h / 2)
          : new THREE.Vector3(from.x + from.w / 2, 0.03, from.y + from.h + 0.15);
        const b = forward
          ? new THREE.Vector3(to.x - 0.2, 0.03, to.y + to.h / 2)
          : new THREE.Vector3(to.x + to.w / 2, 0.03, to.y - 0.2);
        const mid = a.clone().add(b).multiplyScalar(0.5);
        const curve = forward
          ? new THREE.CubicBezierCurve3(a, new THREE.Vector3(mid.x, 0.03, a.z), new THREE.Vector3(mid.x, 0.03, b.z), b)
          : new THREE.CubicBezierCurve3(a, new THREE.Vector3(a.x, 0.03, mid.z), new THREE.Vector3(b.x, 0.03, mid.z), b);
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)),
          new THREE.LineBasicMaterial({ color: COLORS.link }),
        );
        line.userData.to = to.step;
        state.links.add(line);
      }
      track.columns.forEach((col, i) => {
        const { texture, width } = labelTexture(`${String(i + 1).padStart(2, "0")}  ${col.step.name}`, "#ffffff");
        const height = 1.1;
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(height * 8 * width, height),
          new THREE.MeshBasicMaterial({ map: texture, transparent: true, color: COLORS.faint }),
        );
        plane.geometry.translate((height * 8 * width) / 2, 0, 0);
        plane.rotation.x = -Math.PI / 2;
        plane.position.set(col.box.x, 0.02, col.box.y - 1.1);
        plane.userData.step = i;
        state.labels.add(plane);
      });
    }

    // Numeric blocks get one bar per cell: an InstancedMesh whose heights and
    // colors follow the frame (pending, read, written, done).
    function makeBars(block) {
      const count = block.rows * block.cols;
      const bars = new THREE.InstancedMesh(
        barGeometry,
        new THREE.MeshLambertMaterial({ transparent: true }),
        count,
      );
      bars.userData.block = block;
      const values = [];
      for (let r = 0; r < block.rows; r++)
        for (let c = 0; c < block.cols; c++) values.push(block.cell(r, c)?.value);
      const finite = values.filter(Number.isFinite).map(Math.abs);
      const scale = block.scale ?? Math.max(1e-9, ...finite);
      bars.userData.values = values;
      bars.userData.scale = scale;
      bars.userData.height = new Float32Array(count).fill(BAR_MIN);
      bars.userData.goal = new Float32Array(count).fill(BAR_MIN);
      bars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < count; i++) bars.setColorAt(i, COLOR.pending);
      world.add(bars);
      return bars;
    }
    function aimBars(bars, view) {
      const block = bars.userData.block;
      const { values, scale, goal } = bars.userData;
      for (let r = 0; r < block.rows; r++)
        for (let c = 0; c < block.cols; c++) {
          const i = r * block.cols + c;
          const key = `${r},${c}`;
          const v = values[i];
          const done = view.mode !== "ghost" && (view.done ? view.done(r, c) : true);
          const masked = block.masked?.(r, c);
          const size = Number.isFinite(v) ? Math.abs(v) / scale : 0;
          goal[i] = !done || masked ? BAR_MIN : BAR_MIN + size * BAR_MAX;
          tint.copy(
            view.active?.has(key)
              ? COLOR.active
              : view.source?.has(key)
                ? COLOR.source
                : !done
                  ? COLOR.pending
                  : masked
                    ? COLOR.masked
                    : block.heat === "sequential"
                      ? COLOR.seq
                      : v < 0
                        ? COLOR.neg
                        : COLOR.pos,
          );
          bars.setColorAt(i, tint);
        }
      bars.instanceColor.needsUpdate = true;
      bars.material.opacity = view.mode === "ghost" ? 0.25 : 1;
      bars.userData.key = view.key;
    }
    function growBars(bars, lift, dt, reduced) {
      const block = bars.userData.block;
      const { height, goal } = bars.userData;
      let moving = bars.userData.lift !== lift;
      for (let i = 0; i < height.length; i++) {
        const next = reduced ? goal[i] : approach(height[i], goal[i], dt, 0.45);
        if (Math.abs(next - height[i]) > 1e-4) moving = true;
        height[i] = next;
      }
      if (!moving && bars.userData.placed) return;
      bars.userData.lift = lift;
      bars.userData.placed = true;
      for (let r = 0; r < block.rows; r++)
        for (let c = 0; c < block.cols; c++) {
          const i = r * block.cols + c;
          tmp.position.set(
            block.x + block.gx + block.offsets[c] + block.widths[c] / 2,
            0.16 + lift,
            block.y + block.gy + r * block.ch + block.ch / 2,
          );
          tmp.scale.set(block.widths[c] * 0.72, height[i], block.ch * 0.72);
          tmp.updateMatrix();
          bars.setMatrixAt(i, tmp.matrix);
        }
      bars.instanceMatrix.needsUpdate = true;
    }

    function paint(view, plate, block) {
      const ctx = plate.canvas.getContext("2d");
      ctx.clearRect(0, 0, plate.canvas.width, plate.canvas.height);
      paintBlock(ctx, block, { ...view, bars: !!plate.bars }, plate.px);
      plate.top.map.needsUpdate = true;
      plate.key = view.key;
    }

    function goalFor() {
      const { scene, track, overviewing } = props.current;
      const col = scene.column;
      if (!col) return null;
      const focus = focusOf(scene);
      const box = overviewing
        ? track.bounds
        : (() => {
            const step = { x: col.box.x - 1, y: col.box.y - 2, w: col.box.w + 2, h: col.box.h + 3 };
            // Large steps: frame the cells in play rather than the whole step.
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
      const target = new THREE.Vector3(box.x + box.w / 2, 0, box.y + box.h / 2);
      const { insets } = props.current;
      const w = container.clientWidth;
      const usable = Math.max(0.3, (w - insets.left - insets.right) / w);
      const usableH = Math.max(0.3, (container.clientHeight - insets.top - insets.bottom) / container.clientHeight);
      const vfov = THREE.MathUtils.degToRad(FOV);
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect * usable);
      // Seen from PITCH above the floor, depth on the map shrinks by sin(PITCH).
      const dist =
        Math.max(
          (box.h * Math.sin(PITCH)) / 2 / Math.tan(vfov / 2) / usableH,
          box.w / 2 / Math.tan(hfov / 2),
          6,
        ) * 1.05;
      // Shift the look point so the content centers in the area beside the guide.
      const shift = ((insets.left - insets.right) / w) * dist * Math.tan(hfov / 2) * 1.1;
      // Vertically, center between the top bar and whatever covers the bottom
      // (the dock, or the guide sheet on phones): look nearer the viewer.
      const lift =
        (((insets.bottom - insets.top) / container.clientHeight) * dist * Math.tan(vfov / 2)) /
        Math.sin(PITCH);
      const look = target
        .clone()
        .add(new THREE.Vector3(-shift * Math.cos(YAW), 0, shift * Math.sin(YAW)))
        .add(new THREE.Vector3(Math.sin(YAW) * lift, 0, Math.cos(YAW) * lift));
      const offset = new THREE.Vector3(
        Math.sin(YAW) * Math.cos(PITCH),
        Math.sin(PITCH),
        Math.cos(YAW) * Math.cos(PITCH),
      ).multiplyScalar(dist);
      return { look, position: look.clone().add(offset) };
    }

    api.current = {
      build,
      update() {
        const { scene, follow } = props.current;
        if (follow) manual = false;
        state.goal = goalFor();
        const active = glideOf(scene);
        state.activeFrom = state.drawnActive ?? active;
        state.activeTo = active;
        state.changedAt = performance.now();
        // Flows from the cells read to the cells written.
        disposeGroup(state.overlay);
        state.particles = [];
        const written = scene.groups.find((g) => g.role === "active");
        const target = written && cellsBox(written.block, written.cells);
        if (target) {
          const end = new THREE.Vector3(target.x + target.w / 2, LIFT + 0.2, target.y + target.h / 2);
          for (const g of scene.groups) {
            if (g.role !== "source") continue;
            const box = cellsBox(g.block, g.cells);
            const start = new THREE.Vector3(box.x + box.w / 2, LIFT + 0.2, box.y + box.h / 2);
            const distance = start.distanceTo(end);
            if (distance < 0.5) continue;
            const control = start.clone().add(end).multiplyScalar(0.5);
            control.y += Math.min(6, 0.8 + distance * 0.35);
            const curve = new THREE.QuadraticBezierCurve3(start, control, end);
            state.overlay.add(
              new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)),
                new THREE.LineBasicMaterial({ color: COLORS.source, transparent: true, opacity: 0.55 }),
              ),
            );
            for (let k = 0; k < 3; k++) {
              const dot = new THREE.Mesh(
                new THREE.SphereGeometry(0.09, 10, 10),
                new THREE.MeshBasicMaterial({ color: COLORS.active }),
              );
              state.overlay.add(dot);
              state.particles.push({ dot, curve, offset: k / 3 });
            }
          }
        }
      },
      recenter() {
        manual = false;
      },
    };
    build(props.current.track);
    api.current.update();

    function resize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      state.goal = goalFor();
    }
    resize();
    if (state.goal) {
      camera.position.copy(state.goal.position);
      controls.target.copy(state.goal.look);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let raf = 0;
    let last = performance.now();
    let lost = false;
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (lost || document.hidden) return;
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const { scene, track, reduced } = props.current;
      // Repaint textures whose state changed; lift the step being computed.
      for (const block of track.blocks) {
        const plate = state.plates.get(block.id);
        if (!plate) continue;
        const view = scene.views.get(block.id) ?? { mode: "done", key: "done" };
        if (plate.key !== view.key) paint(view, plate, block);
        plate.top.opacity = view.mode === "ghost" ? 0.45 : 1;
        const lift = view.mode === "live" ? LIFT : 0;
        plate.lift = reduced ? lift : approach(plate.lift, lift, dt, 0.5);
        plate.mesh.position.y = 0.08 + plate.lift;
        if (plate.bars) {
          if (plate.bars.userData.key !== view.key) aimBars(plate.bars, view);
          growBars(plate.bars, plate.lift, dt, reduced);
        }
      }
      state.labels.children.forEach((label) => {
        const i = label.userData.step;
        label.material.color.set(
          i === scene.si ? COLORS.accent : i < scene.si ? COLORS.label : COLORS.faint,
        );
      });
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
        activeFrame.position.set(box.x + box.w / 2, 0.2 + LIFT, box.y + box.h / 2);
      } else activeFrame.visible = false;
      const t = (now / 1000) % 1;
      for (const p of state.particles) {
        p.dot.visible = !reduced;
        p.curve.getPoint((t * 0.8 + p.offset) % 1, p.dot.position);
      }
      if (state.goal && !manual) {
        const settle = reduced ? 0.001 : 0.9;
        camera.position.set(
          approach(camera.position.x, state.goal.position.x, dt, settle),
          approach(camera.position.y, state.goal.position.y, dt, settle),
          approach(camera.position.z, state.goal.position.z, dt, settle),
        );
        controls.target.set(
          approach(controls.target.x, state.goal.look.x, dt, settle),
          approach(controls.target.y, state.goal.look.y, dt, settle),
          approach(controls.target.z, state.goal.look.z, dt, settle),
        );
      }
      controls.update();
      renderer.render(world, camera);
    }
    raf = requestAnimationFrame(frame);

    // Hover and click map back to a cell through the plate's texture coordinates.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downAt = null;
    function pick(e) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const plates = [...state.plates.values()];
      const bars = plates.map((p) => p.bars).filter(Boolean);
      const barHit = raycaster.intersectObjects(bars, false)[0];
      const meshes = plates.map((p) => p.mesh);
      const hit = raycaster.intersectObjects(meshes, false).find((h) => h.face?.materialIndex === 2);
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
    function move(e) {
      const tip = tipRef.current;
      const h = pick(e);
      renderer.domElement.style.cursor = h ? "pointer" : "grab";
      const view = h && props.current.scene.views.get(h.block.id);
      if (!h || view?.mode === "ghost" || (view?.done && !view.done(...h.cell))) {
        tip.hidden = true;
        return;
      }
      const [r, c] = h.cell;
      const cell = h.block.cell(r, c);
      if (!cell) return void (tip.hidden = true);
      tip.innerHTML = "";
      const title = document.createElement("b");
      title.textContent = h.block.title ?? h.block.id;
      const where = document.createElement("span");
      where.textContent =
        [h.block.rowLabels?.[r], h.block.colLabels?.[c]].filter((v) => v !== undefined).join(" · ") ||
        `row ${r}, column ${c}`;
      const value = document.createElement("code");
      value.textContent =
        typeof cell.value === "number" ? (Number.isFinite(cell.value) ? cell.value.toFixed(6) : "−∞") : (cell.full ?? cell.text);
      tip.append(title, where, value);
      tip.hidden = false;
      const rect = renderer.domElement.getBoundingClientRect();
      tip.style.transform = `translate(${Math.min(e.clientX - rect.left + 14, rect.width - 220)}px, ${e.clientY - rect.top + 16}px)`;
    }
    const down = (e) => (downAt = { x: e.clientX, y: e.clientY });
    function up(e) {
      if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
      const h = pick(e);
      if (h) props.current.onCell?.(h.block.id, ...h.cell);
    }
    const leave = () => (tipRef.current.hidden = true);
    function contextLost(e) {
      e.preventDefault();
      lost = true;
      onFail?.();
    }
    const el = renderer.domElement;
    el.addEventListener("pointermove", move);
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
      el.removeEventListener("webglcontextlost", contextLost);
      controls.dispose();
      state.plates.forEach((p) => {
        p.mesh.geometry.dispose();
        p.top.map.dispose();
        p.top.dispose();
        p.bars?.material.dispose();
        p.bars?.dispose();
      });
      barGeometry.dispose();
      disposeGroup(state.links);
      disposeGroup(state.labels);
      disposeGroup(state.overlay);
      activeFrame.geometry.dispose();
      frameMaterial.dispose();
      sideMaterial.dispose();
      grid.geometry.dispose();
      grid.material.dispose();
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
      <div ref={tipRef} className="map-tip" hidden />
    </div>
  );
}
