import { describe, expect, it } from 'vitest';

import { MAX_TURNS, RenderedMessage, toHistory } from './chatHistory';

const welcome: RenderedMessage = { id: 'welcome', role: 'assistant', text: 'Ask about planner records…' };

describe('toHistory', () => {
  it('keeps both roles as the API expects them', () => {
    expect(toHistory([
      { id: '1', role: 'user', text: 'Hi' },
      { id: '2', role: 'assistant', text: 'Hello' },
    ])).toEqual([
      { role: 'user', text: 'Hi' },
      { role: 'assistant', text: 'Hello' },
    ]);
  });

  it('drops the opening blurb, which the student never said', () => {
    expect(toHistory([welcome, { id: '1', role: 'user', text: 'Hi' }]))
      .toEqual([{ role: 'user', text: 'Hi' }]);
  });

  it('drops failed requests', () => {
    // An error is the app talking about itself, not a turn in the conversation.
    expect(toHistory([
      { id: '1', role: 'user', text: 'Hi' },
      { id: '2', role: 'error', text: 'The copilot request failed.' },
    ])).toEqual([{ role: 'user', text: 'Hi' }]);
  });

  it('drops empty and whitespace-only turns', () => {
    expect(toHistory([{ id: '1', role: 'user', text: '   ' }])).toEqual([]);
  });

  it('keeps the most recent turns when the conversation is long', () => {
    const many: RenderedMessage[] = Array.from({ length: 30 }, (_, i) => ({
      id: String(i), role: 'user', text: `m${i}`,
    }));
    const history = toHistory(many);
    expect(history).toHaveLength(MAX_TURNS);
    expect(history[history.length - 1].text).toBe('m29');
    expect(history[0].text).toBe('m10');
  });

  it('truncates a turn past the length the API accepts', () => {
    expect(toHistory([{ id: '1', role: 'user', text: 'x'.repeat(5000) }])[0].text)
      .toHaveLength(4000);
  });

  it('survives an empty or missing conversation', () => {
    expect(toHistory([])).toEqual([]);
    expect(toHistory(undefined)).toEqual([]);
  });
});
