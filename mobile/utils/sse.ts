export interface SseEvent {
  event: string;
  data: unknown;
}

function parseBlock(block: string): SseEvent | null {
  let name = 'message';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  if (!data.length) return null;
  try {
    return { event: name, data: JSON.parse(data.join('\n')) };
  } catch {
    // A malformed frame is not worth failing the whole answer over.
    return null;
  }
}

/**
 * Incremental Server-Sent Events reader.
 *
 * Events are separated by a blank line, and the transport decides where the
 * bytes break, so whatever follows the last blank line is a partial frame and
 * has to stay buffered until the rest of it lands. `flush` releases a trailing
 * frame that arrived without its blank line.
 */
export function createSseParser() {
  let buffer = '';
  return {
    push(chunk: string): SseEvent[] {
      buffer += chunk;
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      return blocks
        .filter(block => block.trim())
        .map(parseBlock)
        .filter((event): event is SseEvent => event !== null);
    },
    flush(): SseEvent[] {
      const rest = buffer.trim();
      buffer = '';
      if (!rest) return [];
      const parsed = parseBlock(rest);
      return parsed ? [parsed] : [];
    },
  };
}
