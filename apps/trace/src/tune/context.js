import { microscope } from "../engine/microscope.js";
import { sampleCopilot, SAMPLE_MESSAGE, SAMPLE_RESPONSE } from "../engine/copilotSample.js";
import { changed, isTuned, resolveAll } from "./schema.js";

// What every step module reads. With tuned settings, `baseline` is the same
// request run on the defaults, for side-by-side comparison.
//   rerun(plannerParams) → the planner trace for this request with other settings
//   copilot: the exchange to trace; without it, the sample exchange
export function buildCtx({ trace, rerun, records = [], applied = false, generatedTokens = [], params, copilot }) {
  const make = (t, p) => {
    const data = microscope(t, generatedTokens, p.transformer);
    // Only the sample message has a real reply to show.
    const c = copilot ?? {
      ...sampleCopilot(),
      message: t.original || SAMPLE_MESSAGE,
      response: t.original === SAMPLE_MESSAGE ? SAMPLE_RESPONSE : null,
    };
    return { trace: t, data, model: data.transformer, records, applied, generatedTokens, copilot: c, params: p };
  };
  const ctx = make(trace, params);
  if (!isTuned(params)) return { ...ctx, baseline: null };
  const defaults = resolveAll();
  const base = changed("planner", params.planner).length && rerun ? rerun(defaults.planner) : trace;
  return { ...ctx, baseline: make(base, defaults) };
}
