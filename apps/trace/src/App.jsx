import { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Database, PenLine, Square, Workflow, X } from "lucide-react";
import TrackView from "./TrackView.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import StepPlayer from "./explain/StepPlayer.jsx";
import { DataPanel, RequestPanel } from "./Panels.jsx";
import { analyze, applyProposal, SCENARIOS, SEED_RECORDS } from "./engine/pipeline.js";
import { microscope } from "./engine/microscope.js";
import { copilotSteps, stepsFor } from "./steps.js";
import { sampleCopilot, SAMPLE_MESSAGE, SAMPLE_RESPONSE } from "./engine/copilotSample.js";

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

export default function App() {
  const reduced = useReducedMotion();
  const [mode, setMode] = useState("planner");
  const [view, setView] = useState("flow");
  const [records, setRecords] = useState(seeds);
  const [input, setInput] = useState(SCENARIOS[0].prompt);
  const [scenario, setScenario] = useState(SCENARIOS[0].id);
  const [trace, setTrace] = useState(() => analyze(SCENARIOS[0].prompt));
  const [applied, setApplied] = useState(false);
  const [notice, setNotice] = useState("");
  const [generatedTokens, setGeneratedTokens] = useState([]);
  const [drawer, setDrawer] = useState(null);
  const [table, setTable] = useState(null);
  const [runId, setRunId] = useState(0);
  // Earlier turns when the visitor answers a question instead of rewriting.
  const [thread, setThread] = useState([]);

  const steps =
    mode === "copilot"
      ? copilotSteps({ response: trace.original === SAMPLE_MESSAGE ? SAMPLE_RESPONSE : null })
      : stepsFor(mode);
  const data = useMemo(() => microscope(trace, generatedTokens), [trace, generatedTokens]);
  const ctx = useMemo(() => {
    // The copilot track uses the sample exchange; any other message has no
    // real reply to show.
    const copilot = {
      ...sampleCopilot(),
      message: trace.original || SAMPLE_MESSAGE,
      response: trace.original === SAMPLE_MESSAGE ? SAMPLE_RESPONSE : null,
    };
    return { trace, data, model: data.transformer, records, applied, generatedTokens, copilot };
  }, [trace, data, records, applied, generatedTokens]);
  // Playback halts after Decide while the request still needs an answer.
  const stopAt =
    mode === "planner" && trace.decision.status === "clarify"
      ? steps.findIndex((s) => s.id === "decide")
      : null;
  const closeDrawer = useCallback(() => setDrawer(null), []);
  useDialog(!!drawer, closeDrawer);

  function run(text = input, keepThread = false) {
    if (!keepThread) setThread([]);
    setTrace(analyze(text, records));
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
      setTrace(analyze(trace.original, records, id));
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
      setTrace(analyze(trace.original, next));
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
          <strong>TRACE</strong>
          <span>one sentence, every computation</span>
        </div>
        <div className="segmented" role="group" aria-label="What to trace">
          <button aria-pressed={mode === "planner"} onClick={() => switchMode("planner")}>
            Planner pipeline
          </button>
          <button aria-pressed={mode === "transformer"} onClick={() => switchMode("transformer")}>
            Transformer block
          </button>
          <button aria-pressed={mode === "copilot"} onClick={() => switchMode("copilot")}>
            Copilot
          </button>
        </div>
        <div className="segmented" role="group" aria-label="View">
          <button aria-pressed={view === "flow"} onClick={() => setView("flow")}>
            <Workflow size={14} /> Flow
          </button>
          <button aria-pressed={view === "2d"} onClick={() => setView("2d")}>
            <Square size={14} /> 2D
          </button>
          <button aria-pressed={view === "3d"} onClick={() => setView("3d")} disabled={!HAS_WEBGL}>
            <Box size={14} /> 3D
          </button>
        </div>
        <div className="topbar-tools">
          <button className="request-chip" onClick={() => setDrawer("request")} title={trace.original}>
            <PenLine size={14} />
            <span>{trace.original || "Enter a request"}</span>
          </button>
          <button onClick={() => setDrawer("data")} aria-label="Records, checks and export">
            <Database size={16} />
            <span>Data</span>
          </button>
        </div>
      </header>

      <ErrorBoundary key={`${mode}-${runId}`}>
      <TrackView
        mode={mode}
        steps={steps}
        ctx={ctx}
        view={view}
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
        }}
      />
      </ErrorBoundary>

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
