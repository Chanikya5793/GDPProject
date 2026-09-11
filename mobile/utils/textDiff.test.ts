import { describe, expect, it } from 'vitest';

import { DiffRun, diffSentence, diffStat, diffWords } from './textDiff';

const text = (runs: DiffRun[]) => runs.map(run => run.text).join('');
const kinds = (runs: DiffRun[]) => runs.map(run => run.type);

describe('diffWords', () => {
  it('says nothing moved when nothing moved', () => {
    expect(diffWords('same text', 'same text')).toEqual([])
    expect(diffWords('', '')).toEqual([])
  })

  it('marks only the words that changed', () => {
    const runs = diffWords('the lab report is due friday', 'the lab report is due monday')
    expect(kinds(runs)).toEqual(['same', 'remove', 'add'])
    expect(runs.find(run => run.type === 'remove')!.text).toContain('friday')
    expect(runs.find(run => run.type === 'add')!.text).toContain('monday')
  })

  it('reads as all added when there was nothing before', () => {
    const runs = diffWords('', 'brand new note')
    expect(kinds(runs)).toEqual(['add'])
    expect(text(runs)).toBe('brand new note')
  })

  it('reads as all removed when everything went', () => {
    expect(kinds(diffWords('some old text', ''))).toEqual(['remove'])
  })

  it('keeps whitespace so the runs rejoin into the original', () => {
    const runs = diffWords('one two three', 'one two three four')
    expect(text(runs).replace(/\s+$/, '')).toContain('one two three')
  })

  it('collapses a long unchanged stretch rather than reprinting it', () => {
    const filler = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ')
    const runs = diffWords(`start ${filler} old`, `start ${filler} new`)
    const skip = runs.find(run => run.type === 'skip')
    expect(skip).toBeDefined()
    expect(skip!.words).toBeGreaterThan(0)
  })

  it('caps a diff longer than anyone will read', () => {
    const before = Array.from({ length: 400 }, (_, i) => `a${i}`).join(' ')
    const after = Array.from({ length: 400 }, (_, i) => `b${i}`).join(' ')
    const runs = diffWords(before, after)
    expect(runs[runs.length - 1].type).toBe('truncated')
    expect(text(runs).length).toBeLessThanOrEqual(1300)
  })

  it('gives up gracefully on a wholesale rewrite rather than grinding', () => {
    const before = Array.from({ length: 2000 }, (_, i) => `a${i}`).join(' ')
    const after = Array.from({ length: 2000 }, (_, i) => `b${i}`).join(' ')
    const runs = diffWords(before, after)
    expect(kinds(runs)).toContain('remove')
    expect(kinds(runs)).toContain('add')
  })

  it('handles a change at the very start and the very end', () => {
    expect(kinds(diffWords('old middle bit', 'new middle bit'))).toEqual(['remove', 'add', 'same'])
    expect(kinds(diffWords('middle bit old', 'middle bit new'))).toEqual(['same', 'remove', 'add'])
  })
})

describe('diffStat', () => {
  it('counts words rather than runs', () => {
    expect(diffStat('a b c', 'a b c d e')).toEqual({ added: 2, removed: 0, unchanged: 3 })
    expect(diffStat('a b c d', 'a d')).toEqual({ added: 0, removed: 2, unchanged: 2 })
  })

  it('is zero either way when the text is unchanged', () => {
    expect(diffStat('same', 'same')).toEqual({ added: 0, removed: 0, unchanged: 0 })
  })
})

describe('diffSentence', () => {
  it('reads as a sentence a person or a screen reader can use', () => {
    expect(diffSentence({ added: 34, removed: 12, unchanged: 100 })).toBe('34 words added, 12 removed')
    expect(diffSentence({ added: 1, removed: 0, unchanged: 4 })).toBe('1 word added')
    expect(diffSentence({ added: 0, removed: 1, unchanged: 4 })).toBe('1 word removed')
  })

  it('distinguishes a whitespace-only edit from no edit at all', () => {
    expect(diffSentence({ added: 0, removed: 0, unchanged: 9 })).toBe('spacing only')
    expect(diffSentence({ added: 0, removed: 0, unchanged: 0 })).toBe('no change')
  })
})

describe('parity with the web implementation', () => {
  it('produces the same runs for the same edit, so a diff reads the same on both', () => {
    // The fixture is shared with src/utils/textDiff.test.js on purpose. If one
    // side is changed without the other, this is what says so.
    const before = 'Titration steps: rinse the burette, fill to zero, add indicator.';
    const after = 'Titration steps: rinse the burette twice, fill to zero, then add indicator.';

    expect(diffWords(before, after).map(run => [run.type, run.text])).toEqual([
      ['same', 'Titration steps: rinse the burette'],
      ['add', ' twice'],
      ['same', ', fill to zero, '],
      ['add', 'then '],
      ['same', 'add indicator.'],
    ]);
    expect(diffSentence(diffStat(before, after))).toBe('2 words added');
  });
});
