import { useState } from "react";
import { CheckCircle2, Download, Play, RotateCcw } from "lucide-react";
import { classroomChecks } from "./engine/classroom.js";
import {
  DEMO_TODAY,
  exportTrace,
  friendlyDate,
  friendlyTime,
  MAX_INPUT,
  SCENARIOS,
} from "./engine/pipeline.js";

function download(name, value) {
  const url = URL.createObjectURL(new Blob([value], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const json = (value) =>
  JSON.stringify(value, (_, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : v), 2);

export function RequestPanel({ input, setInput, scenario, onRun, onScenario }) {
  return (
    <>
      <form
        className="request-form"
        onSubmit={(e) => {
          e.preventDefault();
          onRun();
        }}
      >
        <label htmlFor="request">Request</label>
        <textarea
          id="request"
          value={input}
          maxLength={MAX_INPUT}
          rows={3}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Remind me to study tomorrow at 3 PM."
        />
        <div className="request-meta">
          <span>Today is fixed to {friendlyDate(DEMO_TODAY)}, 2026 (a Monday).</span>
          <span>
            {input.length} / {MAX_INPUT}
          </span>
        </div>
        <button className="primary" type="submit" disabled={!input.trim()}>
          <Play size={15} fill="currentColor" /> Trace this request
        </button>
      </form>
      <h3 className="drawer-sub">Examples</h3>
      <div className="scenarios">
        {SCENARIOS.map((s) => (
          <button key={s.id} aria-pressed={scenario === s.id} onClick={() => onScenario(s)}>
            <span>
              <b>{s.name}</b>
              <small>{s.prompt}</small>
            </span>
            <em>{s.tag}</em>
          </button>
        ))}
      </div>
      <p className="drawer-help">
        Supported commands start with remind me, create, add, set, find, show, search, get, list,
        move, reschedule, change, update, delete, remove or cancel. Dates: today, tomorrow, a
        weekday, or a month and day. Times: 3 PM, 11:30 am or 24-hour 15:00. Weekly reminders
        need “every Friday … for 4 weeks”.
      </p>
    </>
  );
}

export function DataPanel({ mode, trace, data, records, applied, onReset }) {
  const [checks, setChecks] = useState(null);
  return (
    <>
      <h3 className="drawer-sub">Sample records</h3>
      <div className="records">
        {records.map((r) => (
          <article
            key={r.id}
            className={applied && r.id === trace.decision.proposal?.targetId ? "is-changed" : ""}
          >
            <b>{r.id}</b>
            <span>
              {r.title}
              <small>
                {friendlyDate(r.date)}, {friendlyTime(r.time)}
              </small>
            </span>
            <code>rev {r.revision}</code>
          </article>
        ))}
      </div>
      <button className="secondary" onClick={onReset}>
        <RotateCcw size={14} /> Reset the records
      </button>
      <p className="drawer-help">Fictional records, kept in memory until you reset or reload.</p>

      <h3 className="drawer-sub">Self-checks</h3>
      <p className="drawer-help">
        Eight assertions run against fresh copies of the engine: ties ask, revisions protect,
        invalid times stop, attention rows sum to 1.
      </p>
      <button className="secondary" onClick={() => setChecks(classroomChecks())}>
        <CheckCircle2 size={14} />
        {checks
          ? `${checks.filter((c) => c.passed).length} of ${checks.length} passed · run again`
          : "Run the checks"}
      </button>
      {checks && (
        <ul className="checks">
          {checks.map((c) => (
            <li key={c.name} className={c.passed ? "is-pass" : "is-fail"}>
              <b>{c.passed ? "pass" : "fail"}</b> {c.name}
            </li>
          ))}
        </ul>
      )}

      <h3 className="drawer-sub">Export</h3>
      <p className="drawer-help">
        Every intermediate value from this run as JSON: the engine trace, the transformer arrays
        and the current records.
      </p>
      <button
        className="secondary"
        onClick={() =>
          download(
            "trace-run.json",
            json({
              format: "trace-v2",
              mode,
              engine: JSON.parse(exportTrace(trace)),
              inspection: data,
              records,
              applied,
            }),
          )
        }
      >
        <Download size={14} /> Download trace.json
      </button>

      <h3 className="drawer-sub">What runs here</h3>
      <p className="drawer-help">
        Everything is computed in this browser by the code shown under “Real source”. The planner
        uses rules, TF–IDF and cosine similarity. The transformer is one block with fixed,
        untrained weights: the arithmetic is real, the predicted tokens are not meaningful. No
        model or network service is called.
      </p>
    </>
  );
}
