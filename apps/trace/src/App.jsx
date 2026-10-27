import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Brain,
  CalendarClock,
  Database,
  MessagesSquare,
  Moon,
  PenLine,
  SlidersHorizontal,
  Square,
  Sun,
  Waypoints,
  Workflow,
  X,
} from "lucide-react";
import TrackView from "./TrackView.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import StepPlayer from "./explain/StepPlayer.jsx";
import { DataPanel, RequestPanel } from "./Panels.jsx";
import { analyze, applyProposal, SCENARIOS, SEED_RECORDS } from "./engine/pipeline.js";
import { copilotSteps, stepsFor } from "./steps.js";
import { SAMPLE_MESSAGE, SAMPLE_RESPONSE } from "./engine/copilotSample.js";
import { useParams } from "./tune/useParams.js";
import { changed } from "./tune/schema.js";
import { buildCtx } from "./tune/context.js";
import TunePanel from "./tune/TunePanel.jsx";

const seeds = () => SEED_RECORDS.map((r) => ({ ...r }));
function useReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [value, setValue] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const list = matchMedia(query);
    const change = () => setValue(list.matches);
    list.addEventListener("change", change);
    return () => list.removeEventListener("change", change);
  }, []);
  return value;
}
function useDialog(open, onClose) {
  useEffect(() => {
    if (!open) return;
    const saved = document.activeElement;
    const background = [...document.querySelectorAll("[data-background]")];
    background.forEach((e) => (e.inert = true));
    const dialog = document.querySelector(".drawer");
    dialog?.querySelector("button")?.focus();
    function key(e) {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab") return;
      const controls = [
        ...dialog.querySelectorAll('button:not(:disabled),input,select,textarea,a[href],[tabindex="0"]'),
      ];
      if (e.shiftKey && document.activeElement === controls[0]) {
        e.preventDefault();
        controls.at(-1)?.focus();
      } else if (!e.shiftKey && document.activeElement === controls.at(-1)) {
        e.preventDefault();
        controls[0]?.focus();
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      background.forEach((e) => (e.inert = false));
      document.removeEventListener("keydown", key);
      saved?.focus?.();
    };
  }, [open, onClose]);
}
const HAS_WEBGL = (() => {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
})();

// Light or dark: the system's choice until the visitor picks one.
function useTheme() {
  const query = "(prefers-color-scheme: light)";
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("trace-theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {
      /* fall back to the system */
    }
    return matchMedia(query).matches ? "light" : "dark";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () =>
    setTheme((t) => {
      const next = t === "light" ? "dark" : "light";
      try {
        localStorage.setItem("trace-theme", next);
      } catch {
        /* the choice just won't persist */
      }
      return next;
    });
  return [theme, toggle];
}

export default function App() {
  const reduced = useReducedMotion();
  const [theme, toggleTheme] = useTheme();
  const [mode, setMode] = useState("planner");
  const [view, setView] = useState("flow");
  const [records, setRecords] = useState(seeds);
  const [input, setInput] = useState(SCENARIOS[0].prompt);
  const [scenario, setScenario] = useState(SCENARIOS[0].id);
  // The request as last run: its text, the records it ran against and the
  // record the visitor picked. The trace is recomputed from it whenever the
  // settings change.
  const [request, setRequest] = useState(() => ({ text: SCENARIOS[0].prompt, records: seeds(), selectedId: null }));
  const { params, tune, reset: resetParams, set: setParams } = useParams();
  const [tuneOpen, setTuneOpen] = useState(false);
  const [tuneFocus, setTuneFocus] = useState(null);
  const [applied, setApplied] = useState(false);
  const [notice, setNotice] = useState("");
  const [generatedTokens, setGeneratedTokens] = useState([]);
  const [drawer, setDrawer] = useState(null);
  const [table, setTable] = useState(null);
  const [runId, setRunId] = useState(0);
  // Earlier turns when the visitor answers a question instead of rewriting.
  const [thread, setThread] = useState([]);

  const trace = useMemo(
    () => analyze(request.text, request.records, request.selectedId, params.planner),
    [request, params.planner],
  );
  const steps =
    mode === "copilot"
      ? copilotSteps({ response: trace.original === SAMPLE_MESSAGE ? SAMPLE_RESPONSE : null }, params)
      : stepsFor(mode, params);
  const ctx = useMemo(
    () =>
      buildCtx({
        trace,
        rerun: (planner) => analyze(request.text, request.records, request.selectedId, planner),
        records,
        applied,
        generatedTokens,
        params,
      }),
    [trace, request, records, applied, generatedTokens, params],
  );
  // Playback halts after Decide while the request still needs an answer.
  const stopAt =
    mode === "planner" && trace.decision.status === "clarify"
      ? steps.findIndex((s) => s.id === "decide")
      : null;
  const closeDrawer = useCallback(() => setDrawer(null), []);
  useDialog(!!drawer, closeDrawer);
  // Esc closes the Tune panel, unless a drawer above it takes the key first.
  useEffect(() => {
    if (!tuneOpen || drawer) return;
    const key = (e) =>
      e.key === "Escape" &&
      !e.defaultPrevented &&
      !e.composedPath?.().some((n) => n.tagName === "DIALOG") &&
      setTuneOpen(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [tuneOpen, drawer]);

  const data = ctx.data;
  const tunedCount = changed(mode, params[mode]).length;
  function run(text = input, keepThread = false) {
    if (!keepThread) setThread([]);
    setRequest({ text, records, selectedId: null });
    setInput(text);
    setApplied(false);
    setNotice("");
    setDrawer(null);
    setGeneratedTokens([]);
    setRunId((n) => n + 1);
  }
  const actions = {
    editRequest: () => setDrawer("request"),
    openData: () => setDrawer("data"),
    chooseRecord(id) {
      setRequest({ text: trace.original, records, selectedId: id });
      setApplied(false);
      setNotice("");
    },
    confirm() {
      if (applied) return;
      try {
        setRecords(applyProposal(records, trace.decision.proposal));
        setApplied(true);
        setNotice("");
      } catch (error) {
        setNotice(error.message);
      }
    },
    reset() {
      const next = seeds();
      setRecords(next);
      setRequest({ text: trace.original, records: next, selectedId: null });
      setApplied(false);
      setNotice("");
    },
    appendToken() {
      setGeneratedTokens((t) => [...t, data.transformer.nextToken]);
    },
    resetTokens: () => setGeneratedTokens([]),
    // A reply continues the same request: it is appended and the whole
    // pipeline runs again on the combined sentence.
    reply(text) {
      const answer = text.trim();
      if (!answer) return;
      const base = trace.original.trim().replace(/[.?!]+$/, "");
      setThread((t) => [
        ...t,
        { who: "you", text: trace.original },
        { who: "trace", text: trace.decision.message },
      ]);
      run(`${base} ${answer}`, true);
    },
  };
  function switchMode(next) {
    if (next === mode) return;
    setMode(next);
    setGeneratedTokens([]);
    if (next === "copilot" && trace.original !== SAMPLE_MESSAGE) run(SAMPLE_MESSAGE);
  }

  return (
    <div className={`app mode-${mode}`}>
      <a href="#guide" className="skip-link">
        Skip to the step guide
      </a>
      <header className="topbar" data-background>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Waypoints size={15} strokeWidth={2.4} />
          </span>
          <span className="brand-text">
            <strong>TRACE</strong>
            <span>one input, every computation</span>
          </span>
        </div>
        <div className="segmented is-primary" role="group" aria-label="What to trace">
          <button aria-pressed={mode === "planner"} onClick={() => switchMode("planner")}>
            <CalendarClock size={14} /> Planner
          </button>
          <button aria-pressed={mode === "transformer"} onClick={() => switchMode("transformer")}>
            <Brain size={14} /> Transformer
          </button>
          <button aria-pressed={mode === "copilot"} onClick={() => switchMode("copilot")}>
            <MessagesSquare size={14} /> Copilot
          </button>
        </div>
        <span className="topbar-divider" aria-hidden="true" />
        <div className="segmented" role="group" aria-label="View">
          <button aria-pressed={view === "flow"} onClick={() => setView("flow")} title="Flow (1)">
            <Workflow size={14} /> Flow
          </button>
          <button aria-pressed={view === "2d"} onClick={() => setView("2d")} title="2D map (2)">
            <Square size={14} /> 2D
          </button>
          <button aria-pressed={view === "3d"} onClick={() => setView("3d")} disabled={!HAS_WEBGL} title="3D map (3)">
            <Box size={14} /> 3D
          </button>
        </div>
        <div className="topbar-tools">
          <button className="request-chip" onClick={() => setDrawer("request")} title={`Change the request: ${trace.original}`}>
            <PenLine size={14} />
            <span>{trace.original || "Enter a request"}</span>
          </button>
          <button
            className={tunedCount ? "is-tuned" : undefined}
            onClick={() => {
              setTuneFocus(null);
              setTuneOpen((v) => !v);
            }}
            aria-expanded={tuneOpen}
            aria-label={tunedCount ? `Tune the algorithms, ${tunedCount} changed` : "Tune the algorithms"}
          >
            <SlidersHorizontal size={16} />
            <span>Tune{tunedCount ? ` · ${tunedCount}` : ""}</span>
          </button>
          <button onClick={() => setDrawer("data")} aria-label="Records, checks and export">
            <Database size={16} />
            <span>Data</span>
          </button>
          <button onClick={toggleTheme} aria-label={theme === "light" ? "Switch to dark" : "Switch to light"} title={theme === "light" ? "Dark theme" : "Light theme"}>
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>
      </header>

      <ErrorBoundary key={`${mode}-${runId}`}>
      <TrackView
        mode={mode}
        steps={steps}
        ctx={ctx}
        theme={theme}
        params={params}
        tuneOpen={tuneOpen}
        onTune={(path, value) => {
          if (value !== undefined) tune(path, value);
          setTuneFocus(path);
          setTuneOpen(true);
        }}
        view={view}
        onView={(v) => (v !== "3d" || HAS_WEBGL) && setView(v)}
        runId={runId}
        reduced={reduced}
        stopAt={stopAt}
        paused={!!drawer}
        onOpenMap={() => setView("2d")}
        on3DFail={() => {
          setView("2d");
          setNotice("3D is not available in this browser, so the map is shown in 2D.");
        }}
        onOpenTable={(module, at) => {
          setTable({ module, at });
          setDrawer("table");
        }}
        actionProps={{
          mode,
          trace,
          records,
          applied,
          notice,
          generatedTokens,
          nextToken: data.transformer.nextToken,
          thread,
          actions,
          params,
        }}
      />
      </ErrorBoundary>

      <TunePanel
        open={tuneOpen}
        mode={mode}
        params={params}
        focus={tuneFocus}
        onTune={tune}
        onSet={setParams}
        onReset={resetParams}
        onClose={() => setTuneOpen(false)}
        baseline={ctx.baseline}
        ctx={ctx}
        steps={steps}
      />

      {notice && (
        <div className="toast" role="status">
          {notice}
          <button onClick={() => setNotice("")} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {drawer && (
        <div className="drawer-backdrop" onClick={closeDrawer}>
          <section
            className={`drawer drawer-${drawer}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="drawer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h2 id="drawer-title">
                {drawer === "table"
                  ? "This step as tables"
                  : drawer === "data"
                    ? "Records, checks and export"
                    : "Change the request"}
              </h2>
              <button aria-label="Close" onClick={closeDrawer}>
                <X size={20} />
              </button>
            </header>
            <div className="drawer-body">
              {drawer === "table" && table ? (
                <TablePlayer module={table.module} ctx={ctx} start={table.at} />
              ) : drawer === "data" ? (
                <DataPanel
                  mode={mode}
                  trace={trace}
                  data={data}
                  records={records}
                  applied={applied}
                  onReset={actions.reset}
                />
              ) : (
                <RequestPanel
                  input={input}
                  setInput={setInput}
                  scenario={scenario}
                  onRun={() => {
                    setScenario("custom");
                    run();
                  }}
                  onScenario={(s) => {
                    setScenario(s.id);
                    run(s.prompt);
                  }}
                />
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function TablePlayer({ module, ctx, start }) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  return (
    <StepPlayer
      module={module}
      ctx={ctx}
      playing={playing}
      setPlaying={setPlaying}
      speed={speed}
      setSpeed={setSpeed}
      start={start}
      compact
    />
  );
}

