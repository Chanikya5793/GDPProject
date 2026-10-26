// The teaching blocks shared by the guide and the Flow cards: a step's
// lesson (what / why / in this run / try it), the default-vs-yours line, and
// the chip naming the settings that reach a step.
import { FlaskConical, RotateCcw, SlidersHorizontal } from "lucide-react";
import { lessonFor } from "./lessons/index.js";
import Glossed from "./Glossed.jsx";
import { settingFor } from "../tune/schema.js";
import { formatChange, formatValue, pathOfLabel } from "../tune/format.js";

// Lessons are written while the site runs; a missing or broken one is skipped.
export function safeLesson(stepId, track) {
  try {
    return lessonFor(stepId, track);
  } catch {
    return null;
  }
}
export function lessonExample(lesson, ctx) {
  if (typeof lesson?.example !== "function") return null;
  try {
    const text = lesson.example(ctx);
    return typeof text === "string" && text.trim() ? text : null;
  } catch {
    return null;
  }
}
export function lessonTries(lesson) {
  return Array.isArray(lesson?.try) ? lesson.try.filter((t) => t && settingFor(t.setting)) : [];
}

const valueAt = (params, path) => {
  const [track, key] = path.split(".");
  return params?.[track]?.[key];
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// One "Try it" suggestion. When it is already applied, it offers the way back.
export function TryButton({ item, params, onTune, compact = false }) {
  const setting = settingFor(item.setting);
  const applied = params && same(valueAt(params, item.setting), item.value);
  const label = applied
    ? `Undo: ${setting.label} back to ${setting.type === "words" || setting.type === "pairs" ? "the default" : formatValue(setting, setting.default)}`
    : `${setting.label}: ${formatChange(setting, item.value)}`;
  return (
    <button
      type="button"
      className={`try-btn ${applied ? "is-applied" : ""} ${compact ? "is-compact" : ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onTune(item.setting, applied ? setting.default : item.value);
      }}
    >
      {applied ? <RotateCcw size={13} /> : <FlaskConical size={13} />}
      <span>{compact && !applied ? `Try ${label}` : label}</span>
    </button>
  );
}

export function LessonBlock({ stepId, mode, ctx, detail, params, onTune, seen }) {
  const lesson = safeLesson(stepId, mode);
  if (!lesson) return null;
  const example = detail ? lessonExample(lesson, ctx) : null;
  const tries = onTune ? lessonTries(lesson) : [];
  const why = detail && typeof lesson.why === "string" ? lesson.why : null;
  const what = typeof lesson.what === "string" ? lesson.what : null;
  if (!what && !why && !example && !tries.length) return null;
  return (
    <section className="lesson" aria-label="About this step">
      {what && (
        <div className="lesson-row">
          <h3>What</h3>
          <p>
            <Glossed text={what} seen={seen} />
          </p>
        </div>
      )}
      {why && (
        <div className="lesson-row">
          <h3>Why</h3>
          <p>
            <Glossed text={why} seen={seen} />
          </p>
        </div>
      )}
      {example && (
        <div className="lesson-row is-example">
          <h3>In this run</h3>
          <p>
            <Glossed text={example} seen={seen} />
          </p>
        </div>
      )}
      {tries.length > 0 && (
        <div className="lesson-row is-try">
          <h3>Try it</h3>
          <ul>
            {tries.map((t, i) => (
              <li key={i}>
                <TryButton item={t} params={params} onTune={onTune} />
                {t.watch && (
                  <p>
                    <Glossed text={t.watch} seen={seen} />
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// "default: … → yours: …" for a step the settings changed.
export function CompareLine({ compare, compact = false }) {
  if (!compare) return null;
  return (
    <div className={`compare ${compact ? "is-compact" : ""}`}>
      <span className="compare-side">
        <small>default</small>
        <code>{compare.beforeText}</code>
      </span>
      <span className="compare-arrow" aria-hidden="true">
        →
      </span>
      <span className="compare-side is-yours">
        <small>yours</small>
        <code>{compare.afterText}</code>
      </span>
    </div>
  );
}

// The settings that reach this step; each opens the Tune panel on it.
export function TunedChip({ step, mode, onTune }) {
  if (!step.tuned?.length) return null;
  const first = pathOfLabel(step.tuned[0], mode);
  const text = `tuned: ${step.tuned.join(", ")}`;
  if (!onTune || !first)
    return (
      <span className="tuned-chip">
        <SlidersHorizontal size={11} /> {text}
      </span>
    );
  return (
    <button
      type="button"
      className="tuned-chip"
      title="Open these settings"
      onClick={(e) => {
        e.stopPropagation();
        onTune(first);
      }}
    >
      <SlidersHorizontal size={11} /> {text}
    </button>
  );
}
