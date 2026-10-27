import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { glossText } from "./glossary.js";

const portalOf = (el) => {
  const root = el?.getRootNode?.();
  return root && root !== document ? root : document.body;
};

// One linked term: dotted underline, definition on hover or keyboard focus.
// The popover is portalled to the document (or the embed's shadow root) and
// fixed to the viewport, so scrolling or blurred panels never clip it.
function Term({ text, entry }) {
  const id = useId();
  const ref = useRef(null);
  const [at, setAt] = useState(null);
  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(280, innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, innerWidth - width - 8));
    const below = r.bottom + 90 < innerHeight;
    setAt({
      root: portalOf(ref.current),
      style: { left, width, ...(below ? { top: r.bottom + 6 } : { bottom: innerHeight - r.top + 6 }) },
    });
  };
  const close = () => setAt(null);
  return (
    <span
      ref={ref}
      className="gloss"
      tabIndex={0}
      aria-describedby={id}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      onKeyDown={(e) => e.key === "Escape" && at && (e.stopPropagation(), close())}
    >
      {text}
      {at ? (
        createPortal(
          <span id={id} role="tooltip" className="gloss-pop" style={at.style}>
            <b>{entry.term}</b> {entry.def}
          </span>,
          at.root,
        )
      ) : (
        <span id={id} className="sr-only">
          {entry.def}
        </span>
      )}
    </span>
  );
}

// Text with the first use of each glossary term linked. Anything that is not
// a plain string (code, numbers, elements) is rendered untouched.
// `seen` lets several Glossed blocks on one screen link each term once.
export default function Glossed({ text, seen }) {
  if (typeof text !== "string" || !text) return text ?? null;
  return glossText(text, seen).map((p, i) =>
    typeof p === "string" ? p : <Term key={i} text={p.text} entry={p.entry} />,
  );
}

// For cards the pointer cannot enter (map hover cards): terms are marked and
// their definitions listed underneath.
export function GlossedNotes({ text, max = 2 }) {
  if (typeof text !== "string" || !text) return text ?? null;
  const parts = glossText(text);
  const terms = parts.filter((p) => typeof p !== "string").slice(0, max);
  return (
    <>
      <span>
        {parts.map((p, i) =>
          typeof p === "string" ? p : terms.includes(p) ? <u key={i} className="gloss is-static">{p.text}</u> : p.text,
        )}
      </span>
      {terms.map((t) => (
        <small key={t.entry.term} className="gloss-note">
          <b>{t.entry.term}</b> {t.entry.def}
        </small>
      ))}
    </>
  );
}
