// Camera helpers shared by the 2D and 3D maps.

// Frame-rate independent exponential approach: covers ~95% of the distance
// in `settle` seconds.
export const approach = (current, target, dt, settle = 0.6) =>
  current + (target - current) * (1 - Math.exp((-3 * dt) / settle));

export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
const fit = (box, view) =>
  Math.min(view.w / Math.max(box.w, 0.001), view.h / Math.max(box.h, 0.001));

// Where the camera should be for a frame. If the whole step fits at a
// readable zoom, hold still on the step; otherwise keep the zoom readable and
// pan to the cells being read and written, staying inside the step.
export function framing({ stepBox, focusBox, view, readable, maxZoom }) {
  const whole = Math.min(maxZoom, fit(stepBox, view));
  if (whole >= readable || !focusBox)
    return { x: stepBox.x + stepBox.w / 2, y: stepBox.y + stepBox.h / 2, z: whole };
  const z = clamp(fit(focusBox, view), readable * 0.7, readable);
  const halfW = view.w / z / 2;
  const halfH = view.h / z / 2;
  return {
    x: clamp(focusBox.x + focusBox.w / 2, stepBox.x + halfW, stepBox.x + stepBox.w - halfW),
    y: clamp(focusBox.y + focusBox.h / 2, stepBox.y + halfH, stepBox.y + stepBox.h - halfH),
    z,
  };
}

export const overview = (bounds, view) => ({
  x: bounds.x + bounds.w / 2,
  y: bounds.y + bounds.h / 2,
  z: fit(bounds, view) * 0.95,
});
