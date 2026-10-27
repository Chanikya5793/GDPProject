// The Tune panel: every setting of the current track as a form, the same
// settings as editable JSON, and what your changes did to this run.
// A side sheet, not a dialog: the map keeps running beside it.
// Props: { open, mode, params, focus, onTune(path, value), onSet(params),
//          onReset(track?), onClose(), baseline, ctx, steps }
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { RotateCcw, X } from "lucide-react";
import { changed, isTuned, parseCode, SETTINGS, toCode } from "./schema.js";
import { formatValue } from "./format.js";
import { compareSteps } from "./compare.js";
import { CompareLine } from "../teach/Lesson.jsx";

const TRACKS = { planner: "Planner pipeline", transformer: "Transformer block", copilot: "Copilot search" };
// Settings in the order a learner meets them on the track.
const GROUPS = {
  planner: [
    ["Which words count", ["stopWords", "aliases", "dropDates"]],
    ["How words are weighted", ["useIdf", "smoothIdf"]],
    ["How the planner decides", ["matchThreshold", "tieGap"]],
  ],
  copilot: [
    ["Which words are searched", ["stopwords", "queryChars"]],
    ["The hashed vector", ["dimensions", "logWeight", "titleBoost"]],
    ["Which records are kept", ["candidates", "maxDistance", "requireShared", "limit"]],
  ],
  transformer: [
    ["Tokens and positions", ["merges", "context", "positional"]],
    ["Attention", ["scaleScores", "causalMask"]],
    ["The layers", ["residual", "activation"]],
    ["Picking the next token", ["temperature"]],
  ],
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function groupsFor(track) {
  const list = SETTINGS[track] ?? [];
  const named = (GROUPS[track] ?? []).map(([name, keys]) => [
    name,
    keys.map((k) => list.find((s) => s.key === k)).filter(Boolean),
  ]);
  const placed = new Set(named.flatMap(([, l]) => l.map((s) => s.key)));
  const rest = list.filter((s) => !placed.has(s.key));
  return [...named, ...(rest.length ? [["Other", rest]] : [])].filter(([, l]) => l.length);
}

// A typed number: edited as text, committed on Enter or blur, then clamped.
function NumberBox({ value, onCommit, labelledBy, describedBy, setting }) {
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n)) setDraft(String(value));
    else onCommit(n);
  };
  return (
    <input
      type="number"
      className="tune-num"
      inputMode="decimal"
      min={setting.min}
      max={setting.max}
      step={setting.step}
      value={draft}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

function WordsEditor({ value, fallback, onChange, labelledBy, describedBy, inputId }) {
  const [draft, setDraft] = useState("");
  const defaults = new Set(fallback);
  const removed = fallback.filter((w) => !value.includes(w));
  const add = (text) => {
    const words = text.split(/[\s,]+/).map((w) => w.trim().toLowerCase()).filter(Boolean);
    if (words.length) onChange([...value, ...words.filter((w) => !value.includes(w))]);
    setDraft("");
  };
  return (
    <div className="tune-words">
      <ul className="tune-chips" aria-labelledby={labelledBy}>
        {value.map((w) => (
          <li key={w} className={defaults.has(w) ? "" : "is-added"}>
            <span>{w}</span>
            <button type="button" aria-label={`Remove ${w}`} onClick={() => onChange(value.filter((x) => x !== w))}>
              <X size={11} />
            </button>
          </li>
        ))}
        {!value.length && <li className="is-empty">No words: nothing is filtered out.</li>}
      </ul>
      <input
        id={inputId}
        className="tune-text"
        value={draft}
        placeholder="Add words, then Enter"
        aria-describedby={describedBy}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,\s]$/.test(v) && v.trim()) add(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
        onPaste={(e) => {
          e.preventDefault();
          add(`${draft} ${e.clipboardData.getData("text")}`);
        }}
      />
      {removed.length > 0 && (
        <p className="tune-removed">
          Removed from the default:{" "}
          {removed.map((w) => (
            <button type="button" key={w} onClick={() => onChange([...value, w])} aria-label={`Put back ${w}`}>
              {w}
            </button>
          ))}
        </p>
      )}
    </div>
  );
}

const pairsText = (value) =>
  Object.entries(value ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
function PairsEditor({ value, onChange, inputId, describedBy }) {
  const [draft, setDraft] = useState(() => pairsText(value));
  const bad = draft
    .split("\n")
    .map((l, i) => [l.trim(), i + 1])
    .filter(([l]) => l && !/^[^=\s]+\s*=\s*\S+$/.test(l));
  const commit = () => {
    const pairs = {};
    for (const line of draft.split("\n")) {
      const m = line.trim().match(/^([^=\s]+)\s*=\s*(\S+)$/);
      if (m) pairs[m[1]] = m[2];
    }
    onChange(pairs);
  };
  return (
    <>
      <textarea
        id={inputId}
        className="tune-text tune-pairs"
        rows={Math.min(8, Math.max(3, draft.split("\n").length + 1))}
        value={draft}
        spellCheck={false}
        aria-describedby={describedBy}
        aria-invalid={bad.length > 0 || undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
      {bad.length > 0 && (
        <p className="tune-error" role="alert">
          Line {bad.map(([, n]) => n).join(", ")}: write it as word=term. Those lines are skipped.
        </p>
      )}
    </>
  );
}

function Control({ setting, path, value, onTune, ids }) {
  const set = (v) => onTune(path, v);
  switch (setting.type) {
    case "int":
    case "number":
      return (
        <div className="tune-range">
          <input
            id={ids.input}
            type="range"
            min={setting.min}
            max={setting.max}
            step={setting.step}
            value={value}
            aria-describedby={ids.help}
            onChange={(e) => set(Number(e.target.value))}
          />
          <NumberBox
            key={String(value)}
            value={value}
            setting={setting}
            labelledBy={ids.label}
            describedBy={ids.help}
            onCommit={set}
          />
        </div>
      );
    case "bool":
      return (
        <button
          id={ids.input}
          type="button"
          role="switch"
          aria-checked={!!value}
          aria-describedby={ids.help}
          className="tune-switch"
          onClick={() => set(!value)}
        >
          <i aria-hidden="true" />
          <span>{value ? "On" : "Off"}</span>
        </button>
      );
    case "select":
      return (
        <select id={ids.input} className="tune-select" value={value} aria-describedby={ids.help} onChange={(e) => set(e.target.value)}>
          {setting.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "words":
      return (
        <WordsEditor
          value={value ?? []}
          fallback={setting.default ?? []}
          onChange={set}
          inputId={ids.input}
          labelledBy={ids.label}
          describedBy={ids.help}
        />
      );
    case "pairs":
      return <PairsEditor key={JSON.stringify(value)} value={value} onChange={set} inputId={ids.input} describedBy={ids.help} />;
    default:
      return null;
  }
}

function Field({ track, setting, value, onTune, stepNames, flash, refCb }) {
  const base = useId();
  const ids = { input: `${base}-in`, label: `${base}-label`, help: `${base}-help` };
  const path = `${track}.${setting.key}`;
  const isChanged = !same(value, setting.default);
  const reaches = (setting.steps ?? []).map((id) => stepNames.get(id)).filter(Boolean);
  return (
    <div ref={refCb} className={`tune-field ${isChanged ? "is-changed" : ""} ${flash ? "is-flash" : ""}`}>
      <div className="tune-field-head">
        <label id={ids.label} htmlFor={ids.input}>
          {setting.label}
        </label>
        {isChanged && (
          <>
            <span className="tune-mark">
              changed <span>· default {formatValue(setting, setting.default)}</span>
            </span>
            <button
              type="button"
              className="tune-reset-one"
              aria-label={`Reset ${setting.label} to its default`}
              title="Reset to default"
              onClick={() => onTune(path, setting.default)}
            >
              <RotateCcw size={13} />
            </button>
          </>
        )}
      </div>
      <Control setting={setting} path={path} value={value} onTune={onTune} ids={ids} />
      <p className="tune-help" id={ids.help}>
        {setting.help}
        {reaches.length > 0 && <span className="tune-reaches"> Changes: {reaches.join(" · ")}.</span>}
      </p>
    </div>
  );
}

function CodeView({ params, onSet }) {
  const [changesOnly, setChangesOnly] = useState(true);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const errorId = useId();
  const fresh = toCode(params, changesOnly);
  const text = draft ?? fresh;
  const apply = () => {
    const result = parseCode(text);
    if (!result.ok) return setError(result.error);
    setError(null);
    setDraft(null);
    onSet(result.params);
  };
  return (
    <div className="tune-code">
      <div className="tune-code-bar">
        <div className="g-level" role="group" aria-label="Which settings to show">
          <button type="button" aria-pressed={changesOnly} onClick={() => (setChangesOnly(true), setDraft(null), setError(null))}>
            Changes only
          </button>
          <button type="button" aria-pressed={!changesOnly} onClick={() => (setChangesOnly(false), setDraft(null), setError(null))}>
            All settings
          </button>
        </div>
      </div>
      <label className="sr-only" htmlFor={`${errorId}-code`}>
        Settings as JSON
      </label>
      <textarea
        id={`${errorId}-code`}
        className="tune-json"
        spellCheck={false}
        value={text}
        rows={Math.min(28, Math.max(6, text.split("\n").length + 1))}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            apply();
          }
        }}
      />
      {error && (
        <p className="tune-error" id={errorId} role="alert">
          {error}
        </p>
      )}
      <div className="tune-code-actions">
        <button type="button" className="primary" onClick={apply} disabled={draft === null}>
          Apply
        </button>
        {draft !== null && (
          <button type="button" className="secondary" onClick={() => (setDraft(null), setError(null))}>
            Discard edits
          </button>
        )}
      </div>
      <p className="tune-help">
        Plain JSON, read as data and never run. Settings you leave out go back to their defaults; values out of range are
        clamped. ⌘/Ctrl + Enter applies.
      </p>
    </div>
  );
}

function ChangesView({ mode, params, ctx, steps, onPick }) {
  const compare = useMemo(() => compareSteps(steps ?? [], ctx), [steps, ctx]);
  const mine = changed(mode, params[mode]);
  const settings = SETTINGS[mode].filter((s) => mine.includes(s.key));
  if (!ctx?.baseline || !settings.length)
    return (
      <p className="tune-empty">
        Everything on this track is at its default. Change a setting and this list shows each step whose result is
        different, default next to yours.
      </p>
    );
  return (
    <div className="tune-changes">
      <ul className="tune-yours">
        {settings.map((s) => (
          <li key={s.key}>
            <button type="button" onClick={() => onPick(`${mode}.${s.key}`)}>
              <b>{s.label}</b>
              <span>
                {formatValue(s, params[mode][s.key])} <small>(default {formatValue(s, s.default)})</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {compare.size ? (
        <ol className="tune-diff">
          {(steps ?? []).map((step, i) =>
            compare.has(step.id) ? (
              <li key={step.id}>
                <p>
                  <small>{String(i + 1).padStart(2, "0")}</small> {step.name}
                </p>
                <CompareLine compare={compare.get(step.id)} />
              </li>
            ) : null,
          )}
        </ol>
      ) : (
        <p className="tune-empty">
          For this request, no step's summary changed. Try a stronger value, or a different request.
        </p>
      )}
    </div>
  );
}

export default function TunePanel({ open, mode, params, focus, onTune, onSet, onReset, onClose, ctx, steps }) {
  const [tab, setTab] = useState("form");
  const [flash, setFlash] = useState(null);
  const panel = useRef(null);
  const fields = useRef(new Map());
  const headingId = useId();

  // Opening on a setting: scroll to it, focus its control and flash it.
  const [jump, setJump] = useState(null);
  useEffect(() => {
    if (!open) return;
    if (focus) setJump({ path: focus });
    else panel.current?.focus({ preventScroll: true });
  }, [open, focus]);
  useEffect(() => {
    if (!jump) return;
    setTab("form");
    let t = 0;
    const raf = requestAnimationFrame(() => {
      const el = fields.current.get(jump.path);
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      // The setting's own control, the one its label names.
      const id = el.querySelector("label")?.htmlFor;
      const control = (id && [...el.querySelectorAll("[id]")].find((x) => x.id === id)) || el.querySelector("input,select,textarea");
      control?.focus({ preventScroll: true });
      setFlash(jump.path);
      t = setTimeout(() => setFlash(null), 1800);
    });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [jump]);

  if (!open) return null;
  const track = SETTINGS[mode] ? mode : "planner";
  const count = changed(track, params[track]).length;
  const elsewhere = Object.keys(SETTINGS)
    .filter((t) => t !== track)
    .reduce((n, t) => n + changed(t, params[t]).length, 0);
  const stepNames = new Map((steps ?? []).map((s, i) => [s.id, `${i + 1} ${s.name}`]));
  const diffCount = ctx?.baseline ? compareSteps(steps ?? [], ctx).size : 0;

  return (
    <aside
      ref={panel}
      className="tune"
      aria-labelledby={headingId}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="tune-head">
        <div>
          <p className="g-kicker">Tune</p>
          <h2 id={headingId}>{TRACKS[track]}</h2>
        </div>
        <button type="button" className="tune-close" aria-label="Close the Tune panel" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="tune-tabs" role="tablist" aria-label="Tune views">
        {[
          ["form", "Settings", count],
          ["code", "Code", 0],
          ["changes", "What changed", diffCount],
        ].map(([id, label, n]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
            {n > 0 && <span className="tune-count">{n}</span>}
          </button>
        ))}
      </div>
      <div className="tune-body" role="tabpanel">
        {tab === "form" &&
          groupsFor(track).map(([name, list]) => (
            <section key={name} className="tune-group">
              <h3>{name}</h3>
              {list.map((s) => {
                const path = `${track}.${s.key}`;
                return (
                  <Field
                    key={path}
                    track={track}
                    setting={s}
                    value={params[track]?.[s.key] ?? s.default}
                    onTune={onTune}
                    stepNames={stepNames}
                    flash={flash === path}
                    refCb={(el) => (el ? fields.current.set(path, el) : fields.current.delete(path))}
                  />
                );
              })}
            </section>
          ))}
        {tab === "code" && <CodeView params={params} onSet={onSet} />}
        {tab === "changes" && <ChangesView mode={track} params={params} ctx={ctx} steps={steps} onPick={(path) => setJump({ path })} />}
      </div>
      <footer className="tune-foot">
        <button type="button" className="secondary" disabled={!count} onClick={() => onReset(track)}>
          <RotateCcw size={14} /> Reset this track
        </button>
        {isTuned(params) && (
          <button type="button" className="quiet" onClick={() => onReset()}>
            Reset all{elsewhere ? ` (${elsewhere} on other tracks)` : ""}
          </button>
        )}
      </footer>
    </aside>
  );
}
