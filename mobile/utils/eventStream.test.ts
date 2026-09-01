import { describe, expect, it, vi } from 'vitest';
import { EventStreamError, StreamTransport, readEventStream } from './eventStream';
import { SseEvent } from './sse';

/**
 * Mimics React Native's XMLHttpRequest: responseText accumulates the whole body
 * received so far, and progress fires per chunk rather than per event.
 */
class FakeTransport implements StreamTransport {
  status = 200;
  responseText = '';
  onprogress: ((event: ProgressEvent) => unknown) | null = null;
  onload: ((event: ProgressEvent) => unknown) | null = null;
  onerror: ((event: ProgressEvent) => unknown) | null = null;
  onabort: ((event: ProgressEvent) => unknown) | null = null;
  ontimeout: ((event: ProgressEvent) => unknown) | null = null;
  opened: [string, string] | null = null;
  headers: Record<string, string> = {};
  sent: string | undefined;
  aborted = false;

  open(method: string, url: string) { this.opened = [method, url]; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body?: string) { this.sent = body; }
  abort() { this.aborted = true; this.onabort?.({} as ProgressEvent); }

  /** Append to the accumulated body and fire progress, as the native side does. */
  push(chunk: string) {
    this.responseText += chunk;
    this.onprogress?.({} as ProgressEvent);
  }

  finish() { this.onload?.({} as ProgressEvent); }
}

const BODY =
  'event: delta\ndata: {"text":"Start "}\n\n' +
  'event: delta\ndata: {"text":"here."}\n\n' +
  'event: final\ndata: {"answer":"Start here.","citations":[],"proposals":[]}\n\n';

function run(transport: StreamTransport, signal?: AbortSignal) {
  const events: SseEvent[] = [];
  const done = readEventStream(
    transport,
    { url: 'https://api.test/v1/copilot/chat/stream', headers: { Authorization: 'Bearer t' }, body: '{}', signal },
    event => events.push(event),
  );
  return { events, done };
}

describe('readEventStream', () => {
  it('delivers events as chunks arrive, not only at the end', async () => {
    const transport = new FakeTransport();
    const { events, done } = run(transport);
    transport.push('event: delta\ndata: {"text":"Start "}\n\n');
    // The decisive assertion: text is already available mid-request.
    expect(events).toHaveLength(1);
    transport.push('event: final\ndata: {"answer":"Start"}\n\n');
    expect(events).toHaveLength(2);
    transport.finish();
    await expect(done).resolves.toBeUndefined();
  });

  it('slices the accumulated body so no text is delivered twice', async () => {
    // React Native resends the whole body each progress event; without the
    // offset every chunk would repeat everything before it.
    const transport = new FakeTransport();
    const { events, done } = run(transport);
    for (let i = 0; i < BODY.length; i += 9) transport.push(BODY.slice(i, i + 9));
    transport.finish();
    await done;
    const text = events.filter(e => e.event === 'delta').map(e => (e.data as { text: string }).text).join('');
    expect(text).toBe('Start here.');
    expect(events.filter(e => e.event === 'final')).toHaveLength(1);
  });

  it('sets the request up before sending', async () => {
    const transport = new FakeTransport();
    const { done } = run(transport);
    expect(transport.opened).toEqual(['POST', 'https://api.test/v1/copilot/chat/stream']);
    expect(transport.headers.Authorization).toBe('Bearer t');
    expect(transport.sent).toBe('{}');
    transport.finish();
    await done;
  });

  it('rejects with the server status so 429 stays distinguishable', async () => {
    const transport = new FakeTransport();
    const { done } = run(transport);
    transport.status = 429;
    transport.responseText = JSON.stringify({ detail: 'Retry in 152 seconds.', code: 'rate_limited' });
    transport.finish();
    await expect(done).rejects.toMatchObject({ status: 429, code: 'rate_limited', message: 'Retry in 152 seconds.' });
  });

  it('does not parse an error body as events', async () => {
    const transport = new FakeTransport();
    const { events, done } = run(transport);
    transport.status = 403;
    transport.push('{"detail":"AI is disabled"}');
    transport.finish();
    await expect(done).rejects.toBeInstanceOf(EventStreamError);
    expect(events).toEqual([]);
  });

  it('falls back to a status message when the error body is not JSON', async () => {
    const transport = new FakeTransport();
    const { done } = run(transport);
    transport.status = 502;
    transport.responseText = '<html>bad gateway</html>';
    transport.finish();
    await expect(done).rejects.toMatchObject({ status: 502, message: 'Planner request failed (502)' });
  });

  it('reports a dropped connection', async () => {
    const transport = new FakeTransport();
    const { done } = run(transport);
    transport.onerror?.({} as ProgressEvent);
    await expect(done).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('releases a trailing frame that arrived without its blank line', async () => {
    const transport = new FakeTransport();
    const { events, done } = run(transport);
    transport.push('event: final\ndata: {"answer":"done"}');
    expect(events).toEqual([]);
    transport.finish();
    await done;
    expect(events).toEqual([{ event: 'final', data: { answer: 'done' } }]);
  });

  it('still delivers every event if progress never fires at all', async () => {
    // If a platform or a proxy buffers the body and hands it over only at the
    // end, this degrades to the non-streaming behaviour rather than losing the
    // answer. Worth pinning: it is the safety net under the whole feature.
    const transport = new FakeTransport();
    const { events, done } = run(transport);
    transport.responseText = BODY;
    transport.finish();
    await done;
    expect(events.map(e => e.event)).toEqual(['delta', 'delta', 'final']);
    expect((events[2].data as { answer: string }).answer).toBe('Start here.');
  });

  it('aborts the transport when the signal fires, and resolves', async () => {
    const transport = new FakeTransport();
    const controller = new AbortController();
    const { done } = run(transport, controller.signal);
    transport.push('event: delta\ndata: {"text":"partial"}\n\n');
    controller.abort();
    expect(transport.aborted).toBe(true);
    await expect(done).resolves.toBeUndefined();
  });

  it('does not send at all when the signal is already aborted', async () => {
    const transport = new FakeTransport();
    const controller = new AbortController();
    controller.abort();
    const { done } = run(transport, controller.signal);
    await expect(done).resolves.toBeUndefined();
    expect(transport.sent).toBeUndefined();
  });

  it('stops listening to the signal once the answer is done', async () => {
    const transport = new FakeTransport();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const { done } = run(transport, controller.signal);
    transport.finish();
    await done;
    expect(remove).toHaveBeenCalled();
  });
});
