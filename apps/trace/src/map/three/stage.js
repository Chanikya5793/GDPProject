// The room the 3D map stands in: backdrop, floor, light pool, contact
// shadows, lights and a small reflection environment. Every tone is derived
// from the page palette (COLORS), so it follows light and dark.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { COLORS } from "../paint.js";

const hex = (c) => new THREE.Color(c);
const mix = (a, b, t) => hex(a).lerp(hex(b), t);
const css = (c) => `#${c.getHexString()}`;

export function stageTones() {
  const dark = hex(COLORS.bg).getHSL({ h: 0, s: 0, l: 0 }).l < 0.5;
  return dark
    ? {
        dark,
        sky: mix(COLORS.bg, COLORS.accent, 0.05).lerp(hex("#ffffff"), 0.05),
        horizon: hex(COLORS.bg),
        floor: mix(COLORS.bg, "#000000", 0.3),
        dots: mix(COLORS.bg, "#ffffff", 0.035),
        pool: mix(COLORS.accent, "#ffffff", 0.6).multiplyScalar(0.11),
        shadow: hex("#000000"),
        shadowOpacity: 0.6,
        side: mix(COLORS.plate, COLORS.bg, 0.5),
        rim: mix(COLORS.accent, COLORS.source, 0.5),
      }
    : {
        dark,
        sky: mix(COLORS.bg, "#ffffff", 0.8),
        horizon: hex(COLORS.bg),
        floor: mix(COLORS.bg, COLORS.edge, 0.9),
        dots: mix(COLORS.bg, COLORS.label, 0.22),
        pool: hex("#ffffff"),
        shadow: mix(COLORS.title, COLORS.bg, 0.2),
        shadowOpacity: 0.24,
        side: mix(COLORS.plate, COLORS.edge, 0.7),
        rim: mix(COLORS.accent, "#ffffff", 0.3),
      };
}

function canvasTexture(w, h, draw, srgb = true) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d"), w, h);
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// A soft round spot, white with alpha: particles, halos, the light pool.
export const glowTexture = () =>
  canvasTexture(128, 128, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.55)");
    g.addColorStop(0.6, "rgba(255,255,255,0.12)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });

// A blurred rectangle: the contact shadow under a plate. The rectangle fills
// the middle SHADOW_CORE of the texture.
export const SHADOW_CORE = 0.7;
const shadowTexture = () =>
  canvasTexture(256, 256, (ctx, w) => {
    const inset = (w * (1 - SHADOW_CORE)) / 2;
    ctx.filter = `blur(${Math.round(inset * 0.55)}px)`;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(inset, inset, w - inset * 2, w - inset * 2);
  });

export function createStage(renderer, world) {
  const tones = stageTones();
  const disposables = [];
  const keep = (x) => (disposables.push(x), x);

  // Backdrop: a vertical gradient behind everything; fog fades the floor into it.
  world.background = keep(
    canvasTexture(4, 256, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, css(tones.sky));
      g.addColorStop(0.65, css(tones.horizon));
      g.addColorStop(1, css(tones.horizon));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }),
  );
  world.fog = new THREE.Fog(tones.horizon, 60, 200);

  // Floor: a dotted ground, one dot every two units.
  const dots = keep(
    canvasTexture(64, 64, (ctx, w) => {
      ctx.fillStyle = css(tones.floor);
      ctx.fillRect(0, 0, w, w);
      ctx.fillStyle = css(tones.dots);
      ctx.beginPath();
      ctx.arc(w / 2, w / 2, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }),
  );
  dots.wrapS = dots.wrapT = THREE.RepeatWrapping;
  dots.repeat.set(1200, 1200);
  dots.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const floor = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(2400, 2400)),
    keep(new THREE.MeshBasicMaterial({ map: dots })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  // Out of the depth buffer and drawn first: the light pool and contact
  // shadows just above it can't z-fight it into stripes at a distance.
  floor.material.depthWrite = false;
  floor.renderOrder = -3;
  world.add(floor);

  // A pool of light on the floor under the step being computed.
  const glow = keep(glowTexture());
  const pool = new THREE.Mesh(
    keep(new THREE.PlaneGeometry(1, 1)),
    keep(
      new THREE.MeshBasicMaterial({
        map: glow,
        color: tones.pool,
        transparent: true,
        opacity: tones.dark ? 1 : 0.85,
        depthWrite: false,
        blending: tones.dark ? THREE.AdditiveBlending : THREE.NormalBlending,
        fog: false,
        dithering: true,
      }),
    ),
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = -0.005;
  pool.renderOrder = -2;
  world.add(pool);

  const shadowMap = keep(shadowTexture());
  const shadowGeometry = keep(new THREE.PlaneGeometry(1, 1));
  shadowGeometry.rotateX(-Math.PI / 2);
  function shadow() {
    const material = new THREE.MeshBasicMaterial({
      map: shadowMap,
      color: tones.shadow,
      transparent: true,
      opacity: tones.shadowOpacity,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(shadowGeometry, material);
    mesh.renderOrder = -1;
    mesh.position.y = 0.002;
    return mesh;
  }

  // Key from the front left, a tinted rim from behind, sky fill from above.
  const hemi = new THREE.HemisphereLight("#ffffff", tones.floor, tones.dark ? 0.9 : 2.1);
  const key = new THREE.DirectionalLight("#ffffff", tones.dark ? 1.3 : 1.8);
  key.position.set(-14, 30, 22);
  const rim = new THREE.DirectionalLight(tones.rim, tones.dark ? 1.1 : 1.1);
  rim.position.set(12, 14, -30);
  world.add(hemi, key, rim);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04).texture;
  room.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  pmrem.dispose();

  const poolAt = { x: 0, z: 0, size: 20 };
  return {
    tones,
    env,
    shadow,
    // Eases the light pool toward a floor box.
    tick(box, dt, reduced) {
      if (box) {
        const k = (v, t) => (reduced ? t : v + (t - v) * (1 - Math.exp(-4 * dt)));
        poolAt.x = k(poolAt.x, box.x + box.w / 2);
        poolAt.z = k(poolAt.z, box.y + box.h / 2);
        poolAt.size = k(poolAt.size, Math.max(box.w, box.h) * 1.9 + 8);
      }
      pool.position.x = poolAt.x;
      pool.position.z = poolAt.z;
      pool.scale.set(poolAt.size, poolAt.size, 1);
    },
    // Fog that keeps the framed content clear at any distance.
    fogFor(distance) {
      world.fog.near = distance * 1.5;
      world.fog.far = distance * 4;
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
      env.dispose();
      world.remove(floor, pool, hemi, key, rim);
      world.background = null;
      world.fog = null;
    },
  };
}
