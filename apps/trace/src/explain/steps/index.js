// Step modules, keyed by the step ids in src/steps.js.
//
// A module is a plain object:
//   id      step id
//   source  [["pipeline" | "transformer", "declarationName"], ...]
//           top-level engine declarations shown under "Real source"
//   code    pseudocode lines, close to the real JavaScript
//   frames(ctx) → Frame[]   the algorithm run one small step at a time
//   Stage({ ctx, frame, frames, at, seek })   the step as tables (Tables drawer)
//   blocks, output, state, math               the map layer; see src/map/track.js
//
// Frame: { phase, line (index or indices into `code`), say (one plain
// sentence about this micro-step, with the real numbers), vars (name →
// value shown in the Variables panel), hold? (relative duration), ...state }
//
// ctx: { trace, data, model, records, applied, generatedTokens }
import planner from "./planner/index.js";
import transformer from "./transformer/index.js";

const modules = [...planner, ...transformer];

export const STEP_MODULES = Object.fromEntries(modules.map((m) => [m.id, m]));
