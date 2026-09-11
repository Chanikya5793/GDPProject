import { describe, expect, it } from 'vitest';

import {
  addAttachment, dataUrlBytes, formatBytes, isWithinSizeLimit,
  MAX_ATTACHMENT_BYTES, preserveAttachments, removeAttachment,
} from './attachments';
import { NoteAttachment } from '@/types';

function attachment(id: string, overrides: Partial<NoteAttachment> = {}): NoteAttachment {
  return {
    id, name: `${id}.png`, type: 'image/png', size: 1024,
    dataUrl: 'data:image/png;base64,AAAA', approvedForAi: false, ...overrides,
  };
}

describe('dataUrlBytes', () => {
  it('decodes the byte length from base64 length', () => {
    // "AAAA" is 4 base64 chars with no padding => 3 bytes.
    expect(dataUrlBytes('data:image/png;base64,AAAA')).toBe(3);
  });

  it('accounts for padding', () => {
    expect(dataUrlBytes('data:image/png;base64,AAA=')).toBe(2);
    expect(dataUrlBytes('data:image/png;base64,AA==')).toBe(1);
  });

  it('returns 0 for an empty payload rather than a negative number', () => {
    expect(dataUrlBytes('data:image/png;base64,')).toBe(0);
    expect(dataUrlBytes('')).toBe(0);
  });
});

describe('isWithinSizeLimit', () => {
  it('accepts a normal file and rejects an oversized one', () => {
    expect(isWithinSizeLimit(1024)).toBe(true);
    expect(isWithinSizeLimit(MAX_ATTACHMENT_BYTES)).toBe(true);
    expect(isWithinSizeLimit(MAX_ATTACHMENT_BYTES + 1)).toBe(false);
  });

  it('rejects an empty file', () => {
    // A zero-byte read means the pick failed; storing it would be a dead entry.
    expect(isWithinSizeLimit(0)).toBe(false);
  });
});

describe('formatBytes', () => {
  it('scales the unit to the size', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1536 * 1024)).toBe('1.5 MB');
  });
});

describe('addAttachment / removeAttachment', () => {
  it('appends to an existing list', () => {
    expect(addAttachment([attachment('a')], attachment('b')).map(x => x.id)).toEqual(['a', 'b']);
  });

  it('handles a note with no attachments yet', () => {
    expect(addAttachment(undefined, attachment('a')).map(x => x.id)).toEqual(['a']);
  });

  it('removes by id and leaves the rest', () => {
    const list = [attachment('a'), attachment('b')];
    expect(removeAttachment(list, 'a').map(x => x.id)).toEqual(['b']);
  });

  it('is a no-op when the id is absent', () => {
    expect(removeAttachment([attachment('a')], 'zzz').map(x => x.id)).toEqual(['a']);
  });

  it('does not mutate the input list', () => {
    const list = [attachment('a')];
    addAttachment(list, attachment('b'));
    removeAttachment(list, 'a');
    expect(list.map(x => x.id)).toEqual(['a']);
  });
});

describe('preserveAttachments', () => {
  it('keeps the local list when the server has none', () => {
    // The backend never stores attachments, so this is the normal case — and
    // without it a successful sync would wipe every attachment on the device.
    const local = [attachment('a')];
    expect(preserveAttachments(local, [])).toBe(local);
    expect(preserveAttachments(local, undefined)).toBe(local);
  });

  it('falls back to the server list when nothing is held locally', () => {
    const fromServer = [attachment('s')];
    expect(preserveAttachments([], fromServer)).toBe(fromServer);
    expect(preserveAttachments(undefined, fromServer)).toBe(fromServer);
  });

  it('returns undefined when neither side has any', () => {
    expect(preserveAttachments(undefined, undefined)).toBeUndefined();
  });
});
