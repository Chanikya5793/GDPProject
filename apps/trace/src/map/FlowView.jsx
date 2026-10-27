import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { GROUPS, summarize } from "../flow.js";
import Badge from "../Badge.jsx";

// The system at stage level: each algorithm as a card with what went in and
// what came out for this request. Click a card to open it on the map.
// In Simple mode the illustration cards drop their numbers: the plain text
// says what happens, and the values belong to Detailed and the maps.
export default function FlowView({ mode, track, si, ctx, onPick, onOpen, detail, reduced }) {
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
      {GROUPS[mode].map((group, gi) => (
        <section key={group.name} className="flow-group">
          <h3>
            <span>{gi + 1}</span>
            {group.name}
          </h3>
          <div className="flow-row">
            {group.steps.map((id) => {
              const i = index.get(id);
              const step = track.columns[i].step;
              const s = summarize(id, ctx);
              const state = i < si ? "is-done" : i === si ? "is-current" : "";
              return (
                <article
                  key={id}
                  className={`flow-card ${state}`}
                  onClick={() => onPick(i)}
                >
                  <i className="flow-wire" aria-hidden="true" />
                  <header>
                    <small>{String(i + 1).padStart(2, "0")}</small>
                    <b>{step.algorithm}</b>
                    {step.badge && <Badge kind={step.badge} />}
                  </header>
                  <p>{step.plain}</p>
                  {(detail || step.badge !== "illustration") && (
                  <dl>
                    <dt>in</dt>
                    <dd>{s.in}</dd>
                    <dt>out</dt>
                    <dd>{s.out}</dd>
                  </dl>
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
        </section>
      ))}
    </div>
  );
}
