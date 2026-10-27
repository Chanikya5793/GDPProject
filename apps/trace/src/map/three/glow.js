// Rendering with an optional subtle bloom (dark theme only: only colours
// pushed above 1, the active data and the flow particles, glow). Quality
// steps down on its own when frames run long: bloom off first, then a lower
// pixel ratio.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const RATIOS = [1.75, 1.25, 1];

// Software renderers and very small GPUs get no bloom from the start.
export function weakGpu(renderer) {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return true;
  } catch {
    /* unknown: assume capable */
  }
  return (navigator.hardwareConcurrency || 8) <= 2;
}

export function createGlow(renderer, scene, camera, { bloom }) {
  let composer = null;
  let bloomPass = null;
  let level = 0;
  let w = 1;
  let h = 1;
  const ratio = () => Math.min(window.devicePixelRatio || 1, RATIOS[level]);

  function build() {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.4, 0.35, 1.05);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  }
  function drop() {
    if (!composer) return;
    composer.passes.forEach((p) => p.dispose?.());
    composer.dispose();
    composer = bloomPass = null;
  }
  if (bloom) build();

  function setSize(width, height) {
    w = width;
    h = height;
    renderer.setPixelRatio(ratio());
    renderer.setSize(w, h, false);
    if (composer) {
      composer.setPixelRatio(ratio());
      composer.setSize(w, h);
    }
  }

  // Frame-time watch: sustained long frames lower the quality one level.
  let slow = 0;
  let samples = 0;
  function watch(dt) {
    // Throttled background tabs report huge gaps; those say nothing about the GPU.
    if (dt > 0.1 || dt <= 0) return;
    samples++;
    slow = slow * 0.95 + (dt > 1 / 40 ? 0.05 : 0);
    if (samples < 90 || slow < 0.6) return;
    samples = 0;
    slow = 0;
    if (composer) drop();
    else if (level < RATIOS.length - 1) level++;
    else return;
    setSize(w, h);
  }

  return {
    setSize,
    watch,
    get bloom() {
      return !!composer;
    },
    render() {
      if (composer) composer.render();
      else renderer.render(scene, camera);
    },
    dispose: drop,
  };
}
