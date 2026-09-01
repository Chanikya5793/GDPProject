import { describe, expect, it } from 'vitest';
import { createSseParser, SseEvent } from './sse';

/** Feed a body in fixed-size pieces, as a socket would deliver it. */
function drip(body: string, size: number): SseEvent[] {
  const parser = createSseParser();
  const events: SseEvent[] = [];
  for (let i = 0; i < body.length; i += size) events.push(...parser.push(body.slice(i, i + size)));
  events.push(...parser.flush());
  return events;
}

const BODY =
  'event: delta\ndata: {"text":"Start "}\n\n' +
  'event: delta\ndata: {"text":"here."}\n\n' +
  'event: final\ndata: {"answer":"Start here.","citations":[]}\n\n';

describe('createSseParser', () => {
  it.each([1, 2, 3, 7, 40, 5000])('reassembles frames split every %i characters', size => {
    const events = drip(BODY, size);
    expect(events.map(e => e.event)).toEqual(['delta', 'delta', 'final']);
    expect(events.map(e => (e.data as { text?: string }).text).filter(Boolean).join('')).toBe('Start here.');
  });

  it('holds a partial frame back rather than emitting half an event', () => {
    const parser = createSseParser();
    expect(parser.push('event: delta\ndata: {"text":"par')).toEqual([]);
    expect(parser.push('tial"}\n\n')).toEqual([{ event: 'delta', data: { text: 'partial' } }]);
  });

  it('accepts CRLF line endings', () => {
    const parser = createSseParser();
    expect(parser.push('event: final\r\ndata: {"answer":"ok"}\r\n\r\n')).toEqual([
      { event: 'final', data: { answer: 'ok' } },
    ]);
  });

  it('skips a malformed frame instead of failing the answer', () => {
    const parser = createSseParser();
    const events = parser.push('event: delta\ndata: nope\n\nevent: delta\ndata: {"text":"fine"}\n\n');
    expect(events).toEqual([{ event: 'delta', data: { text: 'fine' } }]);
  });

  it('releases a trailing frame that never got its blank line', () => {
    const parser = createSseParser();
    expect(parser.push('event: final\ndata: {"answer":"done"}')).toEqual([]);
    expect(parser.flush()).toEqual([{ event: 'final', data: { answer: 'done' } }]);
  });

  it('flushes nothing when the body ended cleanly', () => {
    const parser = createSseParser();
    parser.push('event: final\ndata: {"answer":"done"}\n\n');
    expect(parser.flush()).toEqual([]);
  });

  it('keeps text carrying newlines and quotes intact', () => {
    const text = 'Line one\nLine "two"';
    const events = drip(`event: delta\ndata: ${JSON.stringify({ text })}\n\n`, 3);
    expect((events[0].data as { text: string }).text).toBe(text);
  });
});
