// First-run intro: the three views and the controls, shown once per viewer
// and reopened from the keyboard button in the dock. A native modal dialog,
// so focus, Escape and the inert background come from the browser.
import { useEffect, useRef } from "react";
import { Box, Square, Workflow, X } from "lucide-react";

const KEY = "trace-welcome-v1";
export function seenWelcome() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}
export function rememberWelcome() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* it shows again next time */
  }
}

const VIEWS = [
  [
    Workflow,
    "Flow",
    "The whole system as stages: what each algorithm does and what went in and came out for your input.",
  ],
  [
    Square,
    "2D",
    "The real data as tables, computed frame by frame. Hover any value to see what it means and how it was computed.",
  ],
  [Box, "3D", "The same map in depth: numbers become bars, and lines show which values each result was read from."],
];
export const SHORTCUTS = [
  [["Space"], "Play or pause"],
  [["←", "→"], "Previous or next frame"],
  [["Shift", "←/→"], "Previous or next step"],
  [["1", "2", "3"], "Flow, 2D or 3D"],
  [["G"], "Show or hide the guide"],
  [["S"], "Show or hide the source code"],
  [["F"], "Focus: hide both panels"],
  [["O"], "Overview of the whole map"],
  [["C"], "Follow the current frame again"],
  [["?"], "This help"],
];

export function Keys({ keys }) {
  return (
    <span className="keys">
      {keys.map((k) => (
        <kbd key={k}>{k}</kbd>
      ))}
    </span>
  );
}

export default function Welcome({ open, onClose, embed = false, first = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="welcome"
      aria-labelledby="welcome-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {open && (
        <div className="welcome-card">
          <header>
            <div>
              <p className="g-kicker">{first ? "Welcome" : "How to use TRACE"}</p>
              <h2 id="welcome-title">{embed ? "See how this reply was made" : "One input, every computation"}</h2>
            </div>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <X size={18} />
            </button>
          </header>
          <p className="welcome-lead">
            {embed
              ? "This trace is built from your own message, the records it searched and the reply you got. Each step says whether its values are real, recomputed in your browser, or an illustration of how language models work."
              : "TRACE runs small, real algorithms on your input in the browser and shows every intermediate value. Nothing is sent anywhere."}
          </p>
          <ul className="welcome-views">
            {VIEWS.map(([Icon, name, text]) => (
              <li key={name}>
                <Icon size={18} aria-hidden="true" />
                <b>{name}</b>
                <span>{text}</span>
              </li>
            ))}
          </ul>
          <h3 className="welcome-sub">Keyboard</h3>
          <dl className="welcome-keys">
            {SHORTCUTS.map(([keys, what]) => (
              <div key={what}>
                <dt>
                  <Keys keys={keys} />
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
          <footer>
            <span>Reopen this any time with ?</span>
            <button type="button" className="primary" autoFocus onClick={onClose}>
              {first ? "Start exploring" : "Done"}
            </button>
          </footer>
        </div>
      )}
    </dialog>
  );
}
