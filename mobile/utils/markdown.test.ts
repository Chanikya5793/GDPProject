import { describe, expect, it } from 'vitest';

import { Block, hasMarkdown, parseInline, parseMarkdown } from './markdown';

const spansOf = (block: Block) => ('spans' in block ? block.spans : []);
const textOf = (block: Block) => spansOf(block).map(s => s.value).join('');

describe('parseInline', () => {
  it('returns a single text token for plain prose', () => {
    expect(parseInline('just words')).toEqual([{ type: 'text', value: 'just words' }]);
  });

  it('parses bold, italic, and code', () => {
    expect(parseInline('**b**')).toEqual([{ type: 'bold', value: 'b' }]);
    expect(parseInline('*i*')).toEqual([{ type: 'italic', value: 'i' }]);
    expect(parseInline('`c`')).toEqual([{ type: 'code', value: 'c' }]);
  });

  it('prefers bold over italic so ** does not parse as two empty italics', () => {
    expect(parseInline('**bold**')).toEqual([{ type: 'bold', value: 'bold' }]);
  });

  it('keeps the surrounding text around a span', () => {
    expect(parseInline('a **b** c')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'bold', value: 'b' },
      { type: 'text', value: ' c' },
    ]);
  });

  it('handles several spans in one line', () => {
    expect(parseInline('**b** and *i* and `c`').map(t => t.type))
      .toEqual(['bold', 'text', 'italic', 'text', 'code']);
  });

  it('leaves unmatched delimiters as literal text', () => {
    // A stray asterisk is far more likely a typo than an intent to format.
    expect(parseInline('2 * 3 = 6')).toEqual([{ type: 'text', value: '2 * 3 = 6' }]);
    expect(parseInline('**unclosed')).toEqual([{ type: 'text', value: '**unclosed' }]);
  });

  it('returns nothing for an empty string', () => {
    expect(parseInline('')).toEqual([]);
  });
});

describe('parseMarkdown', () => {
  it('parses the three heading levels', () => {
    const blocks = parseMarkdown('# one\n## two\n### three');
    expect(blocks.map(b => b.type)).toEqual(['heading', 'heading', 'heading']);
    expect(blocks.map(b => (b.type === 'heading' ? b.level : 0))).toEqual([1, 2, 3]);
    expect(blocks.map(textOf)).toEqual(['one', 'two', 'three']);
  });

  it('does not treat a bare # as a heading', () => {
    // "#hashtag" is not a heading; web's regex requires the space too.
    expect(parseMarkdown('#hashtag')[0].type).toBe('paragraph');
  });

  it('parses blockquotes with or without a space', () => {
    expect(parseMarkdown('> quoted')[0].type).toBe('quote');
    expect(textOf(parseMarkdown('> quoted')[0])).toBe('quoted');
    expect(parseMarkdown('>tight')[0].type).toBe('quote');
  });

  it('parses bullets with either marker', () => {
    expect(parseMarkdown('- one\n* two').map(b => b.type)).toEqual(['bullet', 'bullet']);
  });

  it('parses numbered items and keeps their number', () => {
    const blocks = parseMarkdown('1. first\n7. seventh');
    expect(blocks.map(b => (b.type === 'numbered' ? b.index : null))).toEqual([1, 7]);
  });

  it('keeps blank lines as their own block so paragraphs stay separated', () => {
    expect(parseMarkdown('a\n\nb').map(b => b.type)).toEqual(['paragraph', 'blank', 'paragraph']);
  });

  it('applies inline formatting inside block types', () => {
    const [heading] = parseMarkdown('## a **bold** title');
    expect(spansOf(heading).map(s => s.type)).toEqual(['text', 'bold', 'text']);
  });

  it('returns nothing for an empty body', () => {
    expect(parseMarkdown('')).toEqual([]);
  });

  it('does not mistake a dash inside a sentence for a bullet', () => {
    expect(parseMarkdown('well - actually')[0].type).toBe('paragraph');
  });
});

describe('hasMarkdown', () => {
  it('is false for plain prose and empty bodies', () => {
    expect(hasMarkdown('')).toBe(false);
    expect(hasMarkdown('just a normal note')).toBe(false);
    expect(hasMarkdown('line one\nline two')).toBe(false);
  });

  it('is true for block syntax', () => {
    for (const body of ['# h', '> q', '- b', '1. n']) {
      expect(hasMarkdown(body)).toBe(true);
    }
  });

  it('is true for inline syntax inside a paragraph', () => {
    expect(hasMarkdown('some **bold** text')).toBe(true);
    expect(hasMarkdown('some `code` here')).toBe(true);
  });
});
