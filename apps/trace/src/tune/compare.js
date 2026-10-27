// Default vs your settings, per step: the one-line Flow summaries of the
// same request run twice. Cached per ctx, since every view asks.
import { summarize } from "../flow.js";

const cache = new WeakMap();
const safe = (id, ctx) => {
  try {
    return summarize(id, ctx);
  } catch {
    return null;
  }
};

// → Map(stepId → { before, after }) for steps whose summary differs.
export function compareSteps(steps, ctx) {
  if (!ctx?.baseline) return new Map();
  let byCtx = cache.get(ctx);
  if (!byCtx) cache.set(ctx, (byCtx = new Map()));
  const out = new Map();
  for (const step of steps) {
    if (!byCtx.has(step.id)) {
      const before = safe(step.id, ctx.baseline);
      const after = safe(step.id, ctx);
      const differs = before && after && (before.in !== after.in || before.out !== after.out);
      // Show the side that changed: usually the output.
      const key = differs && before.out !== after.out ? "out" : "in";
      byCtx.set(step.id, differs ? { before, after, key, beforeText: before[key], afterText: after[key] } : null);
    }
    const c = byCtx.get(step.id);
    if (c) out.set(step.id, c);
  }
  return out;
}
