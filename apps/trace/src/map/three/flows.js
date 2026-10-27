// Where a number comes from: arcs from the cells a frame reads to the cell it
// writes, with light particles travelling along them, and a halo where they
// land. One LineSegments, one Points and one halo mesh, rebuilt per frame.
import * as THREE from "three";
import { COLORS } from "../paint.js";
import { glowTexture } from "./stage.js";

const MAX_PATHS = 18;
const PER_PATH = 4;
const SEGMENTS = 40;

export function createFlows(world, { dark, hdr }) {
  const group = new THREE.Group();
  world.add(group);
  const texture = glowTexture();
  const from = new THREE.Color(COLORS.source);
  const to = new THREE.Color(COLORS.active);
  const blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;

  const lineMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: dark ? 0.55 : 0.7,
    depthWrite: false,
    fog: false,
  });
  const pointMaterial = new THREE.PointsMaterial({
    map: texture,
    vertexColors: true,
    size: dark ? 0.62 : 0.48,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    blending,
    fog: false,
  });
  const haloMaterial = new THREE.MeshBasicMaterial({
    map: texture,
    color: to.clone().multiplyScalar(0.8),
    transparent: true,
    depthWrite: false,
    blending,
    fog: false,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), haloMaterial);
  halo.rotation.x = -Math.PI / 2;
  halo.visible = false;
  group.add(halo);

  let lines = null;
  let points = null;
  let paths = [];
  let target = null;
  let startedAt = 0;

  function clear() {
    if (lines) {
      group.remove(lines);
      lines.geometry.dispose();
    }
    if (points) {
      group.remove(points);
      points.geometry.dispose();
    }
    lines = points = null;
    paths = [];
    halo.visible = false;
  }

  // routes: [{ start: Vector3, end: Vector3 }]; land: { point, size } or null.
  function set(routes, land) {
    clear();
    startedAt = performance.now();
    target = land;
    if (land) {
      halo.visible = true;
      halo.position.copy(land.point);
      halo.position.y += 0.02;
    }
    const pick =
      routes.length > MAX_PATHS
        ? Array.from({ length: MAX_PATHS }, (_, k) => routes[Math.floor((k * routes.length) / MAX_PATHS)])
        : routes;
    paths = pick
      .filter((r) => r.start.distanceTo(r.end) > 0.3)
      .map(({ start, end }, k) => {
        const length = start.distanceTo(end);
        const control = start.clone().add(end).multiplyScalar(0.5);
        control.y = Math.max(start.y, end.y) + Math.min(7, 0.7 + length * 0.32);
        const curve = new THREE.QuadraticBezierCurve3(start, control, end);
        return { curve, duration: Math.min(2.4, 0.9 + length * 0.05), phase: (k * 0.37) % 1 };
      });
    if (!paths.length) return;
    const lp = new Float32Array(paths.length * SEGMENTS * 6);
    const lc = new Float32Array(paths.length * SEGMENTS * 6);
    const c = new THREE.Color();
    let o = 0;
    for (const { curve } of paths) {
      const pts = curve.getPoints(SEGMENTS);
      for (let s = 0; s < SEGMENTS; s++)
        for (const j of [s, s + 1]) {
          pts[j].toArray(lp, o);
          c.copy(from).lerp(to, j / SEGMENTS).toArray(lc, o);
          o += 3;
        }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(lp, 3));
    lg.setAttribute("color", new THREE.BufferAttribute(lc, 3));
    lines = new THREE.LineSegments(lg, lineMaterial);
    lines.frustumCulled = false;
    group.add(lines);
    const n = paths.length * PER_PATH;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    points = new THREE.Points(pg, pointMaterial);
    points.frustumCulled = false;
    group.add(points);
  }

  const p = new THREE.Vector3();
  const c = new THREE.Color();
  function tick(now, reduced) {
    const age = (now - startedAt) / 1000;
    if (lines) lineMaterial.opacity = (dark ? 0.55 : 0.7) * Math.min(1, reduced ? 1 : age * 3);
    if (target) {
      const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(age * 5);
      const s = target.size * (1.05 + pulse * 0.15);
      halo.scale.set(s, s, 1);
      haloMaterial.opacity = (dark ? 0.1 : 0.2) + pulse * 0.06;
    }
    if (!points) return;
    points.visible = !reduced;
    if (reduced) return;
    const pos = points.geometry.attributes.position;
    const col = points.geometry.attributes.color;
    let i = 0;
    for (const path of paths)
      for (let k = 0; k < PER_PATH; k++) {
        const t = ((age / path.duration) + path.phase + k / PER_PATH) % 1;
        // Ease so particles leave gently and arrive with a little speed.
        const u = t * t * (3 - 2 * t);
        path.curve.getPoint(u, p);
        pos.setXYZ(i, p.x, p.y, p.z);
        // Fade in at the source, brightest just before landing.
        const fade = Math.min(1, t * 6) * (t > 0.96 ? (1 - t) * 25 : 1);
        c.copy(from).lerp(to, u).multiplyScalar((hdr ? 1.3 : 1) * (dark ? fade : 1));
        col.setXYZ(i, c.r, c.g, c.b);
        i++;
      }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }

  return {
    set,
    clear,
    tick,
    dispose() {
      clear();
      world.remove(group);
      halo.geometry.dispose();
      haloMaterial.dispose();
      lineMaterial.dispose();
      pointMaterial.dispose();
      texture.dispose();
    },
  };
}
