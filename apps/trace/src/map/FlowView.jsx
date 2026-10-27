import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { GROUPS, summarize } from "../flow.js";
import Badge from "../Badge.jsx";
import Glossed from "../teach/Glossed.jsx";
import { CompareLine, lessonTries, safeLesson, TryButton, TunedChip } from "../teach/Lesson.jsx";

function summary(id, ctx) {
  try {
    return summarize(id, ctx) ?? { in: "", out: "" };
  } catch {
    return { in: "", out: "" };
  }
}

// The system at stage level: each algorithm as a card with what went in and
// what came out for this request. Click a card to open it on the map.
// In Simple mode the illustration cards drop their numbers: the plain text
// says what happens, and the values belong to Detailed and the maps.
export default function FlowView({ mode, track, si, ctx, onPick, onOpen, detail, reduced, compare, params, onTune }) {
  const index = new Map(track.columns.map((c, i) => [c.step.id, i]));
  const box = useRef(null);
  // Keep the stage being explained in view as playback moves on.
  useEffect(() => {
    const el = box.current?.querySelector(".flow-card.is-current");
    if (!el) return;
    const frame = box.current.getBoundingClientRect();
    const card = el.getBoundingClientRect();
    const top = box.current.scrollTop + card.top - frame.top - frame.height / 2 + card.height / 2;
    box.current.scrollTo({ top: Math.max(0, top), behavior: reduced ? "instant" : "smooth" });
  }, [si, reduced]);
  return (
    <div className="flow" aria-label="Pipeline overview" ref={box}>
      <div className="flow-inner">
        {GROUPS[mode].map((group, gi) => {
          const ids = group.steps.filter((id) => index.has(id));
          if (!ids.length) return null;
          const first = index.get(ids[0]);
          const lastI = index.get(ids.at(-1));
          const gState = lastI < si ? "is-done" : first <= si ? "is-current" : "";
          const lastStep = track.columns[lastI].step;
          const handoff =
            gi < GROUPS[mode].length - 1 && (detail || lastStep.badge !== "illustration")
              ? summary(ids.at(-1), ctx).out
              : "";
          return (
            <section key={group.name} className={`flow-group ${gState}`} aria-label={`Stage ${gi + 1}: ${group.name}`}>
              <span className="flow-node" aria-hidden="true">
                {gi + 1}
              </span>
              <div>
                <h3>{group.name}</h3>
                <div className="flow-row">
                  {ids.map((id) => {
                    const i = index.get(id);
                    const step = track.columns[i].step;
                    const s = summary(id, ctx);
                    const lesson = safeLesson(id, mode);
                    const what = typeof lesson?.what === "string" ? lesson.what : null;
                    const tryIt = onTune ? lessonTries(lesson)[0] : null;
                    const diff = compare?.get(id);
                    const state = i < si ? "is-done" : i === si ? "is-current" : "";
                    return (
                      <article
                        key={id}
                        className={`flow-card ${state}`}
                        onClick={() => onPick(i)}
                        onKeyDown={(e) => {
                          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                            e.preventDefault();
                            onPick(i);
                          }
                        }}
                        tabIndex={0}
                        aria-current={i === si ? "step" : undefined}
                        aria-label={`Step ${i + 1}: ${step.algorithm}`}
                      >
                        <i className="flow-wire" aria-hidden="true" />
                        <header>
                          <small>{String(i + 1).padStart(2, "0")}</small>
                          <b>{step.algorithm}</b>
                          {step.badge && <Badge kind={step.badge} />}
                        </header>
                        <p className="flow-what">
                          <Glossed text={what ?? step.plain} />
                        </p>
                        {(detail || step.badge !== "illustration") && (s.in || s.out) && (
                          <div className="flow-io">
                            {s.in && (
                              <div>
                                <span className="io-tag">in</span>
                                <code>{s.in}</code>
                              </div>
                            )}
                            {s.out && (
                              <div>
                                <span className="io-tag is-out">out</span>
                                <code>{s.out}</code>
                              </div>
                            )}
                          </div>
                        )}
                        {diff && <CompareLine compare={diff} compact />}
                        {(step.tuned || tryIt) && (
                          <div className="flow-foot">
                            <TunedChip step={step} mode={mode} onTune={onTune} />
                            {tryIt && <TryButton item={tryIt} params={params} onTune={onTune} compact />}
                          </div>
                        )}
                        {i === si && (
                          <button
                            className="flow-open"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpen(i);
                            }}
                          >
                            See every calculation <ArrowRight size={14} />
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
                {handoff && (
                  <p className="flow-handoff">
                    <span>Passes on</span>
                    <code title={handoff}>{handoff}</code>
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
