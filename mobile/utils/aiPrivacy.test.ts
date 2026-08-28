import { describe, expect, it } from 'vitest';

import {
  AiPrivacy, defaultPrivacy, DEFAULT_PRIVACY, INDEXABLE_TYPES, isFullyOptedOut, privacySummary,
  providerNotice, RETENTION_CHOICES, setAiEnabled, setRetainChat, setRetentionDays,
  toggleIndexedType,
} from './aiPrivacy';

const on: AiPrivacy = {
  ai_enabled: true,
  indexed_entity_types: ['task', 'note'],
  index_attachments: true,
  retain_chat: true,
  chat_retention_days: 30,
};

describe('defaults', () => {
  it('starts fully opted out', () => {
    expect(DEFAULT_PRIVACY).toEqual({
      ai_enabled: false,
      indexed_entity_types: [],
      index_attachments: false,
      retain_chat: false,
      chat_retention_days: 0,
    });
  });

  it('offers the four record types the backend can index', () => {
    expect([...INDEXABLE_TYPES]).toEqual(['task', 'reminder', 'note', 'schedule']);
  });

  it('offers the three retention windows', () => {
    expect([...RETENTION_CHOICES]).toEqual([7, 30, 90]);
  });
});

describe('setAiEnabled', () => {
  it('turning it off clears everything downstream', () => {
    // A complete opt-out. Leaving the types or the retention window set would
    // send the server a payload still describing an index the user just left.
    expect(setAiEnabled(on, false)).toEqual(defaultPrivacy());
  });

  it('turning it on does not silently opt anything in', () => {
    const enabled = setAiEnabled(DEFAULT_PRIVACY, true);
    expect(enabled.ai_enabled).toBe(true);
    expect(enabled.indexed_entity_types).toEqual([]);
    expect(enabled.index_attachments).toBe(false);
    expect(enabled.retain_chat).toBe(false);
  });

  it('keeps the existing selections when re-enabling an already-on setting', () => {
    expect(setAiEnabled(on, true)).toEqual(on);
  });

  it('does not mutate the input', () => {
    const before = { ...on, indexed_entity_types: [...on.indexed_entity_types] };
    setAiEnabled(on, false);
    expect(on).toEqual(before);
  });

  it('returns a caller-owned list, not the shared default one', () => {
    // A shallow copy of DEFAULT_PRIVACY would hand back its array, so pushing
    // to the result would redefine "opted out" for the rest of the session.
    const cleared = setAiEnabled(on, false);
    cleared.indexed_entity_types.push('task');
    expect(DEFAULT_PRIVACY.indexed_entity_types).toEqual([]);
    expect(defaultPrivacy().indexed_entity_types).toEqual([]);
  });

  it('hands out a distinct list on every call', () => {
    expect(defaultPrivacy().indexed_entity_types)
      .not.toBe(defaultPrivacy().indexed_entity_types);
  });
});

describe('toggleIndexedType', () => {
  it('adds a type that is not selected', () => {
    expect(toggleIndexedType(on, 'reminder').indexed_entity_types)
      .toEqual(['task', 'note', 'reminder']);
  });

  it('removes a type that is selected', () => {
    expect(toggleIndexedType(on, 'task').indexed_entity_types).toEqual(['note']);
  });

  it('round-trips back to the original selection', () => {
    const there = toggleIndexedType(on, 'schedule');
    expect(toggleIndexedType(there, 'schedule').indexed_entity_types)
      .toEqual(on.indexed_entity_types);
  });

  it('does not mutate the input list', () => {
    toggleIndexedType(on, 'schedule');
    expect(on.indexed_entity_types).toEqual(['task', 'note']);
  });

  it('leaves the other fields alone', () => {
    const next = toggleIndexedType(on, 'schedule');
    expect(next.ai_enabled).toBe(true);
    expect(next.retain_chat).toBe(true);
    expect(next.chat_retention_days).toBe(30);
  });
});

describe('setRetainChat', () => {
  it('gives a default window when retention is switched on', () => {
    const next = setRetainChat(DEFAULT_PRIVACY, true);
    expect(next.retain_chat).toBe(true);
    expect(next.chat_retention_days).toBe(30);
  });

  it('zeroes the window when retention is switched off', () => {
    // The switch and the window must never disagree: retain_chat false with a
    // non-zero window would read as "kept for 30 days" on the next load.
    const next = setRetainChat(on, false);
    expect(next.retain_chat).toBe(false);
    expect(next.chat_retention_days).toBe(0);
  });
});

describe('setRetentionDays', () => {
  it('keeps retention on for a positive window', () => {
    expect(setRetentionDays(on, 90)).toMatchObject({ retain_chat: true, chat_retention_days: 90 });
  });

  it('treats a zero window as switching retention off', () => {
    expect(setRetentionDays(on, 0)).toMatchObject({ retain_chat: false, chat_retention_days: 0 });
  });
});

describe('providerNotice', () => {
  it('warns plainly when the tier trains on prompts', () => {
    const notice = providerNotice({ provider: 'Meta', model: 'muse-contributor', trains_on_prompts: true });
    expect(notice).toContain('Meta');
    expect(notice).toContain('muse-contributor');
    expect(notice).toContain('used to train');
  });

  it('says so when the tier does not train on prompts', () => {
    const notice = providerNotice({ provider: 'Meta', model: 'muse', trains_on_prompts: false });
    expect(notice).toContain('not used to train');
  });
});

describe('isFullyOptedOut', () => {
  it('is true only when the copilot is off', () => {
    expect(isFullyOptedOut(DEFAULT_PRIVACY)).toBe(true);
    expect(isFullyOptedOut(on)).toBe(false);
  });
});

describe('privacySummary', () => {
  it('says nothing is exposed when the copilot is off', () => {
    expect(privacySummary(DEFAULT_PRIVACY)).toBe('Copilot is off. Nothing is indexed or sent.');
  });

  it('calls out an enabled copilot with no indexed types', () => {
    expect(privacySummary({ ...DEFAULT_PRIVACY, ai_enabled: true }))
      .toBe('Copilot is on, but no record types are indexed.');
  });

  it('counts the indexed types and the retention window', () => {
    expect(privacySummary(on)).toBe('2 record types indexed · chats kept 30 days');
  });

  it('says when chats are not retained', () => {
    expect(privacySummary({ ...on, retain_chat: false, chat_retention_days: 0 }))
      .toBe('2 record types indexed · chats not retained');
  });

  it('does not pluralise a single type', () => {
    expect(privacySummary({ ...on, indexed_entity_types: ['task'] }))
      .toBe('1 record type indexed · chats kept 30 days');
  });
});
