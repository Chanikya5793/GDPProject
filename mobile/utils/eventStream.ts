import { createSseParser, SseEvent } from './sse';

/**
 * The slice of XMLHttpRequest this needs, so a test can supply a fake.
 *
 * The handlers take the event argument XMLHttpRequest passes, otherwise a real
 * one is not assignable to this; the reader itself ignores it.
 */
type TransportHandler = ((event: ProgressEvent) => unknown) | null;

export interface StreamTransport {
  status: number;
  responseText: string;
  onprogress: TransportHandler;
  onload: TransportHandler;
  onerror: TransportHandler;
  onabort: TransportHandler;
  ontimeout: TransportHandler;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body?: string): void;
  abort(): void;
}

export class EventStreamError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'EventStreamError';
    this.status = status;
    this.code = code;
  }
}

export interface EventStreamRequest {
  url: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/**
 * Read a Server-Sent Events response over an XMLHttpRequest-shaped transport.
 *
 * React Native's fetch is the whatwg-fetch polyfill over XHR and does not expose
 * `response.body`, so there is no reader to pull from; without this the answer
 * would only be delivered once it was already complete.
 *
 * A failure that happens before the stream starts rejects with the status the
 * server sent, so 403 and 429 stay distinguishable from a mid-answer failure.
 */
export function readEventStream(
  transport: StreamTransport,
  request: EventStreamRequest,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (request.signal?.aborted) {
      resolve();
      return;
    }
    const parser = createSseParser();
    let delivered = 0;

    const drain = () => {
      // React Native hands back the whole body received so far, not just the
      // new bytes, so the already-delivered prefix is sliced off each time.
      const text = transport.responseText;
      if (text.length <= delivered) return;
      const chunk = text.slice(delivered);
      delivered = text.length;
      for (const event of parser.push(chunk)) onEvent(event);
    };

    const onAbort = () => transport.abort();
    const cleanup = () => request.signal?.removeEventListener?.('abort', onAbort);
    const fail = (error: EventStreamError) => {
      cleanup();
      reject(error);
    };

    // Assigning onprogress is what makes React Native emit incremental LOADING
    // events at all. Without a listener it delivers the body once, at the end,
    // and the answer would arrive as a single lump.
    transport.onprogress = () => {
      if (transport.status === 200) drain();
    };
    transport.onerror = () => fail(new EventStreamError('The copilot connection failed.', 0, 'network'));
    transport.ontimeout = () => fail(new EventStreamError('The copilot took too long to answer.', 504, 'timeout'));
    transport.onabort = () => {
      cleanup();
      resolve();
    };
    transport.onload = () => {
      if (transport.status >= 400) {
        let detail = `Planner request failed (${transport.status})`;
        let code: string | undefined;
        try {
          const payload = JSON.parse(transport.responseText) as { detail?: string; code?: string };
          if (payload.detail) detail = payload.detail;
          code = payload.code;
        } catch {
          // A non-JSON error body leaves the status-derived message in place.
        }
        fail(new EventStreamError(detail, transport.status, code));
        return;
      }
      drain();
      for (const event of parser.flush()) onEvent(event);
      cleanup();
      resolve();
    };

    transport.open('POST', request.url);
    for (const [name, value] of Object.entries(request.headers)) {
      transport.setRequestHeader(name, value);
    }
    request.signal?.addEventListener?.('abort', onAbort);
    transport.send(request.body);
  });
}
