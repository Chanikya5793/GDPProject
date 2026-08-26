// A small markdown parser for note bodies.
//
// The web app renders the same subset by regex-replacing into an HTML string
// (src/pages/Notes.jsx renderMarkdown). React Native has no HTML renderer, so
// this parses into a token tree the Notes screen maps onto <Text> instead.
// Keeping it a parser rather than a string transform also means the rules can be
// tested directly, and there is no innerHTML anywhere near user content.
//
// Supported, matching web: # ## ### headings, **bold**, *italic*, `code`,
// > blockquote, - bullets, 1. numbered lists.

export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'code'; value: string };

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; spans: InlineToken[] }
  | { type: 'quote'; spans: InlineToken[] }
  | { type: 'bullet'; spans: InlineToken[] }
  | { type: 'numbered'; index: number; spans: InlineToken[] }
  | { type: 'paragraph'; spans: InlineToken[] }
  | { type: 'blank' };

// Ordered so the greedier delimiter wins: ** must be tried before *, or bold
// would parse as two empty italics.
const INLINE_PATTERN = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

export function parseInline(text: string): InlineToken[] {
  if (!text) return [];
  const tokens: InlineToken[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      tokens.push({ type: 'text', value: text.slice(lastIndex, start) });
    }
    const raw = match[0];
    if (raw.startsWith('**')) tokens.push({ type: 'bold', value: raw.slice(2, -2) });
    else if (raw.startsWith('`')) tokens.push({ type: 'code', value: raw.slice(1, -1) });
    else tokens.push({ type: 'italic', value: raw.slice(1, -1) });
    lastIndex = start + raw.length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return tokens;
}

export function parseMarkdown(body: string): Block[] {
  if (!body) return [];
  return body.split('\n').map<Block>(line => {
    const trimmed = line.trimEnd();
    if (!trimmed.trim()) return { type: 'blank' };

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      return {
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        spans: parseInline(heading[2]),
      };
    }

    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) return { type: 'quote', spans: parseInline(quote[1]) };

    const bullet = /^[-*]\s+(.*)$/.exec(trimmed);
    if (bullet) return { type: 'bullet', spans: parseInline(bullet[1]) };

    const numbered = /^(\d+)\.\s+(.*)$/.exec(trimmed);
    if (numbered) {
      return {
        type: 'numbered',
        index: Number(numbered[1]),
        spans: parseInline(numbered[2]),
      };
    }

    return { type: 'paragraph', spans: parseInline(trimmed) };
  });
}

/** True when the body uses any supported syntax — used to offer a preview toggle. */
export function hasMarkdown(body: string): boolean {
  if (!body) return false;
  return parseMarkdown(body).some(block =>
    block.type !== 'paragraph' && block.type !== 'blank'
      ? true
      : block.type === 'paragraph' && block.spans.some(span => span.type !== 'text'),
  );
}
