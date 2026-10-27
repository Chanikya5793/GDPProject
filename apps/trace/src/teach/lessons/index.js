// One lesson per step, keyed by the step ids in src/steps.js.
//
// Lesson: {
//   what:  one or two plain sentences: what this step does to your input
//   why:   one or two sentences: why the system needs it, what breaks without it
//   example(ctx) → string   optional: the step worked on this run's real values
//   try: [{ setting: "copilot.maxDistance", value: 0.9,
//           watch: "what to look for after the change" }]
// }
// `setting` paths are `track.key` from src/tune/schema.js. Prose stays plain
// English for a first-year student; glossary words are linked automatically.
import planner from "./planner.js";
import copilot, { COPILOT_MODEL_LESSONS } from "./copilot.js";
import transformer from "./transformer.js";

export const LESSONS = { ...planner, ...transformer, ...copilot };
// The copilot's model steps reuse the transformer's ids but have their own lessons.
export const lessonFor = (stepId, mode) =>
  (mode === "copilot" && COPILOT_MODEL_LESSONS?.[stepId]) || LESSONS[stepId] || null;
