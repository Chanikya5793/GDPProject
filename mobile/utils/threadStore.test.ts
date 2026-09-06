import { describe, expect, it } from 'vitest';
import { normalizeStoredThread } from './threadStore';

describe('reading the thread the device kept', () => {
  it('keeps the id alongside the messages', () => {
    expect(normalizeStoredThread({ conversationId: 'c1', messages: [{ id: 'a' }] })).toEqual({
      conversationId: 'c1', messages: [{ id: 'a' }],
    });
  });

  it('reads a build that stored a bare array, without a thread', () => {
    // Anything written before conversations existed. Treating it as a thread
    // would attach old messages to whatever id happened to be current.
    expect(normalizeStoredThread([{ id: 'a' }, { id: 'b' }])).toEqual({
      conversationId: null, messages: [{ id: 'a' }, { id: 'b' }],
    });
  });

  it('survives nothing being stored at all', () => {
    expect(normalizeStoredThread(null)).toEqual({ conversationId: null, messages: [] });
    expect(normalizeStoredThread(undefined)).toEqual({ conversationId: null, messages: [] });
  });

  it('never returns undefined for the id, so a falsy check is enough', () => {
    expect(normalizeStoredThread({ conversationId: null, messages: [] }).conversationId).toBeNull();
  });
});
