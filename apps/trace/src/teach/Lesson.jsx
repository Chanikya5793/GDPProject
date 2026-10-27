// The teaching blocks shared by the guide and the Flow cards: a step's
// lesson (what / why / in this run / try it), the default-vs-yours line, and
// the chip naming the settings that reach a step.
import { useId, useState } from "react";
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

const LESSON_TABS = [
  ["what", "What"],
  ["why", "Why"],
  ["run", "In this run"],
  ["try", "Try it"],
];

// A step's lesson as tabs, so the guide stays one calm column. The chosen tab
// is kept across steps when the caller passes `tab` and `onTab`.
export function LessonBlock({ stepId, mode, ctx, detail, params, onTune, seen, tab, onTab }) {
  const [own, setOwn] = useState("what");
  const base = useId();
  const lesson = safeLesson(stepId, mode);
  if (!lesson) return null;
  const example = detail ? lessonExample(lesson, ctx) : null;
  const tries = onTune ? lessonTries(lesson) : [];
  const why = typeof lesson.why === "string" ? lesson.why : null;
  const what = typeof lesson.what === "string" ? lesson.what : null;
  const has = { what: !!what, why: !!why, run: !!example, try: tries.length > 0 };
  const tabs = LESSON_TABS.filter(([id]) => has[id]);
  if (!tabs.length) return null;
  const wanted = tab ?? own;
  const current = has[wanted] ? wanted : tabs[0][0];
  const pick = (id) => (onTab ? onTab(id) : setOwn(id));
  const move = (e) => {
    const i = tabs.findIndex(([id]) => id === current);
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const id = tabs[(next + tabs.length) % tabs.length][0];
    pick(id);
    e.currentTarget.querySelector(`#${CSS.escape(`${base}-${id}`)}`)?.focus();
  };
  return (
    <section className="lesson" aria-label="About this step">
      <div className="lesson-tabs" role="tablist" aria-label="About this step" onKeyDown={move}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            id={`${base}-${id}`}
            type="button"
            role="tab"
            aria-selected={current === id}
            aria-controls={`${base}-panel`}
            tabIndex={current === id ? 0 : -1}
            onClick={() => pick(id)}
          >
            {label}
            {id === "try" && <span className="lesson-count">{tries.length}</span>}
          </button>
        ))}
      </div>
      <div className="lesson-panel" id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-${current}`} key={current}>
        {current === "what" && (
          <p>
            <Glossed text={what} seen={seen} />
          </p>
        )}
        {current === "why" && (
          <p>
            <Glossed text={why} seen={seen} />
          </p>
        )}
        {current === "run" && (
          <p className="is-example">
            <Glossed text={example} seen={seen} />
          </p>
        )}
        {current === "try" && (
          <ul className="lesson-try">
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
        )}
      </div>
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
