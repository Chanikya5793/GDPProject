import { useEffect, useMemo, useRef } from "react";
import { show } from "./kit.jsx";
import { sourceMap } from "./sourceLines.js";

const TOKEN =
  /(\/\/.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\/(?:[^/\\\n]|\\.)+\/[gimsuy]*)|\b(\d+(?:\.\d+)?(?:e-?\d+)?)\b|\b(const|let|var|function|return|export|if|else|for|of|in|new|await|async|throw|try|catch|break|continue|while|typeof|null|undefined|true|false)\b|([A-Za-z_$][\w$]*)(?=\s*\()/g;

// Minimal JavaScript coloring: comments, strings, regexes, numbers, keywords, calls.
function highlight(line) {
  const out = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const cls = m[1] ? "c" : m[2] ? "s" : m[3] ? "r" : m[4] ? "n" : m[5] ? "k" : "f";
    out.push(
      <span key={m.index} className={`hl-${cls}`}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  out.push(line.slice(last));
  return out;
}

// Variables whose name appears on a source line, for inline values.
function onLine(vars, text) {
  return vars.filter(([name]) => {
    const base = name.match(/^[A-Za-z_$][\w$]*/)?.[0];
    return base && new RegExp(`\\b${base.replace(/\$/g, "\\$")}\\b`).test(text);
  });
}

export default function SourcePanel({ module, frame, previous = {}, reduced }) {
  const map = useMemo(() => sourceMap(module), [module]);
  const scroller = useRef(null);
  const lines = [].concat(frame.line ?? []);
  const active = new Set(
    lines.map((i) => map.toSource[i]).filter(Boolean).map((t) => `${t.bi}:${t.li}`),
  );
  const vars = Object.entries(frame.vars ?? {});
  const firstActive = [...active][0];
  const unplaced = vars.filter(([name]) => {
    if (!firstActive) return true;
    return ![...active].some((key) => {
      const [bi, li] = key.split(":").map(Number);
      return onLine([[name]], map.blocks[bi].lines[li]).length;
    });
  });
  const activeKey = [...active].join("|");

  // Keep the running line in the middle of the panel.
  useEffect(() => {
    const box = scroller.current;
    const el = box?.querySelector(".is-running");
    if (!box || !el) return;
    const top = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2;
    box.scrollTo({ top, behavior: reduced ? "instant" : "smooth" });
  }, [activeKey, module, reduced]);

  return (
    <aside className="source-pane" data-background aria-label="Source code running now">
      <header>
        <b>Running the real code</b>
        <span>{map.blocks.map((b) => `${b.file.split("/").pop()}:${b.line}`).join(" · ")}</span>
      </header>
      <div className="src-scroll" ref={scroller}>
        {map.blocks.map((block, bi) => (
          <section key={`${block.file}:${block.line}`} className="src-block">
            <h4>
              {block.file}
              <span>:{block.line}</span>
            </h4>
            <ol>
              {block.lines.map((text, li) => {
                const key = `${bi}:${li}`;
                const running = active.has(key);
                const inline = running ? onLine(vars, text).slice(0, 4) : [];
                if (running && key === firstActive) inline.push(...unplaced.slice(0, Math.max(0, 4 - inline.length)));
                return (
                  <li key={li} className={running ? "is-running" : ""}>
                    <span className="ln">{block.line + li}</span>
                    <code>{highlight(text) }</code>
                    {inline.length > 0 && (
                      <span className="inline-vals">
                        {inline.map(([name, value]) => (
                          <em key={name}>
                            {name} = {show(value)}
                          </em>
                        ))}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
      <footer>
        <p className="src-step">
          {lines.length ? (
            lines.map((i) => <code key={i}>{module.code[i]?.trim()}</code>)
          ) : (
            <span>Setting up: no line is running yet.</span>
          )}
        </p>
        {vars.length > 0 && (
          <dl className="src-watch">
            {vars.map(([name, value]) => (
              <div
                key={name}
                className={name in previous && show(previous[name]) !== show(value) ? "is-changed" : ""}
              >
                <dt>{name}</dt>
                <dd>{show(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </footer>
    </aside>
  );
}
