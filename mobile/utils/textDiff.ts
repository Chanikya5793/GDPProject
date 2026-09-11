// What actually changed in a piece of text, word by word.
//
// Mirrors src/utils/textDiff.js, and a test pins the two to the same output so
// a change never reads differently on the phone and the laptop.
//
// Written for the assistant's proposal cards. A note's body can run to hundreds
// of words, and the old preview rendered the whole of the old text struck
// through next to the whole of the new text — two near-identical walls with no
// indication of which words moved. A student could not tell what the assistant
// was about to do, which is the entire reason this exists.

/** A stretch of text and what happened to it. */
export type DiffRun = {
  type: 'same' | 'add' | 'remove' | 'skip' | 'truncated';
  text: string;
  /** Only on `skip`: how many unchanged words were collapsed away. */
  words?: number;
};

export interface DiffStat {
  added: number;
  removed: number;
  unchanged: number;
}

/** Words of context kept either side of a change before collapsing. */
const CONTEXT = 8;

/** Roughly six lines on a phone. Past this the diff stops helping. */
const MAX_CHARS = 1200;

/**
 * Past this many tokens the quadratic table costs more than the diff is worth.
 * Reached only by a wholesale rewrite, where a word diff would be noise anyway.
 */
const MAX_TOKENS = 1500;

/**
 * Split into words, punctuation and whitespace, so a rejoin is lossless.
 *
 * Punctuation is its own token deliberately. Glued to the word it follows,
 * inserting a comma turns "burette," into a removal of one word and an
 * addition of another, and the student sees a change to a word that did not
 * change.
 */
function tokenize(text: string): string[] {
  return String(text || '')
    .split(/(\s+|[^\p{L}\p{N}_]+)/u)
    .filter(part => part !== undefined && part !== '');
}

/** What counts towards "34 words added" — not spaces, not punctuation. */
const isWord = (token: string): boolean => /[\p{L}\p{N}]/u.test(token);

/**
 * The longest common subsequence of two token arrays, as runs.
 *
 * The common prefix and suffix are taken off first. Real edits touch one
 * region, so this usually reduces a six-hundred word body to a handful of
 * tokens and the table below never gets big.
 */
function runs(before: string[], after: string[]): DiffRun[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1;
  }
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end += 1;
  }

  const head = before.slice(0, start);
  const tail = before.slice(before.length - end);
  const oldMiddle = before.slice(start, before.length - end);
  const newMiddle = after.slice(start, after.length - end);

  const emitted: DiffRun[] = [];
  if (head.length) emitted.push({ type: 'same', text: head.join('') });

  if (oldMiddle.length > MAX_TOKENS || newMiddle.length > MAX_TOKENS) {
    // A wholesale rewrite. Word-matching it would be noise, and dumping both
    // sides whole would spend the whole budget on the removed half and never
    // reach the new text -- which is the half the student actually needs. So
    // each side is bounded here, before the cap can eat one of them.
    const glimpse = (tokens: string[]) => tokens.slice(0, MAX_TOKENS / 8).join('');
    if (oldMiddle.length) emitted.push({ type: 'remove', text: glimpse(oldMiddle) });
    if (newMiddle.length) emitted.push({ type: 'add', text: glimpse(newMiddle) });
  } else {
    const table: number[][] = [];
    for (let i = 0; i <= oldMiddle.length; i++) {
      table.push(new Array(newMiddle.length + 1).fill(0));
    }
    for (let i = oldMiddle.length - 1; i >= 0; i--) {
      for (let j = newMiddle.length - 1; j >= 0; j--) {
        table[i][j] = oldMiddle[i] === newMiddle[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < oldMiddle.length && j < newMiddle.length) {
      if (oldMiddle[i] === newMiddle[j]) {
        emitted.push({ type: 'same', text: oldMiddle[i] }); i++; j++;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        emitted.push({ type: 'remove', text: oldMiddle[i] }); i++;
      } else {
        emitted.push({ type: 'add', text: newMiddle[j] }); j++;
      }
    }
    while (i < oldMiddle.length) { emitted.push({ type: 'remove', text: oldMiddle[i] }); i++; }
    while (j < newMiddle.length) { emitted.push({ type: 'add', text: newMiddle[j] }); j++; }
  }

  if (tail.length) emitted.push({ type: 'same', text: tail.join('') });

  // Adjacent runs of a kind read as one change, not a stutter.
  const merged: DiffRun[] = [];
  for (const run of emitted) {
    const last = merged[merged.length - 1];
    if (last && last.type === run.type) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged;
}

/**
 * Collapse long unchanged stretches, so the eye lands on what moved.
 *
 * A run of unchanged text keeps `context` words at each end; whatever is left
 * between them becomes a `skip` carrying how many words were dropped.
 */
function collapse(list: DiffRun[], context: number): DiffRun[] {
  const out: DiffRun[] = [];
  list.forEach((run, index) => {
    if (run.type !== 'same') { out.push(run); return; }
    const parts = tokenize(run.text);
    const words = parts.filter(isWord).length;
    if (words <= context * 2) { out.push(run); return; }

    const first = index === 0;
    const last = index === list.length - 1;
    // A leading or trailing stretch only needs context on its inner side.
    const head = first ? [] : parts.slice(0, context * 2);
    const tail = last ? [] : parts.slice(-context * 2);
    const hidden = words - (head.filter(isWord).length + tail.filter(isWord).length);

    if (head.length) out.push({ type: 'same', text: head.join('') });
    if (hidden > 0) out.push({ type: 'skip', text: '', words: hidden });
    if (tail.length) out.push({ type: 'same', text: tail.join('') });
  });
  return out;
}

/** Stop once the diff is longer than anyone will read. */
function cap(list: DiffRun[], maxChars: number): DiffRun[] {
  let spent = 0;
  const out: DiffRun[] = [];
  for (const run of list) {
    if (spent >= maxChars) return [...out, { type: 'truncated', text: '' }];
    const room = maxChars - spent;
    if (run.text.length > room) {
      out.push({ ...run, text: run.text.slice(0, room) });
      return [...out, { type: 'truncated', text: '' }];
    }
    out.push(run);
    spent += run.text.length;
  }
  return out;
}

/**
 * The change from one text to another, as runs a renderer can style.
 *
 * Identical texts return an empty list, which is how a caller tells "nothing
 * moved" from "everything moved".
 */
export function diffWords(
  before: string,
  after: string,
  options: { context?: number; maxChars?: number } = {},
): DiffRun[] {
  const from = String(before || '');
  const to = String(after || '');
  if (from === to) return [];
  const context = options.context ?? CONTEXT;
  const maxChars = options.maxChars ?? MAX_CHARS;
  return cap(collapse(runs(tokenize(from), tokenize(to)), context), maxChars);
}

/** How much moved, counted in words rather than runs. */
export function diffStat(before: string, after: string): DiffStat {
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const run of diffWords(before, after, { context: Infinity, maxChars: Infinity })) {
    const words = tokenize(run.text).filter(isWord).length;
    if (run.type === 'add') added += words;
    else if (run.type === 'remove') removed += words;
    else if (run.type === 'same') unchanged += words;
  }
  return { added, removed, unchanged };
}

/**
 * The change in a sentence.
 *
 * This is the line that goes above the diff and into the accessibility label,
 * and it has to stand on its own: a screen reader given the runs alone hears a
 * stream of disconnected fragments, and a collapsed card shows only this.
 */
export function diffSentence(stat: DiffStat): string {
  const unit = (count: number) => (count === 1 ? 'word' : 'words');
  if (stat.added && stat.removed) {
    // The unit is carried once. "34 words added, 12 words removed" is a
    // mouthful read aloud, and this line is read aloud.
    return `${stat.added} ${unit(stat.added)} added, ${stat.removed} removed`;
  }
  if (stat.added) return `${stat.added} ${unit(stat.added)} added`;
  if (stat.removed) return `${stat.removed} ${unit(stat.removed)} removed`;
  return stat.unchanged ? 'spacing only' : 'no change';
}
