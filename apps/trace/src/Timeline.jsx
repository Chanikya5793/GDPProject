// The scrubber in the dock: steps grouped by stage, each bar filled as far as
// playback has gone, with a preview of the step and frame under the pointer.
import { memo, useMemo, useRef, useState } from "react";
import { GROUPS } from "./flow.js";

// Consecutive steps of one stage, in track order. Steps a mode does not group
// form their own stage.
export function stagesOf(mode, columns) {
  const name = new Map();
  for (const g of GROUPS[mode] ?? []) for (const id of g.steps) name.set(id, g.name);
  const stages = [];
  columns.forEach((c, i) => {
    const n = name.get(c.step.id) ?? c.step.name;
    const last = stages.at(-1);
    if (last && last.name === n) last.items.push(i);
    else stages.push({ name: n, items: [i] });
  });
  return stages;
}

const weight = (c) => Math.max(2, Math.sqrt(c.count) * 1.6);

function Timeline({ mode, columns, si, fi, onSeek }) {
  const stages = useMemo(() => stagesOf(mode, columns), [mode, columns]);
  const box = useRef(null);
  const [peek, setPeek] = useState(null);
  const frameAt = (e, c) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(c.count - 1, Math.floor(((e.clientX - r.left) / r.width) * c.count)));
  };
  const show = (e, i) => {
    const c = columns[i];
    const outer = box.current.getBoundingClientRect();
    const x = Math.max(110, Math.min(outer.width - 110, e.clientX - outer.left));
    setPeek({ i, x, f: e.type === "focus" ? null : frameAt(e, c) });
  };
  return (
    <div className="tl" ref={box} onPointerLeave={() => setPeek(null)}>
      <div className="tl-stages" role="group" aria-label="Steps, grouped by stage">
        {stages.map((stage, k) => {
          const current = stage.items.includes(si);
          const done = stage.items.at(-1) < si;
          return (
            <div
              key={`${stage.name}-${k}`}
              className={`tl-stage ${current ? "is-current" : done ? "is-past" : ""}`}
              style={{
                flexGrow: Math.max(
                  9,
                  stage.items.reduce((s, i) => s + weight(columns[i]), 0),
                ),
              }}
            >
              <span className="tl-stage-name" title={stage.name}>
                {stage.name}
              </span>
              <div className="tl-steps">
                {stage.items.map((i) => {
                  const c = columns[i];
                  const p = i < si ? 1 : i > si ? 0 : (fi + 1) / c.count;
                  return (
                    <button
                      key={c.step.id}
                      type="button"
                      className={i === si ? "is-current" : i < si ? "is-past" : ""}
                      style={{ flexGrow: weight(c), "--p": p }}
                      onClick={(e) => onSeek(c.start + (e.detail ? frameAt(e, c) : 0))}
                      onPointerMove={(e) => show(e, i)}
                      onFocus={(e) => show(e, i)}
                      onBlur={() => setPeek(null)}
                      aria-label={`Step ${i + 1}: ${c.step.name}, ${c.count} frame${c.count === 1 ? "" : "s"}`}
                      aria-current={i === si ? "step" : undefined}
                    >
                      <i>{i === si && <em />}</i>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {peek && (
        <div className="tl-peek" style={{ left: peek.x }} aria-hidden="true">
          <small>
            Step {peek.i + 1}
            {peek.f !== null && columns[peek.i].count > 1 ? ` · frame ${peek.f + 1} of ${columns[peek.i].count}` : ""}
          </small>
          <b>{columns[peek.i].step.name}</b>
          <span>{columns[peek.i].step.algorithm}</span>
        </div>
      )}
    </div>
  );
}

export default memo(Timeline);
