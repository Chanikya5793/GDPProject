import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Crosshair,
  Map as MapIcon,
  Pause,
  Play,
  Table2,
} from "lucide-react";
import Map2D from "./map/Map2D.jsx";
import Map3D from "./map/Map3D.jsx";
import FlowView from "./map/FlowView.jsx";
import Badge from "./Badge.jsx";
import { buildTrack, sceneAt } from "./map/track.js";
import { STEP_MODULES } from "./explain/steps/index.js";
import { show } from "./explain/kit.jsx";
import StepActions from "./StepActions.jsx";
import SourcePanel, { stripComment } from "./explain/SourcePanel.jsx";

const BASE_MS = 1250;
const INTRO = {
  planner:
    "Your sentence passes through a chain of small, classic algorithms. None of them is an AI model: each one does a single, checkable job, and the next one builds on its result.",
  copilot:
    "Your message went through real search code, a real prompt and a real model, and came back as an answer and maybe a proposed change. Steps marked real show your actual values; recomputed steps rerun the server's exact algorithm in your browser; the language-model steps are an illustration of how such models work, on your words.",
  transformer:
    "This is the core of a language model, run on your sentence: text becomes numbers, the numbers look at each other (attention), get processed, and turn into a guess for the next chunk of text. The weights here are untrained, so the guess is arithmetic, not meaning.",
};
const SPEEDS = [0.5, 1, 2, 4];

// Screen space covered by panels; the map frames its content in the rest.
export const WIDE = 1100;
const guideWidth = (w) => Math.min(400, w * 0.3);
const sourceWidth = (w) => Math.min(460, w * 0.32);
function useInsets(withSource) {
  const [size, setSize] = useState(() => ({ w: innerWidth, h: innerHeight }));
  useEffect(() => {
    const on = () => setSize({ w: innerWidth, h: innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return useMemo(() => {
    if (size.w < 900) return { left: 0, right: 0, top: 108, bottom: Math.round(size.h * 0.44) + 64 };
    const right = withSource && size.w >= WIDE ? sourceWidth(size.w) + 24 : 16;
    return { left: guideWidth(size.w) + 24, right, top: 72, bottom: 96, wide: size.w >= WIDE };
  }, [size, withSource]);
}

function MathLines({ lines }) {
  if (!lines?.length) return null;
  return (
    <div className="g-math">
      {lines.map((l, i) => (
        <div key={i}>
          <span>{l.label}</span>
          <code>
            {l.terms.join(` ${l.op ?? "+"} `)}
            {l.result !== undefined && (
              <>
                {" "}
                = <b>{l.result}</b>
              </>
            )}
          </code>
        </div>
      ))}
    </div>
  );
}

export default function TrackView({
  mode,
  steps,
  ctx,
  view,
  runId,
  reduced,
  stopAt,
  actionProps,
  onOpenTable,
  on3DFail,
  onOpenMap,
  paused,
}) {
  const track = useMemo(() => buildTrack(steps, STEP_MODULES, ctx), [steps, ctx]);
  const [g, setG] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [follow, setFollow] = useState(true);
  const [overviewing, setOverviewing] = useState(false);
  const [tab, setTab] = useState("algorithm");
  const [detail, setDetail] = useState(() => {
    try {
      return localStorage.getItem("trace-detail") === "detailed";
    } catch {
      return false;
    }
  });
  const flow = view === "flow";
  const insets = useInsets(detail && !flow);
  const showSource = detail && !flow && insets.wide;
  const setDetailed = (on) => {
    setDetail(on);
    try {
      localStorage.setItem("trace-detail", on ? "detailed" : "simple");
    } catch {
      /* the choice just won't persist */
    }
  };
  const last = track.frames.length - 1;
  const at = Math.max(0, Math.min(g, last));
  const scene = useMemo(() => sceneAt(track, at), [track, at]);
  const col = scene.column;
  const step = col.step;
  const module = col.module;
  const frame = scene.frame ?? { say: "", vars: {} };

  // A new request starts from the first frame; other rebuilds keep the step.
  const lastRun = useRef(runId);
  const lastTrack = useRef(track);
  useEffect(() => {
    if (lastRun.current !== runId) {
      lastRun.current = runId;
      setG(0);
      setFollow(true);
      setOverviewing(false);
      setPlaying(!reduced);
    } else if (lastTrack.current !== track) {
      const old = lastTrack.current.frames[g];
      if (old) {
        const column = track.columns[old.si];
        setG(column.start + Math.min(old.fi, column.count - 1));
      }
    }
    lastTrack.current = track;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, runId]);
  useEffect(() => {
    setG(0);
    setPlaying(false);
    setFollow(true);
  }, [mode]);

  const seek = useCallback(
    (next, keepPlaying = false) => {
      if (!keepPlaying) setPlaying(false);
      setOverviewing(false);
      setFollow(true);
      setG(Math.max(0, Math.min(last, next)));
    },
    [last],
  );
  const toStep = useCallback(
    (si) => seek(track.columns[Math.max(0, Math.min(track.columns.length - 1, si))].start),
    [seek, track],
  );

  // Playback: one frame per tick; stops at the end and before an open question.
  useEffect(() => {
    if (!playing || paused) return;
    if (at >= last) return setPlaying(false);
    if (flow) {
      const nextSi = scene.si + 1;
      if (nextSi >= track.columns.length || (stopAt !== null && scene.si >= stopAt)) return setPlaying(false);
      const t = setTimeout(() => setG(track.columns[nextSi].start + track.columns[nextSi].count - 1), 3200 / speed);
      return () => clearTimeout(t);
    }
    const next = track.frames[at + 1];
    if (stopAt !== null && next.si > stopAt && scene.si === stopAt) return setPlaying(false);
    const t = setTimeout(() => {
      setFollow(true);
      setG(at + 1);
    }, ((frame.hold ?? 1) * BASE_MS) / speed);
    return () => clearTimeout(t);
  }, [playing, paused, at, last, speed, frame.hold, track, stopAt, scene.si, flow]);
  useEffect(() => {
    const hidden = () => document.hidden && setPlaying(false);
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);

  const play = useCallback(() => {
    if (playing) return setPlaying(false);
    if (at >= last) setG(0);
    setFollow(true);
    setOverviewing(false);
    setPlaying(true);
  }, [playing, at, last]);

  useEffect(() => {
    function key(e) {
      if (paused || e.metaKey || e.ctrlKey || e.altKey) return;
      // Inside a shadow root the window sees the host; the path has the real target.
      const origin = e.composedPath?.()[0] ?? e.target;
      const target = origin instanceof Element ? origin : null;
      if (target?.closest("input,textarea,select,[contenteditable]")) return;
      const k = e.key;
      if (k === " " && !target?.closest("button,a")) {
        e.preventDefault();
        play();
      } else if (k === "ArrowRight" || k === "ArrowLeft") {
        e.preventDefault();
        const dir = k === "ArrowRight" ? 1 : -1;
        if (e.shiftKey) toStep(scene.si + dir);
        else seek(at + dir);
      } else if (k === "o" || k === "O") {
        setOverviewing((v) => !v);
        setFollow(true);
      } else if (k === "c" || k === "C") {
        setOverviewing(false);
        setFollow(true);
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [paused, play, seek, toStep, at, scene.si]);

  // Clicking a value jumps to the frame that computed it.
  const onCell = useCallback(
    (blockId, r, c) => {
      const block = track.byId.get(blockId);
      if (!block) return;
      const column = track.columns[block.step];
      for (let i = column.start; i < column.start + column.count; i++) {
        const s = column.module?.state?.(track.frames[i].frame, track.ctx)?.[blockId];
        if (s?.active?.some(([ar, ac]) => ar === r && ac === c)) return seek(i);
      }
      seek(column.start + column.count - 1);
    },
    [track, seek],
  );
  const userMove = useCallback(() => {
    setFollow(false);
    setOverviewing(false);
  }, []);

  const vars = Object.entries(frame.vars ?? {});
  const previous = track.frames[at - 1]?.si === scene.si ? track.frames[at - 1].frame.vars ?? {} : {};
  const lines = new Set([].concat(frame.line ?? []));
  const Renderer = view === "3d" ? Map3D : Map2D;
  return (
    <div className="track" style={{ "--accent": step.color }}>
      <div className="track-map" data-background>
        {flow ? (
          <FlowView
            mode={mode}
            track={track}
            si={scene.si}
            ctx={ctx}
            onPick={(i) => seek(track.columns[i].start + track.columns[i].count - 1)}
            onOpen={(i) => {
              seek(track.columns[i].start);
              onOpenMap();
            }}
          />
        ) : (
        <Renderer
          track={track}
          scene={scene}
          insets={insets}
          follow={follow}
          overviewing={overviewing}
          onUserMove={userMove}
          onCell={onCell}
          onFail={on3DFail}
          reduced={reduced}
        />
        )}
      </div>

      {showSource && module && (
        <SourcePanel module={module} frame={frame} previous={previous} reduced={reduced} />
      )}

      <aside className="guide" id="guide" tabIndex={-1} data-background aria-label="Step guide">
        <div className="g-head">
          <div className="g-top">
            <p className="g-kicker">
              Step {scene.si + 1} of {steps.length}
            </p>
            <div className="g-level" role="group" aria-label="Explanation level">
              <button aria-pressed={!detail} onClick={() => setDetailed(false)}>
                Simple
              </button>
              <button aria-pressed={detail} onClick={() => setDetailed(true)}>
                Detailed
              </button>
            </div>
          </div>
          {flow ? (
            <>
              <h1>
                {mode === "planner"
                  ? "How the planner reads you"
                  : mode === "copilot"
                    ? "From your message to this reply"
                    : "Inside a transformer block"}
              </h1>
              <p className="g-summary">{INTRO[mode]}</p>
              <p className="g-at">
                Now at <b>{step.algorithm}</b>. Press play to move stage by stage, or open any stage
                to watch every calculation.
              </p>
            </>
          ) : (
            <>
              <h1>{step.name}</h1>
              <p className="g-algo">
                {step.algorithm}
                {step.badge && <Badge kind={step.badge} />}
              </p>
              <p className="g-summary">{detail ? step.summary : step.plain}</p>
              {detail && <code className="g-formula">{step.formula}</code>}
            </>
          )}
        </div>
        {!flow && (
          <section className="g-now" aria-live="polite">
            <p className="g-frame">
              {frame.phase && <b>{frame.phase}</b>}
              <span>
                {scene.fi + 1} / {col.count}
              </span>
            </p>
            <p className="g-say" key={at}>
              {frame.say}
            </p>
            {detail && <MathLines lines={module?.math?.(frame, ctx)} />}
            {showSource && module && (
              <button className="g-tables-link" onClick={() => onOpenTable(module, scene.fi)}>
                <Table2 size={14} /> Open this step as tables
              </button>
            )}
          </section>
        )}
        <StepActions
          {...actionProps}
          stepId={step.id}
          actions={{ ...actionProps.actions, goTo: (id) => toStep(steps.findIndex((s) => s.id === id)) }}
        />
        {module && detail && !flow && !showSource && (
          <section className="g-tabs">
            <div role="tablist" aria-label="Details">
              <button role="tab" aria-selected={tab === "algorithm"} onClick={() => setTab("algorithm")}>
                Algorithm
              </button>
              <button role="tab" aria-selected={tab === "variables"} onClick={() => setTab("variables")}>
                Variables
              </button>
              <button onClick={() => onOpenTable(module, scene.fi)} className="g-tables">
                <Table2 size={14} /> Tables
              </button>
            </div>
            {tab === "algorithm" ? (
              <ol className="g-code">
                {module.code.map((line, i) => (
                  <li key={i} className={lines.has(i) ? "is-active" : ""}>
                    <span>{i + 1}</span>
                    <code>{stripComment(line) || " "}</code>
                  </li>
                ))}
              </ol>
            ) : (
              <dl className="g-vars">
                {vars.length ? (
                  vars.map(([name, value]) => (
                    <div key={name} className={name in previous && show(previous[name]) !== show(value) ? "is-changed" : ""}>
                      <dt>{name}</dt>
                      <dd>{show(value)}</dd>
                    </div>
                  ))
                ) : (
                  <p>No variables at this frame.</p>
                )}
              </dl>
            )}
          </section>
        )}
        {!flow && (
        <div className="g-legend" aria-label="How to read the map">
          <span>
            <i className="is-source" /> read
          </span>
          <span>
            <i className="is-active" /> written now
          </span>
          <span>
            <i className="is-pending" /> not computed yet
          </span>
          <span>Click any value to see how it was computed.</span>
        </div>
        )}
        {detail && <p className="g-limit">{step.limit}</p>}
      </aside>

      <div className="dock" data-background>
        <div className="dock-buttons">
          <button aria-label="Previous step" onClick={() => toStep(scene.si - 1)} disabled={scene.si === 0}>
            <ChevronsLeft size={18} />
          </button>
          <button aria-label="Previous frame" onClick={() => seek(at - 1)} disabled={at === 0}>
            <ChevronLeft size={18} />
          </button>
          <button className="dock-play" onClick={play} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button aria-label="Next frame" onClick={() => seek(at + 1)} disabled={at >= last}>
            <ChevronRight size={18} />
          </button>
          <button
            aria-label="Next step"
            onClick={() => toStep(scene.si + 1)}
            disabled={scene.si === track.columns.length - 1}
          >
            <ChevronsRight size={18} />
          </button>
        </div>
        <div className="dock-steps" role="group" aria-label="Steps">
          {track.columns.map((c, i) => {
            const progress = i < scene.si ? 1 : i > scene.si ? 0 : (scene.fi + 1) / c.count;
            return (
              <button
                key={c.step.id}
                className={i === scene.si ? "is-current" : i < scene.si ? "is-past" : ""}
                style={{ flexGrow: Math.max(3, Math.sqrt(c.count) * 2), "--c": c.step.color, "--p": progress }}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const f = Math.floor(((e.clientX - r.left) / r.width) * c.count);
                  seek(c.start + Math.max(0, Math.min(c.count - 1, f)));
                }}
                title={`${i + 1}. ${c.step.name}`}
                aria-label={`Step ${i + 1}: ${c.step.name}`}
                aria-current={i === scene.si ? "step" : undefined}
              >
                <i />
                <span>{c.step.name}</span>
              </button>
            );
          })}
        </div>
        <div className="dock-tools">
          <label className="dock-speed">
            <span className="sr-only">Speed</span>
            <select value={speed} onChange={(e) => setSpeed(+e.target.value)}>
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
          <button
            aria-pressed={overviewing}
            onClick={() => {
              setOverviewing((v) => !v);
              setFollow(true);
            }}
            title="Overview (O)"
          >
            <MapIcon size={16} />
          </button>
          <button
            onClick={() => {
              setOverviewing(false);
              setFollow(true);
            }}
            disabled={follow && !overviewing}
            title="Follow the current frame (C)"
          >
            <Crosshair size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
