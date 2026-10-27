// TRACE inside another site. mountTrace() opens a full-screen overlay in its
// own shadow root, so neither site's CSS reaches the other, and returns
// { update(props), close() }. Nothing here touches the network.
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Box, ExternalLink, SlidersHorizontal, Square, Waypoints, Workflow, X } from "lucide-react";
import TrackView from "./TrackView.jsx";
import Badge from "./Badge.jsx";
import { TRACE_SITE_URL } from "./site.js";
import StepPlayer from "./explain/StepPlayer.jsx";
import { analyze } from "./engine/pipeline.js";
import { copilotSteps } from "./steps.js";
import { buildCtx } from "./tune/context.js";
import { useParams } from "./tune/useParams.js";
import { changed } from "./tune/schema.js";
import TunePanel from "./tune/TunePanel.jsx";
import tuneCss from "./tune/tune.css?inline";
import teachCss from "./teach/teach.css?inline";
import baseCss from "./styles.css?inline";
import explainCss from "./explain/explain.css?inline";
import plannerCss from "./explain/steps/planner/planner.css?inline";
import transformerCss from "./explain/steps/transformer/transformer.css?inline";
import manrope from "../public/fonts/Manrope.ttf?url";
import space from "../public/fonts/SpaceGrotesk.ttf?url";

// Inside a shadow root :root matches nothing and @font-face is ignored, so the
// variables move to :host and the fonts are registered on the document once.
const SHADOW_CSS = [baseCss, explainCss, plannerCss, transformerCss, tuneCss, teachCss]
  .join("\n")
  .replace(/@font-face\s*{[^}]*}/g, "")
  .replace(/:root\[data-theme="light"\]/g, ':host([data-theme="light"])')
  .replace(/:root/g, ":host");
function registerFonts() {
  if (document.getElementById("trace-fonts")) return;
  const style = document.createElement("style");
  style.id = "trace-fonts";
  style.textContent = `
@font-face { font-family: Manrope; src: url("${manrope}") format("truetype"); font-weight: 200 800; font-display: swap; }
@font-face { font-family: Space; src: url("${space}") format("truetype"); font-weight: 300 700; font-display: swap; }`;
  document.head.append(style);
}

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const hasWebGL = () => {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
};

function TraceOverlay({ copilot, onClose, theme, accent }) {
  const [view, setView] = useState("flow");
  const [table, setTable] = useState(null);
  const [runId] = useState(0);
  const [webgl] = useState(hasWebGL);
  const closeRef = useRef(null);
  const { params, tune, reset, set } = useParams();
  const [tuneOpen, setTuneOpen] = useState(false);
  const [tuneFocus, setTuneFocus] = useState(null);
  const steps = useMemo(() => copilotSteps(copilot, params), [copilot, params]);
  const ctx = useMemo(
    () => buildCtx({ trace: analyze(copilot.message), params, copilot }),
    [copilot, params],
  );
  const tunedCount = changed("copilot", params.copilot).length;

  useEffect(() => {
    closeRef.current?.focus();
    function key(e) {
      if (e.key !== "Escape") return;
      // The help dialog closes itself first.
      if (e.composedPath?.().some((n) => n.tagName === "DIALOG")) return;
      if (tuneOpen) setTuneOpen(false);
      else if (table) setTable(null);
      else onClose();
    }
    window.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
    };
  }, [onClose, table, tuneOpen]);

  return (
    <div className="app mode-copilot" role="dialog" aria-modal="true" aria-label="Trace of this reply">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Waypoints size={15} strokeWidth={2.4} />
          </span>
          <span className="brand-text">
            <strong>TRACE</strong>
            <span>how this reply was made</span>
          </span>
        </div>
        <div className="segmented is-primary" role="group" aria-label="View">
          <button aria-pressed={view === "flow"} onClick={() => setView("flow")} title="Flow (1)">
            <Workflow size={14} /> Flow
          </button>
          <button aria-pressed={view === "2d"} onClick={() => setView("2d")} title="2D map (2)">
            <Square size={14} /> 2D
          </button>
          <button aria-pressed={view === "3d"} onClick={() => setView("3d")} disabled={!webgl} title="3D map (3)">
            <Box size={14} /> 3D
          </button>
        </div>
        <div className="embed-note">
          <p>
            {copilot.demo
              ? "A sample reply, traced step by step. Search runs on sample records."
              : "Built from your message, the records it searched and the reply you got."}
          </p>
          <p className="embed-key" aria-label="What the step labels mean">
            <Badge kind="real" /> your actual values
            <Badge kind="recomputed" /> rerun here
            <Badge kind="illustration" /> how models work in general
          </p>
        </div>
        <div className="topbar-tools">
          <button
            className={tunedCount ? "is-tuned" : undefined}
            onClick={() => {
              setTuneFocus(null);
              setTuneOpen((v) => !v);
            }}
            aria-expanded={tuneOpen}
            aria-label={tunedCount ? `Tune the search, ${tunedCount} changed` : "Tune the search"}
          >
            <SlidersHorizontal size={16} />
            <span>Tune{tunedCount ? ` · ${tunedCount}` : ""}</span>
          </button>
          <a href={TRACE_SITE_URL} target="_blank" rel="noopener noreferrer" title="Open the full TRACE site in a new tab">
            <ExternalLink size={15} />
            <span>Open full TRACE</span>
          </a>
          <button ref={closeRef} onClick={onClose} aria-label="Close trace">
            <X size={18} />
            <span>Close</span>
          </button>
        </div>
      </header>
      <TrackView
        theme={theme}
        accent={accent}
        mode="copilot"
        steps={steps}
        ctx={ctx}
        params={params}
        tuneOpen={tuneOpen}
        onTune={(path, value) => {
          if (value !== undefined) tune(path, value);
          setTuneFocus(path);
          setTuneOpen(true);
        }}
        view={view}
        onView={(v) => (v !== "3d" || webgl) && setView(v)}
        embed
        runId={runId}
        reduced={reducedMotion()}
        stopAt={null}
        paused={!!table}
        on3DFail={() => setView("2d")}
        onOpenMap={() => setView("2d")}
        onOpenTable={(module, at) => setTable({ module, at })}
        actionProps={{ mode: "copilot", trace: ctx.trace, records: [], applied: false, generatedTokens: [], actions: {}, params }}
      />
      <TunePanel
        open={tuneOpen}
        mode="copilot"
        params={params}
        focus={tuneFocus}
        onTune={tune}
        onSet={set}
        onReset={reset}
        onClose={() => setTuneOpen(false)}
        baseline={ctx.baseline}
        ctx={ctx}
        steps={steps}
      />
      {table && (
        <div className="drawer-backdrop" onClick={() => setTable(null)}>
          <section className="drawer drawer-table" role="dialog" aria-modal="true" aria-label="This step as tables" onClick={(e) => e.stopPropagation()}>
            <header>
              <h2>This step as tables</h2>
              <button aria-label="Close" onClick={() => setTable(null)}>
                <X size={20} />
              </button>
            </header>
            <div className="drawer-body">
              <TablePlayer module={table.module} ctx={ctx} start={table.at} />
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
    <StepPlayer module={module} ctx={ctx} playing={playing} setPlaying={setPlaying} speed={speed} setSpeed={setSpeed} start={start} compact />
  );
}

// theme: "light" | "dark"; accent and font: the host site's brand colour and
// text font. Call update({ theme, accent, font }) when the host changes.
export function mountTrace({ copilot, onClose, theme = "dark", accent = null, font = null }) {
  registerFonts();
  const host = document.createElement("div");
  host.setAttribute("data-trace-overlay", "");
  host.style.cssText = "position:fixed;inset:0;z-index:2147483000;";
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `${SHADOW_CSS}\n:host{all:initial;display:block;position:fixed;inset:0;background:var(--bg);color:var(--text);font-family:var(--sans);}\n.app .topbar-tools{flex:none;}\n.embed-note{flex:1 1 auto;min-width:0;overflow:hidden;margin-left:8px;display:grid;gap:3px;font-size:12.5px;line-height:1.3;color:var(--soft);}.embed-note p{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.embed-key{display:flex;white-space:nowrap;overflow:hidden;align-items:center;gap:4px 6px;color:var(--muted);font-size:11.5px;}.embed-key .badge{margin-left:6px;}.embed-key .badge:first-child{margin-left:0;}@media (max-width:1180px){.embed-key{display:none;}}@media (max-width:900px){.embed-note{display:none;}}`;
  const container = document.createElement("div");
  shadow.append(style, container);
  const root = createRoot(container);
  let current = { copilot, onClose, theme, accent, font };
  const close = () => {
    root.unmount();
    host.remove();
  };
  const render = () => {
    host.setAttribute("data-theme", current.theme === "light" ? "light" : "dark");
    if (current.font) {
      host.style.setProperty("--sans", current.font);
      host.style.setProperty("--display", current.font);
    }
    root.render(
      <TraceOverlay
        copilot={current.copilot}
        theme={current.theme}
        accent={current.accent}
        onClose={() => current.onClose?.()}
      />,
    );
  };
  render();
  return {
    update(next) {
      current = { ...current, ...next };
      render();
    },
    close,
  };
}
