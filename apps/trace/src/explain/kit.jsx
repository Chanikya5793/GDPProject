// Small presentational pieces shared by every 2D step.

const MINUS = "−";
export function fixed(v, digits = 3) {
  if (v === -Infinity) return `${MINUS}∞`;
  if (v === Infinity) return "∞";
  if (typeof v !== "number" || Number.isNaN(v)) return String(v ?? "—");
  const s = v.toFixed(digits);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s.replace("-", MINUS);
}
// Integers print as integers; everything else gets fixed decimals.
export const fmt = (v, digits = 3) =>
  typeof v === "number" && Number.isInteger(v) ? String(v).replace("-", MINUS) : fixed(v, digits);
export const show = (v) =>
  typeof v === "string" ? `“${v}”` : Array.isArray(v) ? `[${v.map(show).join(", ")}]` : v === null || v === undefined ? "null" : fmt(v);

export function heat(value, scale, kind = "diverging") {
  if (!Number.isFinite(value)) return undefined;
  const a = Math.min(1, Math.abs(value) / (scale || 1));
  if (kind === "sequential") return `rgba(188, 166, 255, ${0.08 + a * 0.62})`;
  return value >= 0
    ? `rgba(145, 234, 211, ${0.06 + a * 0.5})`
    : `rgba(244, 189, 153, ${0.06 + a * 0.5})`;
}

export function Panel({ title, note, children, className = "", aside }) {
  return (
    <section className={`x-panel ${className}`}>
      {(title || aside) && (
        <header>
          {title && <h4>{title}</h4>}
          {aside}
        </header>
      )}
      {children}
      {note && <p className="x-note">{note}</p>}
    </section>
  );
}

// A labelled numeric grid. `state(r, c)` returns "active" | "done" | "pending"
// | "masked" | "dim"; pending cells render as a dot so the fill-in is visible.
export function Matrix({
  data,
  rowLabels,
  colLabels,
  digits = 2,
  heatKind = "diverging",
  scale,
  state = () => "done",
  onCell,
  corner = "",
  caption,
  className = "",
}) {
  const cols = data[0]?.length ?? colLabels?.length ?? 0;
  const max =
    scale ??
    Math.max(1e-9, ...data.flat().filter(Number.isFinite).map(Math.abs));
  return (
    <figure className={`x-matrix ${className}`}>
      {caption && <figcaption>{caption}</figcaption>}
      <div
        className="x-grid"
        style={{
          gridTemplateColumns: `${rowLabels ? "max-content " : ""}repeat(${cols}, minmax(3.4em, 1fr))`,
        }}
        role="table"
      >
        {colLabels && (
          <>
            {rowLabels && <span className="x-corner">{corner}</span>}
            {colLabels.map((l, c) => (
              <span key={c} className="x-col" role="columnheader">
                {l}
              </span>
            ))}
          </>
        )}
        {data.map((row, r) => (
          <div className="x-row" role="row" key={r}>
            {rowLabels && (
              <span className="x-rowlabel" role="rowheader">
                {rowLabels[r]}
              </span>
            )}
            {row.map((v, c) => {
              const s = state(r, c);
              const Tag = onCell ? "button" : "span";
              return (
                <Tag
                  key={c}
                  role="cell"
                  className={`x-cell is-${s}`}
                  style={
                    s === "done" || s === "active"
                      ? { background: heatKind ? heat(v, max, heatKind) : undefined }
                      : undefined
                  }
                  onClick={onCell ? () => onCell(r, c) : undefined}
                  title={`${rowLabels ? rowLabels[r] : r}, ${colLabels ? colLabels[c] : c}: ${fixed(v, 6)}`}
                >
                  {s === "pending" ? "·" : s === "masked" ? `${MINUS}∞` : fixed(v, digits)}
                </Tag>
              );
            })}
          </div>
        ))}
      </div>
    </figure>
  );
}

// One line of arithmetic: terms joined by an operator, then "= result".
export function Expr({ label, terms, op = "+", result, active, className = "" }) {
  return (
    <div className={`x-expr ${className}`}>
      {label && <span className="x-expr-label">{label}</span>}
      <code>
        {terms.map((t, i) => (
          <span key={i}>
            {i > 0 && <span className="x-op"> {op} </span>}
            <span className={active === i ? "x-term is-active" : "x-term"}>{t}</span>
          </span>
        ))}
        {result !== undefined && (
          <>
            <span className="x-op"> = </span>
            <strong>{result}</strong>
          </>
        )}
      </code>
    </div>
  );
}

export function Bars({ items, max, digits = 3, unit = "" }) {
  const top = max ?? Math.max(1e-9, ...items.map((i) => Math.abs(i.value)));
  return (
    <div className="x-bars">
      {items.map((item, i) => (
        <div
          key={item.key ?? i}
          className={`x-bar ${item.active ? "is-active" : ""} ${item.dim ? "is-dim" : ""}`}
          onClick={item.onClick}
          role={item.onClick ? "button" : undefined}
          tabIndex={item.onClick ? 0 : undefined}
          onKeyDown={
            item.onClick
              ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), item.onClick())
              : undefined
          }
        >
          <span className="x-bar-label">{item.label}</span>
          <span className="x-bar-track">
            <i
              style={{
                width: `${Math.max(0, Math.min(100, (Math.abs(item.value) / top) * 100))}%`,
              }}
            />
            {item.marker !== undefined && (
              <b style={{ left: `${(item.marker / top) * 100}%` }} />
            )}
          </span>
          <code>
            {fixed(item.value, digits)}
            {unit}
          </code>
          {item.note && <small>{item.note}</small>}
        </div>
      ))}
    </div>
  );
}

// The characters of a string with their indices. `spans` color ranges;
// `cursor` marks the current position.
export function Chars({ text, spans = [], cursor, showIndex = true, onChar }) {
  let offset = 0;
  const cells = Array.from(text, (char) => {
    const cell = { char, offset };
    offset += char.length;
    return cell;
  });
  // Group runs of non-space characters so a line never breaks inside a word.
  const groups = [];
  cells.forEach((cell) => {
    const space = /\s/.test(cell.char);
    const last = groups.at(-1);
    if (!space && last && !last.space) last.cells.push(cell);
    else groups.push({ space, cells: [cell] });
  });
  const Tag = onChar ? "button" : "span";
  return (
    <div className="x-chars" role="list">
      {groups.map((group) => (
        <span className="x-word" key={group.cells[0].offset}>
          {group.cells.map(({ char, offset: o }) => {
            const span = spans.find((s) => o >= s.start && o < s.end);
            return (
              <Tag
                key={o}
                role="listitem"
                className={`x-char ${span ? `is-${span.cls}` : ""} ${span?.start === o ? "is-first" : ""} ${span && o + char.length === span.end ? "is-last" : ""} ${cursor === o ? "is-cursor" : ""} ${char === " " ? "is-space" : ""}`}
                onClick={onChar ? () => onChar(o) : undefined}
              >
                <strong>{char === " " ? "␣" : char}</strong>
                {showIndex && <small>{o}</small>}
              </Tag>
            );
          })}
        </span>
      ))}
    </div>
  );
}

export function Table({ head, rows, active, onRow, className = "" }) {
  return (
    <div className={`x-table-wrap ${className}`}>
      <table className="x-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr
              key={r}
              className={`${active === r ? "is-active" : ""} ${row.cls || ""}`}
              onClick={onRow ? () => onRow(r) : undefined}
            >
              {(row.cells || row).map((cell, c) => (
                <td key={c}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Tag({ kind, children }) {
  return <span className={`x-tag is-${kind}`}>{children}</span>;
}
