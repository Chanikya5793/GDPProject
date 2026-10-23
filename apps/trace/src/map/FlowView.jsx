import { ArrowRight } from "lucide-react";
import { GROUPS, summarize } from "../flow.js";

// The system at stage level: each algorithm as a card with what went in and
// what came out for this request. Click a card to open it on the map.
export default function FlowView({ mode, track, si, ctx, onPick, onOpen }) {
  const index = new Map(track.columns.map((c, i) => [c.step.id, i]));
  return (
    <div className="flow" aria-label="Pipeline overview">
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
                  style={{ "--c": step.color }}
                  onClick={() => onPick(i)}
                >
                  <i className="flow-wire" aria-hidden="true" />
                  <header>
                    <small>{String(i + 1).padStart(2, "0")}</small>
                    <b>{step.algorithm}</b>
                  </header>
                  <p>{step.plain}</p>
                  <dl>
                    <dt>in</dt>
                    <dd>{s.in}</dd>
                    <dt>out</dt>
                    <dd>{s.out}</dd>
                  </dl>
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
