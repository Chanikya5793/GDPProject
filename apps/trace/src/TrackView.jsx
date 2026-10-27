import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  CodeXml,
  Crosshair,
  Keyboard,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Table2,
} from "lucide-react";
import Map2D from "./map/Map2D.jsx";
import Map3D from "./map/Map3D.jsx";
import FlowView from "./map/FlowView.jsx";
import Badge from "./Badge.jsx";
import Timeline, { stagesOf } from "./Timeline.jsx";
import Welcome, { rememberWelcome, seenWelcome } from "./Welcome.jsx";
import { buildTrack, sceneAt } from "./map/track.js";
import { setPalette } from "./map/paint.js";
import { STEP_MODULES } from "./explain/steps/index.js";
import { show } from "./explain/kit.jsx";
import StepActions from "./StepActions.jsx";
import SourcePanel, { stripComment } from "./explain/SourcePanel.jsx";
import Glossed from "./teach/Glossed.jsx";
import { CompareLine, LessonBlock, TunedChip } from "./teach/Lesson.jsx";
import { compareSteps } from "./tune/compare.js";

const BASE_MS = 1250;
const INTRO = {
  planner:
    "Your sentence passes through a chain of small, classic algorithms. None of them is an AI model: each one does a single, checkable job, and the next one builds on its result.",
  copilot:
    "Your message went through real search code, a real prompt and a real model, and came back as an answer and maybe a proposed change. Steps marked real show your actual values; recomputed steps rerun the server's exact algorithm in your browser; the language-model steps are an illustration of how such models work, on your words.",
  transformer:
    "This is the core of a language model, run on your sentence: text becomes numbers, the numbers look at each other (attention), get processed, and turn into a guess for the next chunk of text. The weights here are untrained, so the guess is arithmetic, not meaning.",
};
const TITLES = {
  planner: "How the planner reads you",
  copilot: "From your message to this reply",
  transformer: "Inside a transformer block",
};
const SPEEDS = [0.5, 1, 2, 4];

// Screen space covered by panels; the map frames its content in the rest.
export const WIDE = 1100;
const TUNE_WIDTH = 380;
const RAIL = 52;
const DOCK = 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Which side panels are open and how wide, remembered per viewer.
const PANELS_KEY = "trace-panels";
// Widths are null until the viewer drags an edge: then they follow the window.
const PANEL_DEFAULTS = { guide: true, source: true, guideW: null, sourceW: null };
const autoGuide = (w) => Math.min(384, w * 0.28);
const autoSource = (w) => Math.min(440, w * 0.3);
function usePanels() {
  const [panels, setPanels] = useState(() => {
    try {
      return { ...PANEL_DEFAULTS, ...JSON.parse(localStorage.getItem(PANELS_KEY) || "{}") };
    } catch {
      return PANEL_DEFAULTS;
    }
  });
  const update = useCallback((patch) => {
    setPanels((cur) => {
      const next = { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) };
      try {
        localStorage.setItem(PANELS_KEY, JSON.stringify(next));
      } catch {
        /* the layout just won't persist */
      }
      return next;
    });
  }, []);
  return [panels, update];
}

function useViewport() {
  const [size, setSize] = useState(() => ({ w: innerWidth, h: innerHeight }));
  useEffect(() => {
    const on = () => setSize({ w: innerWidth, h: innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return size;
}

// Panel widths that leave the map at least a usable strip.
function layoutOf(size, panels, withSource, withTune) {
  const guideW = clamp(panels.guideW ?? autoGuide(size.w), 300, Math.min(560, size.w * 0.36));
  let sourceW = clamp(panels.sourceW ?? autoSource(size.w), 340, Math.min(640, size.w * 0.38));
  const guide = panels.guide;
  // The Tune panel takes the right edge while it is open.
  const source = withSource && panels.source && !withTune && size.w >= WIDE;
  const left = guide ? guideW + 24 : RAIL + 20;
  if (source) sourceW = Math.max(300, Math.min(sourceW, size.w - left - 420));
  if (size.w < 900)
    return {
      guideW,
      sourceW,
      source: false,
      insets: { left: 0, right: 0, top: 108, bottom: guide ? Math.round(size.h * 0.44) + 64 : 84 },
    };
  const right0 = source ? sourceW + 24 : 16;
  const right = withTune ? Math.max(right0, TUNE_WIDTH + 24) : right0;
  return { guideW, sourceW, source, insets: { left, right, top: 72, bottom: DOCK + 4, wide: size.w >= WIDE } };
}

// A paragraph that folds to two lines once playback starts, with a toggle.
function Intro({ text, folded }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const short = folded && !open;
  return (
    <div className={`g-intro ${short ? "is-folded" : ""}`}>
      <p className="g-summary">{text}</p>
      {folded && (
        <button className="g-more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
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

// The frame's sentence with the values that just changed marked.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function changedValues(vars, previous) {
  const out = new Set();
  for (const [name, v] of vars) {
    if (Array.isArray(v) || (v !== null && typeof v === "object")) continue;
    if (name in previous && show(previous[name]) === show(v)) continue;
    const text = typeof v === "string" ? v : typeof v === "number" ? show(v) : null;
    if (text && text.trim().length && text.length <= 32) out.add(text);
  }
  return [...out].sort((a, b) => b.length - a.length);
}
function Hero({ text, values, seen }) {
  if (typeof text !== "string" || !values.length) return <Glossed text={text} seen={seen} />;
  const re = new RegExp(`(?<![\\w.])(${values.map(escape).join("|")})(?![\\w])`, "g");
  const parts = text.split(re);
  if (parts.length === 1) return <Glossed text={text} seen={seen} />;
  return parts.map((p, i) =>
    i % 2 ? (
      <mark key={i} className="g-val">
        {p}
      </mark>
    ) : (
      <Glossed key={i} text={p} seen={seen} />
    ),
  );
}

// Where the frame is inside its step: one tick per frame for short steps.
function FrameProgress({ fi, count, phase }) {
  return (
    <div className="g-progress">
      <div className="g-progress-meta">
        {phase ? <b>{phase}</b> : <span />}
        <span>
          Frame {fi + 1} <small>of {count}</small>
        </span>
      </div>
      {count <= 28 ? (
        <ol className="g-ticks" aria-hidden="true">
          {Array.from({ length: count }, (_, i) => (
            <li key={i} className={i < fi ? "is-past" : i === fi ? "is-current" : ""} />
          ))}
        </ol>
      ) : (
        <div className="g-bar-fill" aria-hidden="true">
          <i style={{ width: `${((fi + 1) / count) * 100}%` }} />
        </div>
      )}
    </div>
  );
}

// A draggable, keyboard-adjustable edge for a side panel.
function Resizer({ side, width, min, max, onChange, label }) {
  const [drag, setDrag] = useState(null);
  const value = drag ?? width;
  const sign = side === "left" ? 1 : -1;
  return (
    <div
      className={`resizer is-${side} ${drag !== null ? "is-dragging" : ""}`}
      style={side === "left" ? { left: 12 + value - 5 } : { right: 12 + value - 5 }}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const x0 = e.clientX;
        const w0 = width;
        const move = (ev) => setDrag(clamp(w0 + sign * (ev.clientX - x0), min, max));
        const up = (ev) => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          onChange(clamp(w0 + sign * (ev.clientX - x0), min, max));
          setDrag(null);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      }}
      onDoubleClick={() => onChange(null)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 24;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const dir = e.key === "ArrowRight" ? 1 : -1;
          onChange(clamp(width + dir * sign * step, min, max));
        }
      }}
    >
      <i />
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
  onView = null,
  paused,
  theme = "dark",
  accent = null,
  params = null,
  onTune = null,
  tuneOpen = false,
  embed = false,
}) {
  // Canvas colours follow the page theme, except 3D, which always plays on a
  // dark stage so depth, light and glow read in both themes. Renderers are
  // rebuilt on change.
  const stageTheme = view === "3d" ? "dark" : theme;
  useMemo(() => setPalette(stageTheme, accent), [stageTheme, accent]);
  const track = useMemo(() => buildTrack(steps, STEP_MODULES, ctx), [steps, ctx]);
  const [g, setG] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [follow, setFollow] = useState(true);
  const [overviewing, setOverviewing] = useState(false);
  const [tab, setTab] = useState("algorithm");
  const [lessonTab, setLessonTab] = useState("what");
  const [help, setHelp] = useState(() => (seenWelcome() ? null : "first"));
  const [panels, setPanels] = usePanels();
  const size = useViewport();
  const [detail, setDetail] = useState(() => {
    try {
      return localStorage.getItem("trace-detail") === "detailed";
    } catch {
      return false;
    }
  });
  const flow = view === "flow";
  // Once playback has begun, the fixed intro text steps back and the text
  // that changes with each frame takes the focus.
  const [startedRun, setStartedRun] = useState(false);
  const withSource = detail && !flow;
  const layout = useMemo(() => layoutOf(size, panels, withSource, tuneOpen), [size, panels, withSource, tuneOpen]);
  const insets = layout.insets;
  const showSource = detail && !flow && layout.source;
  const canSource = detail && !flow && size.w >= WIDE;
  const guideOpen = panels.guide;
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
  const stages = useMemo(() => stagesOf(mode, track.columns), [mode, track.columns]);
  const stage = stages.find((s) => s.items.includes(scene.si));

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
  const halted = paused || !!help;
  useEffect(() => {
    if (!playing || halted) return;
    if (at >= last) return setPlaying(false);
    if (flow) {
      const nextSi = scene.si + 1;
      if (nextSi >= track.columns.length || (stopAt !== null && scene.si >= stopAt)) return setPlaying(false);
      const t = setTimeout(() => setG(track.columns[nextSi].start + track.columns[nextSi].count - 1), 3200 / speed);
      return () => clearTimeout(t);
    }
    const next = track.frames[at + 1];
    if (stopAt !== null && next.si > stopAt && scene.si === stopAt) return setPlaying(false);
    const t = setTimeout(
      () => {
        setFollow(true);
        setG(at + 1);
      },
      ((frame.hold ?? 1) * BASE_MS) / speed,
    );
    return () => clearTimeout(t);
  }, [playing, halted, at, last, speed, frame.hold, track, stopAt, scene.si, flow]);
  useEffect(() => {
    const hidden = () => document.hidden && setPlaying(false);
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);

  useEffect(() => {
    if (playing) setStartedRun(true);
  }, [playing]);
  const started = startedRun || at > 0;
  const play = useCallback(() => {
    if (playing) return setPlaying(false);
    if (at >= last) setG(0);
    setFollow(true);
    setOverviewing(false);
    setPlaying(true);
  }, [playing, at, last]);

  // Panels: G the guide, S the source, F both (focus mode, then back).
  const beforeFocus = useRef(null);
  const toggleGuide = useCallback(() => setPanels((p) => ({ guide: !p.guide })), [setPanels]);
  const toggleSource = useCallback(() => {
    if (!detail) {
      setDetailed(true);
      setPanels({ source: true });
    } else setPanels((p) => ({ source: !p.source }));
  }, [detail, setPanels]);
  const focusMode = !panels.guide && (!canSource || !panels.source);
  const toggleFocus = useCallback(() => {
    setPanels((p) => {
      if (p.guide || p.source) {
        beforeFocus.current = { guide: p.guide, source: p.source };
        return { guide: false, source: false };
      }
      return beforeFocus.current ?? { guide: true, source: true };
    });
  }, [setPanels]);
  const closeHelp = useCallback(() => {
    rememberWelcome();
    setHelp(null);
  }, []);

  useEffect(() => {
    function key(e) {
      if (paused || help || e.metaKey || e.ctrlKey || e.altKey) return;
      // Inside a shadow root the window sees the host; the path has the real target.
      const origin = e.composedPath?.()[0] ?? e.target;
      const target = origin instanceof Element ? origin : null;
      if (target?.closest('input,textarea,select,[contenteditable],.tune,dialog,[role="tab"],[role="separator"]'))
        return;
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
      } else if (k === "g" || k === "G") toggleGuide();
      else if (k === "s" || k === "S") toggleSource();
      else if (k === "f" || k === "F") toggleFocus();
      else if (k === "?") setHelp("keys");
      else if (onView && (k === "1" || k === "2" || k === "3")) onView(["flow", "2d", "3d"][+k - 1]);
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [paused, help, play, seek, toStep, at, scene.si, toggleGuide, toggleSource, toggleFocus, onView]);

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

  const compare = useMemo(() => compareSteps(steps, ctx), [steps, ctx]);
  const stepCompare = compare.get(step.id);
  // Each glossary term is linked once per guide render.
  const seen = new Set();
  const vars = Object.entries(frame.vars ?? {});
  const previous = track.frames[at - 1]?.si === scene.si ? (track.frames[at - 1].frame.vars ?? {}) : {};
  const lines = new Set([].concat(frame.line ?? []));
  const marks = changedValues(vars, previous);
  const Renderer = view === "3d" ? Map3D : Map2D;
  const num = (i) => String(i + 1).padStart(2, "0");
  const announce = flow
    ? `Step ${scene.si + 1}: ${step.algorithm}`
    : `Step ${scene.si + 1}, ${step.name}, frame ${scene.fi + 1}. ${typeof frame.say === "string" ? frame.say : ""}`;

  return (
    <div
      className={`track ${tuneOpen ? "has-tune" : ""} ${guideOpen ? "" : "no-guide"} ${showSource ? "has-source" : ""} view-${view}`}
      style={{
        ...(accent ? { "--accent": accent } : null),
        "--guide-w": `${layout.guideW}px`,
        "--source-w": `${layout.sourceW}px`,
        "--inset-l": `${insets.left}px`,
        "--inset-r": `${insets.right}px`,
      }}
    >
      <div className="track-map" data-background>
        <div className="view-fade" key={view}>
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
              detail={detail}
              reduced={reduced}
              compare={compare}
              params={params}
              onTune={onTune}
            />
          ) : (
            <Renderer
              key={`${stageTheme}-${accent}`}
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
          {!flow && (
            <div
              className="map-legend"
              style={{
                left: insets.left - 8,
                bottom: insets.bottom + 6,
                maxWidth: `calc(100vw - ${insets.left + insets.right}px)`,
              }}
              aria-label="How to read the map"
            >
              <span>
                <i className="is-source" /> read
              </span>
              <span>
                <i className="is-active" /> written now
              </span>
              <span>
                <i className="is-pending" /> not computed yet
              </span>
              <span className="map-legend-heat">
                <i className="is-neg" />
                <i className="is-pos" /> value
              </span>
              <span className="map-legend-hint">
                Hover a value to explain it · click to jump to where it was computed
              </span>
            </div>
          )}
        </div>
      </div>

      {canSource && module && (
        <SourcePanel
          module={module}
          frame={frame}
          previous={previous}
          reduced={reduced}
          collapsed={!showSource}
          onHide={toggleSource}
        />
      )}
      {showSource && size.w >= 900 && (
        <Resizer
          side="right"
          width={layout.sourceW}
          min={340}
          max={Math.min(640, size.w * 0.38)}
          onChange={(w) => setPanels({ sourceW: w })}
          label="Resize the source code panel"
        />
      )}
      {canSource && !showSource && (
        <button
          className="source-tab"
          onClick={toggleSource}
          aria-label="Show the source code (S)"
          title="Show the source code (S)"
        >
          <CodeXml size={16} />
          <span>Code</span>
        </button>
      )}

      {!guideOpen && (
        <nav className="guide-rail" data-background aria-label="Guide (hidden)">
          <button className="icon-btn" onClick={toggleGuide} aria-label="Show the guide (G)" title="Show the guide (G)">
            <PanelLeftOpen size={18} />
          </button>
          <span className="guide-rail-num" aria-hidden="true">
            {num(scene.si)}
          </span>
          <span className="guide-rail-name" aria-hidden="true">
            {flow ? step.algorithm : step.name}
          </span>
        </nav>
      )}
      <aside
        className={`guide ${guideOpen ? "" : "is-collapsed"}`}
        id="guide"
        tabIndex={-1}
        data-background
        aria-label="Step guide"
        aria-hidden={!guideOpen || undefined}
        inert={!guideOpen || undefined}
      >
        <div className="g-bar">
          <p className="g-kicker">
            <span>
              Step {num(scene.si)} <small>/ {String(steps.length).padStart(2, "0")}</small>
            </span>
            {stage && stage.name !== step.name && <em title={stage.name}>{stage.name}</em>}
          </p>
          <div className="g-level" role="group" aria-label="Explanation level">
            <button aria-pressed={!detail} onClick={() => setDetailed(false)}>
              Simple
            </button>
            <button aria-pressed={detail} onClick={() => setDetailed(true)}>
              Detailed
            </button>
          </div>
          <button className="icon-btn" onClick={toggleGuide} aria-label="Hide the guide (G)" title="Hide the guide (G)">
            <PanelLeftClose size={17} />
          </button>
        </div>
        <p className="sr-only" aria-live="polite">
          {started ? announce : ""}
        </p>

        {flow ? (
          <div className="g-scroll">
            <header className="g-head">
              <h1>{TITLES[mode]}</h1>
              <Intro text={INTRO[mode]} folded={started} />
            </header>
            {started ? (
              <section className="g-hero is-flow" key={`hero-${step.id}`}>
                <p className="g-hero-label">
                  <span className="g-now-pill">Now</span> {step.algorithm}
                  {step.badge && <Badge kind={step.badge} />}
                </p>
                <p className="g-hero-text">
                  <Glossed text={step.plain ?? step.summary} seen={seen} />
                </p>
                {step.tuned && (
                  <p className="g-badges">
                    <TunedChip step={step} mode={mode} onTune={onTune} />
                  </p>
                )}
              </section>
            ) : (
              <div className="g-start">
                <button className="primary" onClick={play}>
                  <Play size={15} fill="currentColor" /> Play the stages
                </button>
                <p>Or click any stage to read it, and open it on the map to watch every calculation.</p>
              </div>
            )}
            {stepCompare && started && (
              <section className="g-compare" aria-label="Default settings compared with yours">
                <h3>Your settings changed this step</h3>
                <CompareLine compare={stepCompare} />
              </section>
            )}
            <StepActions
              {...actionProps}
              stepId={step.id}
              actions={{ ...actionProps.actions, goTo: (id) => toStep(steps.findIndex((s) => s.id === id)) }}
            />
            {started && (
              <LessonBlock
                key={step.id}
                stepId={step.id}
                mode={mode}
                ctx={ctx}
                detail={detail}
                params={params}
                onTune={onTune}
                seen={seen}
                tab={lessonTab}
                onTab={setLessonTab}
              />
            )}
          </div>
        ) : (
          <div className="g-scroll" key={step.id}>
            <header className="g-head">
              <h1>{step.name}</h1>
              <div className="g-badges">
                <span className="g-algo">{step.algorithm}</span>
                {step.badge && <Badge kind={step.badge} />}
                <TunedChip step={step} mode={mode} onTune={onTune} />
              </div>
            </header>
            <section className={`g-hero ${started ? "is-live" : ""}`}>
              <FrameProgress fi={scene.fi} count={col.count} phase={frame.phase} />
              <p className="g-say" key={at}>
                <Hero text={frame.say} values={marks} seen={seen} />
              </p>
              {detail && <MathLines lines={module?.math?.(frame, ctx)} />}
            </section>
            <Intro text={detail ? step.summary : step.plain} folded={started} />
            {detail && <code className="g-formula">{step.formula}</code>}
            {stepCompare && (
              <section className="g-compare" aria-label="Default settings compared with yours">
                <h3>Your settings changed this step</h3>
                <CompareLine compare={stepCompare} />
              </section>
            )}
            <StepActions
              {...actionProps}
              stepId={step.id}
              actions={{ ...actionProps.actions, goTo: (id) => toStep(steps.findIndex((s) => s.id === id)) }}
            />
            <LessonBlock
              stepId={step.id}
              mode={mode}
              ctx={ctx}
              detail={detail}
              params={params}
              onTune={onTune}
              seen={seen}
              tab={lessonTab}
              onTab={setLessonTab}
            />
            {module && detail && !showSource && (
              <section className="g-tabs">
                <div className="g-tabs-bar">
                  <div className="g-level" role="group" aria-label="Details">
                    <button aria-pressed={tab === "algorithm"} onClick={() => setTab("algorithm")}>
                      Algorithm
                    </button>
                    <button aria-pressed={tab === "variables"} onClick={() => setTab("variables")}>
                      Variables
                    </button>
                  </div>
                  <button onClick={() => onOpenTable(module, scene.fi)} className="g-link">
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
                        <div
                          key={name}
                          className={name in previous && show(previous[name]) !== show(value) ? "is-changed" : ""}
                        >
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
            {showSource && module && (
              <button className="g-link" onClick={() => onOpenTable(module, scene.fi)}>
                <Table2 size={14} /> Open this step as tables
              </button>
            )}
            {detail && step.limit && <p className="g-limit">{step.limit}</p>}
          </div>
        )}
      </aside>
      {guideOpen && size.w >= 900 && (
        <Resizer
          side="left"
          width={layout.guideW}
          min={300}
          max={Math.min(560, size.w * 0.36)}
          onChange={(w) => setPanels({ guideW: w })}
          label="Resize the guide"
        />
      )}

      <div className="dock" data-background>
        <div className="dock-buttons">
          <button
            aria-label="Previous step"
            title="Previous step (Shift ←)"
            onClick={() => toStep(scene.si - 1)}
            disabled={scene.si === 0}
          >
            <ChevronsLeft size={18} />
          </button>
          <button
            aria-label="Previous frame"
            title="Previous frame (←)"
            onClick={() => seek(at - 1)}
            disabled={at === 0}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            className="dock-play"
            onClick={play}
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause (Space)" : "Play (Space)"}
          >
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button aria-label="Next frame" title="Next frame (→)" onClick={() => seek(at + 1)} disabled={at >= last}>
            <ChevronRight size={18} />
          </button>
          <button
            aria-label="Next step"
            title="Next step (Shift →)"
            onClick={() => toStep(scene.si + 1)}
            disabled={scene.si === track.columns.length - 1}
          >
            <ChevronsRight size={18} />
          </button>
        </div>
        <div className="dock-now" aria-hidden="true">
          <small>
            {num(scene.si)} ·{" "}
            {flow ? `stage ${stages.indexOf(stage) + 1} of ${stages.length}` : `frame ${scene.fi + 1}/${col.count}`}
          </small>
          <b>{flow ? step.algorithm : step.name}</b>
        </div>
        <Timeline mode={mode} columns={track.columns} si={scene.si} fi={scene.fi} onSeek={seek} />
        <div className="dock-tools">
          <label className="dock-speed" title="Playback speed">
            <span className="sr-only">Speed</span>
            <select value={speed} onChange={(e) => setSpeed(+e.target.value)}>
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
          {!flow && (
            <>
              <button
                aria-pressed={overviewing}
                aria-label="Overview of the whole map"
                onClick={() => {
                  setOverviewing((v) => !v);
                  setFollow(true);
                }}
                title="Overview (O)"
              >
                <MapIcon size={16} />
              </button>
              <button
                aria-label="Follow the current frame"
                onClick={() => {
                  setOverviewing(false);
                  setFollow(true);
                }}
                disabled={follow && !overviewing}
                title="Follow the current frame (C)"
              >
                <Crosshair size={16} />
              </button>
            </>
          )}
          <button
            aria-pressed={focusMode}
            aria-label={focusMode ? "Leave focus mode" : "Focus mode: hide the panels"}
            title={focusMode ? "Show the panels (F)" : "Focus: hide the panels (F)"}
            onClick={toggleFocus}
          >
            {focusMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button aria-label="Keyboard shortcuts and help" title="Help (?)" onClick={() => setHelp("keys")}>
            <Keyboard size={16} />
          </button>
        </div>
      </div>

      <Welcome open={!!help} first={help === "first"} embed={embed} onClose={closeHelp} />
    </div>
  );
}
