import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { show } from "./kit.jsx";
import { sourceOf } from "./source.js";

const BASE_MS = 1300;
export const SPEEDS = [0.5, 1, 2, 4];

function CodePanel({ module, lines }) {
  const [tab, setTab] = useState("pseudo");
  const active = new Set([].concat(lines ?? []));
  const sources = useMemo(
    () => module.source.map(([file, name]) => sourceOf(file, name)).filter(Boolean),
    [module],
  );
  return (
    <section className="x-code">
      <header>
        <div className="x-tabs" role="tablist" aria-label="Code view">
          <button
            role="tab"
            aria-selected={tab === "pseudo"}
            onClick={() => setTab("pseudo")}
          >
            Algorithm
          </button>
          <button
            role="tab"
            aria-selected={tab === "source"}
            onClick={() => setTab("source")}
          >
            Real source
          </button>
        </div>
      </header>
      {tab === "pseudo" ? (
        <ol className="x-lines">
          {module.code.map((line, i) => (
            <li key={i} className={active.has(i) ? "is-active" : ""}>
              <span>{i + 1}</span>
              <code>{line || " "}</code>
            </li>
          ))}
        </ol>
      ) : (
        <div className="x-source">
          {sources.map((s) => (
            <div key={`${s.file}:${s.line}`}>
              <small>
                {s.file}:{s.line}
              </small>
              <pre tabIndex={0}>{s.code}</pre>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Variables({ vars = {}, previous = {} }) {
  const entries = Object.entries(vars);
  if (!entries.length) return null;
  return (
    <section className="x-vars" aria-label="Variables at this frame">
      <h4>Variables</h4>
      <dl>
        {entries.map(([name, value]) => {
          const text = show(value);
          const changed = name in previous && show(previous[name]) !== text;
          return (
            <div key={name} className={changed ? "is-changed" : ""}>
              <dt>{name}</dt>
              <dd>{text}</dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

export default function StepPlayer({
  module,
  ctx,
  playing,
  setPlaying,
  speed,
  setSpeed,
  onEnd,
  start = "end",
  compact = false,
}) {
  const frames = useMemo(() => module.frames(ctx), [module, ctx]);
  const last = Math.max(0, frames.length - 1);
  const [at, setAt] = useState(() =>
    typeof start === "number" ? Math.min(start, last) : start === "end" ? last : 0,
  );
  const index = Math.min(at, last);
  const frame = frames[index] || { say: "", vars: {} };
  const ended = useRef(false);

  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      if (ended.current) return;
      const t = setTimeout(() => {
        ended.current = true;
        onEnd?.();
      }, (BASE_MS * 1.4) / speed);
      return () => clearTimeout(t);
    }
    const t = setTimeout(
      () => setAt((v) => Math.min(last, v + 1)),
      ((frame.hold ?? 1) * BASE_MS) / speed,
    );
    return () => clearTimeout(t);
  }, [playing, index, last, speed, frame.hold, onEnd]);

  useEffect(() => {
    ended.current = false;
  }, [index]);

  const seek = (i) => {
    setPlaying(false);
    setAt(Math.max(0, Math.min(last, i)));
  };
  const play = () => {
    if (playing) return setPlaying(false);
    if (index >= last) setAt(0);
    setPlaying(true);
  };
  useEffect(() => {
    if (compact) return;
    function key(e) {
      if (e.target.closest("input,textarea,select,[contenteditable]") || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)
        return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(index + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(index - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        seek(0);
      } else if (e.key === "End") {
        e.preventDefault();
        seek(last);
      } else if (e.key === " " && !e.target.closest("button,a")) {
        e.preventDefault();
        play();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const phases = [];
  frames.forEach((f, i) => {
    if (!phases.length || phases.at(-1).name !== f.phase)
      phases.push({ name: f.phase, from: i });
  });
  const Stage = module.Stage;
  return (
    <div className={`x-player ${compact ? "is-compact" : ""}`}>
      <div className="x-main">
        <p className="x-say" aria-live="polite">
          <span>
            Frame {index + 1} of {frames.length}
            {frame.phase ? ` · ${frame.phase}` : ""}
          </span>
          {frame.say}
        </p>
        <div className="x-stage">
          <Stage ctx={ctx} frame={frame} frames={frames} at={index} seek={seek} />
        </div>
      </div>
      <aside className="x-side">
        <CodePanel module={module} lines={frame.line} />
        <Variables vars={frame.vars} previous={frames[index - 1]?.vars} />
      </aside>
      <div className="x-transport">
        <div className="x-buttons">
          <button aria-label="First frame" onClick={() => seek(0)} disabled={index === 0}>
            <SkipBack size={16} />
          </button>
          <button aria-label="Previous frame" onClick={() => seek(index - 1)} disabled={index === 0}>
            <ChevronLeft size={18} />
          </button>
          <button
            className="x-play"
            aria-label={playing ? "Pause" : "Run"}
            onClick={play}
          >
            {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
            <span>{playing ? "Pause" : index >= last ? "Run again" : "Run"}</span>
          </button>
          <button aria-label="Next frame" onClick={() => seek(index + 1)} disabled={index >= last}>
            <ChevronRight size={18} />
          </button>
          <button aria-label="Last frame" onClick={() => seek(last)} disabled={index >= last}>
            <SkipForward size={16} />
          </button>
        </div>
        <label className="x-scrub">
          <span className="sr-only">Frame</span>
          <input
            type="range"
            min={0}
            max={last}
            value={index}
            onChange={(e) => seek(+e.target.value)}
            style={{ "--p": `${last ? (index / last) * 100 : 100}%` }}
          />
        </label>
        <label className="x-speed">
          <span className="sr-only">Speed</span>
          <select value={speed} onChange={(e) => setSpeed(+e.target.value)}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        {phases.length > 1 && (
          <div className="x-phases" aria-label="Phases">
            {phases.map((p, i) => {
              const end = phases[i + 1]?.from ?? frames.length;
              return (
                <button
                  key={p.from}
                  className={index >= p.from && index < end ? "is-active" : index >= end ? "is-past" : ""}
                  onClick={() => seek(p.from)}
                >
                  {p.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
