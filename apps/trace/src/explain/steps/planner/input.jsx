import { Chars, Expr, Panel, Table, Tag } from "../../kit.jsx";
import { charGrid, charsBlock, row, tableBlock } from "../../../map/blocks.js";
import { normalizeSteps } from "../../../engine/pipeline.js";
import {
  charClass,
  codePoints,
  collapseHunks,
  diff,
  hex,
  hunkSpans,
  plural,
  showWs,
  trimHunks,
  unitsOf,
  uPlus,
  visible,
  edgeWs,
  indexed,
  revealState,
} from "./util.js";

const MAX_CHUNKS = 40; // frames in the code-point walk
const MAX_PIECE = 24; // code points per chunk at most
const MAX_HUNK_FRAMES = 6; // per normalization sub-step

const SUB = [
  {
    key: "nfkc",
    from: "text",
    name: "NFKC",
    line: 7,
    expr: 'text.normalize("NFKC")',
    what: "NFKC replaces compatibility characters with their standard form (a fullwidth Ｍ becomes M, the one-character ligature ﬁ becomes the two letters fi) and joins a letter with a following combining accent into one code point.",
    hunks: (before, after) => diff(before, after),
  },
  {
    key: "lower",
    from: "nfkc",
    name: "Lowercase",
    line: 8,
    expr: "nfkc.toLowerCase()",
    what: "toLowerCase() maps every uppercase letter to its lowercase form using the Unicode case tables. For ASCII capitals A–Z that means adding 0x20 to the code point.",
    hunks: (before, after) => diff(before, after),
  },
  {
    key: "collapsed",
    from: "lower",
    name: "Collapse whitespace",
    line: 9,
    expr: 'lower.replace(/\\s+/g, " ")',
    what: "The regular expression \\s+ matches every run of one or more whitespace characters (spaces, tabs, newlines). Each run is replaced by exactly one space U+0020.",
    hunks: (before) => collapseHunks(before),
  },
  {
    key: "trimmed",
    from: "collapsed",
    name: "Trim",
    line: 10,
    expr: "collapsed.trim()",
    what: "trim() removes whitespace at the very start and the very end. Spaces between words stay.",
    hunks: (before) => trimHunks(before),
  },
];

// Word-sized groups of code points: a word plus the whitespace after it.
function chunksOf(chars) {
  const space = (i) => /\s/u.test(chars[i].char);
  const words = [];
  let cur = [];
  chars.forEach((_, i) => {
    if (!space(i) && i > 0 && space(i - 1) && cur.some((k) => !space(k))) {
      words.push(cur);
      cur = [];
    }
    cur.push(i);
  });
  if (cur.length) words.push(cur);
  const min = Math.ceil(chars.length / MAX_CHUNKS);
  const out = [];
  for (const w of words)
    for (let k = 0; k < w.length; k += MAX_PIECE) {
      const piece = w.slice(k, k + MAX_PIECE);
      const last = out.at(-1);
      if (last && last.length < min && last.length + piece.length <= Math.max(MAX_PIECE, 2 * min))
        last.push(...piece);
      else out.push(piece);
    }
  return out;
}

const surrogates = (cp) => {
  const v = cp - 0x10000;
  return { v, high: 0xd800 + (v >> 10), low: 0xdc00 + (v & 0x3ff) };
};

function chunkSay(chars, ids, text, first) {
  const cs = ids.map((i) => chars[i]);
  const start = cs[0].offset;
  const end = cs.at(-1).offset + cs.at(-1).length;
  const listed = cs.length === 1 ? "" : cs
    .slice(0, 8)
    .map((c) => `${visible(c.char)} ${c.hex}`)
    .join(", ");
  const more = cs.length > 8 ? `, and ${cs.length - 8} more` : "";
  const astral = cs.filter((c) => c.length === 2);
  const nonAscii = cs.filter((c) => c.length === 1 && c.codePoint > 0x7f);
  let note;
  if (astral.length) {
    const c = astral[0];
    note = `“${c.char}” is ${c.hex}, above U+FFFF, so UTF-16 stores it as the surrogate pair ${unitsOf(c.char).join(" ")}: one code point, two code units. The offset jumps from ${c.offset} to ${c.offset + 2}.`;
  } else if (nonAscii.length) {
    const c = nonAscii[0];
    note = `“${c.char}” (${c.hex}) is outside ASCII but below U+10000, so it is still one code unit.`;
  } else
    note = first
      ? "All are below U+0080 (ASCII), so each is one UTF-16 code unit and the offset advances by 1 per character."
      : "All ASCII: one code unit each.";
  return {
    start,
    end,
    say: `Offsets ${start}–${end - 1}: “${text.slice(start, end)}”. ${listed ? `${listed}${more}. ` : ""}${note}`,
  };
}

function hunkSay(sub, h) {
  const at = h.bEnd - h.bStart > 1 ? `Offsets ${h.bStart}–${h.bEnd - 1}` : `Offset ${h.bStart}`;
  if (sub.key === "collapsed")
    return `${at}: a run of ${plural(Array.from(h.from).length, "whitespace character")} (${codePoints(h.from)}) becomes one space U+0020.`;
  if (sub.key === "trimmed")
    return `${at}: ${h.bStart === 0 ? "leading" : "trailing"} whitespace (${codePoints(h.from)}) is removed.`;
  const pairs = Array.from(h.from, (ch, i) => `${ch.charCodeAt(0)} → ${h.to.charCodeAt(i)}`).join(", ");
  const ascii =
    sub.key === "lower" && /^[A-Z]+$/.test(h.from) && h.to === h.from.toLowerCase()
      ? h.from.length === 1
        ? ` The code point goes up by 0x20: ${pairs}.`
        : ` Each code point goes up by 0x20: ${pairs}.`
      : "";
  return `${at}: “${showWs(h.from)}” (${codePoints(h.from) || "nothing"}) → “${showWs(h.to)}” (${codePoints(h.to) || "nothing"}).${ascii}`;
}

const mod = {
  id: "signal",
  source: [
    ["pipeline", "normalize"],
    ["pipeline", "normalizeSteps"],
  ],
  code: [
    "// a JavaScript string is a sequence of UTF-16 code units",
    "let offset = 0",
    "for (const ch of text) {               // for…of walks code points",
    "  const cp = ch.codePointAt(0)         // \"M\" → 77 = U+004D",
    "  const units = ch.length              // 2 when cp > 0xFFFF (surrogate pair)",
    "  offset += units",
    "}",
    'const nfkc = text.normalize("NFKC")    // compatibility forms → standard',
    "const lower = nfkc.toLowerCase()",
    'const collapsed = lower.replace(/\\s+/g, " ")   // whitespace run → one space',
    "const trimmed = collapsed.trim()       // drop leading and trailing whitespace",
    "return trimmed                         // = normalize(text)",
  ],
  frames({ trace, data }) {
    const text = trace.original;
    const chars = data.characters;
    const steps = normalizeSteps(text);
    const astralCount = chars.filter((c) => c.length === 2).length;
    const frames = [
      {
        phase: "Code points",
        line: [0, 1],
        say: text
          ? `The input has text.length = ${text.length} UTF-16 code units. A for…of loop visits code points instead; the two counts differ only for characters above U+FFFF.`
          : "The input is empty: text.length = 0, so the loop body never runs.",
        vars: { text, "text.length": text.length, offset: 0 },
        view: "chars",
        chunk: -1,
        walked: 0,
        hold: 1.2,
      },
    ];
    const chunks = chunksOf(chars);
    let seen = 0;
    let explained = false;
    chunks.forEach((ids, k) => {
      const ascii = ids.every((i) => chars[i].codePoint <= 0x7f);
      const { start, end, say } = chunkSay(chars, ids, text, ascii && !explained);
      if (ascii) explained = true;
      seen += ids.length;
      frames.push({
        phase: "Code points",
        line: [2, 3, 4, 5],
        say,
        vars: {
          chunk: text.slice(start, end),
          "code points": ids.length,
          "code units": end - start,
          offset: end,
          "code points so far": seen,
        },
        view: "chars",
        chunk: k,
        ids,
        start,
        end,
        walked: end,
        tokens: trace.tokens.filter((t) => t.start >= start && t.start < end).map((t) => t.id),
        hold: ids.length > 6 ? 1.1 : 0.9,
      });
    });
    if (text)
      frames.push({
        phase: "Code points",
        line: 6,
        say: `${plural(chars.length, "code point")} in ${plural(text.length, "code unit")}. ${
          astralCount
            ? `${astralCount === 1 ? "1 character above U+FFFF uses two units" : `${astralCount} characters above U+FFFF use two units each`}, which is why the counts differ by ${astralCount}.`
            : "No character is above U+FFFF, so the two counts are equal."
        } Offsets in later steps count code units.`,
        vars: { "code points": chars.length, "text.length": text.length, "surrogate pairs": astralCount },
        view: "chars",
        chunk: chunks.length,
        walked: text.length,
      });

    SUB.forEach((sub, s) => {
      const before = sub.from === "text" ? text : steps[sub.from];
      const after = steps[sub.key];
      const hunks = sub.hunks(before, after);
      const base = { phase: sub.name, line: sub.line, view: "norm", sub: s, before, after, hunks };
      const lengths = { [`${sub.from}.length`]: before.length, [`${sub.key}.length`]: after.length };
      if (!hunks.length) {
        frames.push({
          ...base,
          say: `${sub.what} Nothing changed here: ${sub.key} === ${sub.from}, ${plural(before.length, "code unit")}.`,
          vars: { ...lengths, "changed positions": 0 },
          hunk: -1,
          done: true,
          hold: 1.4,
        });
        return;
      }
      frames.push({
        ...base,
        say: sub.what,
        vars: { [`${sub.from}.length`]: before.length },
        hunk: -1,
        done: false,
        hold: 1.3,
      });
      hunks.slice(0, MAX_HUNK_FRAMES).forEach((h, i) =>
        frames.push({
          ...base,
          say: hunkSay(sub, h),
          vars: { offset: h.bStart, before: h.from, after: h.to },
          hunk: i,
          done: false,
          hold: 0.9,
        }),
      );
      if (hunks.length > MAX_HUNK_FRAMES)
        frames.push({
          ...base,
          say: `${hunks.length - MAX_HUNK_FRAMES} more changes of the same kind, all marked in the strings below.`,
          vars: { "changes left": hunks.length - MAX_HUNK_FRAMES },
          hunk: hunks.length,
          done: false,
          hold: 0.9,
        });
      const changed = hunks.reduce((n, h) => n + Array.from(h.from).length, 0);
      const summary =
        sub.key === "collapsed"
          ? `${plural(hunks.length, "whitespace run")} (${plural(changed, "character")}) became single spaces.`
          : sub.key === "trimmed"
            ? `${plural(changed, "whitespace character")} removed from the ends.`
            : `${plural(changed, "code point")} changed in ${plural(hunks.length, "place")}.`;
      frames.push({
        ...base,
        say: `${sub.name}: ${summary} Length ${before.length} → ${after.length}.`,
        vars: { ...lengths, "changed positions": changed },
        hunk: -1,
        done: true,
      });
    });

    frames.push({
      phase: "Done",
      line: 11,
      say: text
        ? `normalized = “${steps.trimmed}” (${plural(steps.trimmed.length, "unit")}). The tokenizer scans the original, so token offsets point into what was typed; the extraction rules match this normalized copy.`
        : "Both the original and the normalized copy are empty strings.",
      vars: { original: text, normalized: steps.trimmed, "normalized.length": steps.trimmed.length },
      view: "done",
      sub: SUB.length,
    });
    return frames;
  },
  Stage({ ctx, frame, frames, seek }) {
    const { trace, data } = ctx;
    const text = trace.original;
    const steps = normalizeSteps(text);
    if (frame.view === "chars") return <CharsView text={text} chars={data.characters} frame={frame} frames={frames} seek={seek} />;
    if (frame.view === "norm") return <NormView frame={frame} steps={steps} text={text} frames={frames} seek={seek} />;
    return (
      <div className="x-stack">
        <Panel title="Original (kept unchanged)" note="Tokens and their offsets refer to this string.">
          {text ? <Chars text={text} /> : <p className="p-empty">(empty)</p>}
        </Panel>
        <Panel title="Normalized copy" note="Extraction rules (Extract step) run on this string.">
          {steps.trimmed ? <Chars text={steps.trimmed} /> : <p className="p-empty">(empty)</p>}
        </Panel>
        <Pipeline text={text} steps={steps} current={SUB.length} frames={frames} seek={seek} />
      </div>
    );
  },
};

function CharsView({ text, chars, frame, frames, seek }) {
  const chunkFrames = frames.filter((f) => f.view === "chars" && f.ids);
  const spans = chunkFrames
    .filter((f) => f.chunk <= frame.chunk)
    .map((f) => ({ start: f.start, end: f.end, cls: f.chunk === frame.chunk ? "active" : "context" }));
  const rows = (frame.ids ?? []).map((i) => chars[i]);
  const astral = rows.filter((c) => c.length === 2);
  const walked = chars.filter((c) => c.offset < (frame.walked ?? 0));
  return (
    <div className="x-stack">
      <Panel
        title="Original text"
        note="Each box is one code point; the small number is its offset in UTF-16 code units. Click a character to jump to its chunk."
      >
        {text ? (
          <Chars
            text={text}
            spans={spans}
            cursor={frame.start}
            onChar={(o) => {
              const at = frames.findIndex((f) => f.view === "chars" && f.ids && o >= f.start && o < f.end);
              if (at >= 0) seek(at);
            }}
          />
        ) : (
          <p className="p-empty">(empty string)</p>
        )}
      </Panel>
      {rows.length > 0 && (
        <Panel title={`This chunk: offsets ${frame.start}–${frame.end - 1}`}>
          <Table className="p-table"
            head={["char", "code point", "decimal", "UTF-16 units", "length", "offset", "class"]}
            rows={rows.map((c) => ({
              cls: c.length === 2 ? "is-active" : "",
              cells: [
                <code key="c">{c.char === " " ? "␣" : visible(c.char)}</code>,
                <code key="h">{c.hex}</code>,
                c.codePoint,
                <code key="u">{unitsOf(c.char).join(" ")}</code>,
                c.length === 2 ? <Tag key="l" kind="number">2 (pair)</Tag> : 1,
                c.offset,
                charClass(c.char),
              ],
            }))}
          />
        </Panel>
      )}
      {astral.map((c) => {
        const { v, high, low } = surrogates(c.codePoint);
        return (
          <Panel key={c.offset} title={`Surrogate pair for “${c.char}” (${c.hex})`} note="UTF-16 can hold 0x0000–0xFFFF in one unit. Larger code points are split into a high unit (D800–DBFF) and a low unit (DC00–DFFF).">
            <Expr label="v" terms={[`0x${hex(c.codePoint, 5)}`, "0x10000"]} op="−" result={`0x${hex(v, 5)}`} />
            <Expr label="high" terms={["0xD800", `(0x${hex(v, 5)} >> 10)`]} result={`0x${hex(high)}`} />
            <Expr label="low" terms={["0xDC00", `(0x${hex(v, 5)} & 0x3FF)`]} result={`0x${hex(low)}`} />
          </Panel>
        );
      })}
      <Panel title="Counts">
        <Table className="p-table"
          head={["", "so far", "whole text"]}
          rows={[
            ["code points", walked.length, chars.length],
            ["UTF-16 code units", walked.reduce((n, c) => n + c.length, 0), text.length],
            ["surrogate pairs", walked.filter((c) => c.length === 2).length, chars.filter((c) => c.length === 2).length],
            ["non-ASCII", walked.filter((c) => c.codePoint > 0x7f).length, chars.filter((c) => c.codePoint > 0x7f).length],
          ]}
        />
      </Panel>
    </div>
  );
}

function NormView({ frame, steps, text, frames, seek }) {
  const sub = SUB[frame.sub];
  const { before, after, hunks } = frame;
  const shown = frame.hunk >= 0 && frame.hunk < hunks.length ? frame.hunk : -1;
  const reveal = frame.done || frame.hunk >= 0;
  const visibleHunks = frame.done ? hunks : frame.hunk >= hunks.length ? hunks : hunks.slice(0, frame.hunk + 1);
  return (
    <div className="x-stack">
      <Panel title={`Before: ${sub.from}`} aside={<code className="p-dim">{sub.from}.length = {before.length}</code>}>
        {before ? <Chars text={before} spans={hunkSpans(visibleHunks, "before", shown)} /> : <p className="p-empty">(empty)</p>}
      </Panel>
      <Panel
        title={`After: ${sub.key} = ${sub.expr}`}
        aside={reveal && <code className="p-dim">{sub.key}.length = {after.length}</code>}
      >
        {!reveal ? (
          <p className="p-empty">…</p>
        ) : after ? (
          <Chars text={after} spans={hunkSpans(visibleHunks, "after", shown)} />
        ) : (
          <p className="p-empty">(empty)</p>
        )}
      </Panel>
      <Panel title={hunks.length ? `Changes (${hunks.length})` : "Changes"}>
        {hunks.length ? (
          <Table className="p-table"
            head={["#", "offset before", "before", "after", "offset after"]}
            active={shown}
            rows={hunks.map((h, i) =>
              frame.done || i <= frame.hunk
                ? [
                    i + 1,
                    h.bEnd - h.bStart > 1 ? `${h.bStart}–${h.bEnd - 1}` : h.bStart,
                    <span key="b">
                      <code>“{showWs(h.from)}”</code> <small className="p-dim">{codePoints(h.from)}</small>
                    </span>,
                    <span key="a">
                      <code>“{showWs(h.to)}”</code> <small className="p-dim">{codePoints(h.to) || "removed"}</small>
                    </span>,
                    h.aEnd - h.aStart > 1 ? `${h.aStart}–${h.aEnd - 1}` : h.aStart,
                  ]
                : { cls: "is-pending", cells: [i + 1, "", "", "", ""] },
            )}
          />
        ) : (
          <p className="p-empty">No position changed.</p>
        )}
      </Panel>
      <Pipeline text={text} steps={steps} current={frame.sub} done={frame.done} frames={frames} seek={seek} />
    </div>
  );
}

function Pipeline({ text, steps, current, done, frames, seek }) {
  const count = (s) => {
    const before = s.from === "text" ? text : steps[s.from];
    return s.hunks(before, steps[s.key]).length;
  };
  return (
    <Panel title="normalizeSteps(text)" note="Each line feeds the next. Click a row to jump to it.">
      <Table className="p-table"
        head={["step", "expression", "length", "changes", "result"]}
        active={current < SUB.length ? current : undefined}
        onRow={(i) => seek(frames.findIndex((f) => f.view === "norm" && f.sub === i))}
        rows={SUB.map((s, i) =>
          i < current || (i === current && done)
            ? [
                s.name,
                <code key="e">{s.expr}</code>,
                steps[s.key].length,
                count(s) ? <Tag key="c" kind="number">{count(s)}</Tag> : <Tag key="c" kind="skip">none</Tag>,
                <code key="r">“{showWs(steps[s.key])}”</code>,
              ]
            : { cls: i === current ? "" : "is-pending", cells: [s.name, <code key="e">{s.expr}</code>, "…", "…", "…"] },
        )}
      />
    </Panel>
  );
}

// ---- Map layer ----

// Offset in a step's input → offset in its output, across that step's hunks.
function through(hunks, o) {
  let shift = 0;
  for (const h of hunks) {
    if (o < h.bStart) break;
    if (o < h.bEnd) return h.aEnd > h.aStart ? Math.min(h.aStart + (o - h.bStart), h.aEnd - 1) : null;
    shift = h.aEnd - h.bEnd;
  }
  return o + shift;
}
const flip = (hunks) => hunks.map((h) => ({ bStart: h.aStart, bEnd: h.aEnd, aStart: h.bStart, aEnd: h.bEnd }));

const chainCache = new WeakMap();
function chain(trace) {
  if (chainCache.has(trace)) return chainCache.get(trace);
  const text = trace.original;
  const steps = normalizeSteps(text);
  const strings = [text, steps.nfkc, steps.lower, steps.collapsed, steps.trimmed];
  const hunks = SUB.map((sub, s) => sub.hunks(strings[s], strings[s + 1]));
  const overall = diff(text, steps.trimmed);
  const out = {
    text,
    steps,
    strings,
    hunks,
    overall,
    gOrig: charGrid(text),
    gNorm: charGrid(steps.trimmed),
    // Offsets in the input of sub-step s → offsets in the original text.
    toOriginal(s, offsets) {
      return offsets
        .map((o) => {
          let x = o;
          for (let k = s - 1; k >= 0 && x !== null; k--) x = through(flip(hunks[k]), x);
          return x;
        })
        .filter((x) => x !== null);
    },
  };
  chainCache.set(trace, out);
  return out;
}
const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
const cellsAt = (grid, offsets) => [...new Set(offsets)].map((o) => grid.at(o)).filter(Boolean);

function cellsOf(frame, { trace }) {
  const c = chain(trace);
  if (frame.view === "chars") return { original: { active: (frame.ids ?? []).map((i) => c.gOrig.cellOf(i)) } };
  if (frame.view === "norm") {
    const s = frame.sub;
    const hunks = frame.hunks ?? [];
    const shown =
      frame.hunk >= 0 && frame.hunk < hunks.length ? [hunks[frame.hunk]] : frame.hunk >= hunks.length ? hunks.slice(MAX_HUNK_FRAMES) : [];
    const src = cellsAt(c.gOrig, c.toOriginal(s, shown.flatMap((h) => range(h.bStart, h.bEnd))));
    const prev = s > 0 ? [[s - 1, 1]] : [];
    if (frame.done) return { normsteps: { active: row(s, 4), source: prev } };
    return {
      normsteps: { active: frame.hunk >= 0 ? [[s, 1], [s, 3]] : [], source: prev },
      original: { source: src },
    };
  }
  // The last frame writes the normalized copy; changed positions glow.
  const changed = cellsAt(c.gNorm, c.overall.flatMap((h) => range(h.aStart, h.aEnd)));
  return {
    normsteps: { source: [[SUB.length - 1, 1]] },
    original: { source: cellsAt(c.gOrig, c.overall.flatMap((h) => range(h.bStart, h.bEnd))) },
    normalized: { active: changed.length ? changed : c.gNorm.chars.map((_, i) => c.gNorm.cellOf(i)) },
  };
}

// ---- Explain a cell ----

const charAt = (grid, r, col) => grid.chars[r * grid.cols + col] ?? null;
const describe = (ch) => `“${visible(ch)}” (${uPlus(ch.codePointAt(0))}, ${charClass(ch)})`;

function explainOriginal(c, r, col) {
  const item = charAt(c.gOrig, r, col);
  if (!item) return null;
  const before = c.gOrig.chars.slice(0, r * c.gOrig.cols + col);
  const lengths = before.map((x) => x.ch.length);
  return {
    meaning: `The character ${describe(item.ch)} as you typed it. ${
      item.ch.length === 2 ? "It is above U+FFFF, so it takes two UTF-16 code units (a surrogate pair)." : "It takes one UTF-16 code unit."
    }`,
    formula: "offset = the code units of every character before it, added up",
    worked: lengths.length
      ? lengths.length > 12
        ? `${lengths.length} characters before it, ${lengths.filter((n) => n === 2).length} of them two units wide → ${item.offset}`
        : `${lengths.join(" + ")} = ${item.offset}`
      : "it is the first character → 0",
  };
}

function explainNormStep(c, r, col) {
  const sub = SUB[r];
  if (!sub) return null;
  const before = c.strings[r];
  const after = c.strings[r + 1];
  const hunks = c.hunks[r];
  switch (col) {
    case 0:
      return { meaning: sub.what, formula: `${sub.key} = ${sub.expr}` };
    case 1:
      return {
        meaning: `The text after the ${sub.name.toLowerCase()} step.`,
        formula: `${sub.key} = ${sub.expr}`,
        worked: `“${showWs(before)}” → “${showWs(after)}”`,
      };
    case 2:
      return {
        meaning: `The length of ${sub.key} in UTF-16 code units.`,
        formula: `${sub.key}.length`,
        worked: `${sub.from}.length ${before.length} → ${sub.key}.length ${after.length}`,
      };
    case 3:
      return {
        meaning: hunks.length ? `How many places this step changed.` : "This step changed nothing for this text.",
        formula: "count of changed runs between the step's input and output",
        worked: hunks.length
          ? hunks
              .slice(0, 4)
              .map((h) => `“${showWs(h.from)}” → “${showWs(h.to)}”`)
              .join(", ") + (hunks.length > 4 ? `, and ${hunks.length - 4} more` : "")
          : `${sub.key} === ${sub.from}`,
      };
    default:
      return null;
  }
}

function explainNormalized(c, changed, r, col) {
  const item = charAt(c.gNorm, r, col);
  if (!item) return null;
  const h = c.overall.find((x) => item.offset >= x.aStart && item.offset < x.aEnd);
  return {
    meaning: `${describe(item.ch)} in the normalized copy, at offset ${item.offset}. The extraction rules read this copy.`,
    formula: "normalized = trim(collapseSpaces(lowercase(NFKC(text))))",
    worked: changed.has(item.offset) && h ? `“${showWs(h.from)}” in the original became “${showWs(h.to)}”` : "unchanged from the original",
  };
}

Object.assign(mod, {
  blocks({ trace }) {
    const c = chain(trace);
    const changed = new Set(c.overall.flatMap((h) => range(h.aStart, h.aEnd)));
    return [
      charsBlock({
        id: "original",
        title: "original text · UTF-16 offsets",
        text: trace.original,
        tone: (item) => (item.ch.length === 2 ? "warn" : item.ch.codePointAt(0) > 0x7f ? "number" : undefined),
        explain: (r, col) => explainOriginal(c, r, col),
      }),
      tableBlock({
        id: "normsteps",
        title: "normalizeSteps(text)",
        head: ["step", "result", "len", "changes"],
        widths: [1.75, 6.2, 0.6, 0.95],
        rows: SUB.map((sub, s) => [
          { text: sub.name.toLowerCase().replace("nfkc", "NFKC").replace("collapse whitespace", "collapse spaces"), align: "left" },
          { text: edgeWs(c.strings[s + 1]) || "(empty)", align: "left", dim: !c.strings[s + 1] },
          { text: String(c.strings[s + 1].length) },
          c.hunks[s].length ? { text: String(c.hunks[s].length), tone: "accent" } : { text: "none", tone: "muted" },
        ]),
        explain: (r, col) => explainNormStep(c, r, col),
      }),
      charsBlock({
        id: "normalized",
        title: "normalized copy · rules match this",
        text: c.steps.trimmed,
        tone: (item) => (changed.has(item.offset) ? "accent" : undefined),
        explain: (r, col) => explainNormalized(c, changed, r, col),
      }),
    ];
  },
  output: "original",
  state(frame, ctx) {
    return revealState(mod, frame, ctx, cellsOf, {
      original: () => false,
      normsteps: (r, col) => col === 0,
      normalized: () => false,
    });
  },
  math(frame, { trace, data }) {
    const c = chain(trace);
    if (frame.view === "chars") {
      if (!frame.ids) {
        if (frame.chunk < 0) return [{ label: "text.length", terms: [`${trace.original.length} code units`] }];
        const pairs = data.characters.filter((x) => x.length === 2).length;
        return [
          { label: "code points", terms: [String(data.characters.length)] },
          { label: "code units", terms: [String(data.characters.length - pairs), `2 × ${pairs}`], result: trace.original.length },
        ];
      }
      const cs = frame.ids.map((i) => data.characters[i]);
      const lines = cs.slice(0, 6).map((x) => ({
        label: /\s/.test(x.char) ? visible(x.char) : `“${x.char}”`,
        terms: [`${x.hex} (${x.codePoint})`],
        result: `${x.length} unit${x.length > 1 ? "s" : ""}`,
      }));
      const lengths = cs.map((x) => String(x.length));
      lines.push({
        label: "offset",
        terms: lengths.length > 8 ? [String(frame.start), `${frame.end - frame.start} units`] : [String(frame.start), ...lengths],
        result: String(frame.end),
      });
      const astral = cs.find((x) => x.length === 2);
      if (astral) {
        const v = astral.codePoint - 0x10000;
        lines.splice(
          0,
          lines.length - 1,
          { label: `“${astral.char}”`, terms: [astral.hex], result: "2 units" },
          { label: "v", terms: [`0x${hex(astral.codePoint, 5)}`, "0x10000"], op: "−", result: `0x${hex(v, 5)}` },
          { label: "high", terms: ["0xD800", `(v >> 10)`], result: `0x${hex(0xd800 + (v >> 10))}` },
          { label: "low", terms: ["0xDC00", `(v & 0x3FF)`], result: `0x${hex(0xdc00 + (v & 0x3ff))}` },
        );
      }
      return lines;
    }
    if (frame.view === "norm") {
      const sub = SUB[frame.sub];
      const h = frame.hunks?.[frame.hunk];
      if (h) {
        const lines = [{ label: sub.name, terms: [`“${showWs(h.from)}” ${codePoints(h.from)}`], result: `“${showWs(h.to)}” ${codePoints(h.to) || "(removed)"}` }];
        if (sub.key === "lower" && /^[A-Z]+$/.test(h.from))
          Array.from(h.from).forEach((ch, i) =>
            lines.push({ label: `“${ch}”`, terms: [String(ch.charCodeAt(0)), "32"], result: `${h.to.charCodeAt(i)} “${h.to[i]}”` }),
          );
        return lines.slice(0, 8);
      }
      if (frame.done)
        return [{ label: `${sub.key}.length`, terms: [`${frame.before.length} → ${frame.after.length}`] }];
      return [];
    }
    return [
      { label: "original", terms: [`${c.text.length} code units`] },
      { label: "normalized", terms: [`${c.steps.trimmed.length} code units`] },
    ];
  },
});
const rawFrames = mod.frames;
mod.frames = (ctx) => indexed(rawFrames.call(mod, ctx));

export default mod;
