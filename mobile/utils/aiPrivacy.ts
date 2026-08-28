// AI privacy settings rules.
//
// Mirrors the AI Privacy & Indexing section of src/pages/Settings.jsx. The
// cascades matter more than they look: turning the copilot off has to clear
// everything downstream of it, or the server would keep an index and a
// retention window the user believes they just switched off. Kept pure so those
// cascades are tested rather than only clicked through.

/** Record types the backend can index. Matches EntityType in backend/app/models.py. */
export const INDEXABLE_TYPES = ['task', 'reminder', 'note', 'schedule'] as const;

export type IndexableType = (typeof INDEXABLE_TYPES)[number];

export interface AiPrivacy {
  ai_enabled: boolean;
  indexed_entity_types: IndexableType[];
  index_attachments: boolean;
  retain_chat: boolean;
  chat_retention_days: number;
}

/**
 * Everything off — the same defaults the backend applies to a new user.
 *
 * Frozen, list included: this is shared across every caller, and a shallow copy
 * of it would hand out the same array. One caller mutating that list would
 * change what "opted out" means for the rest of the session.
 */
export const DEFAULT_PRIVACY: Readonly<AiPrivacy> = Object.freeze({
  ai_enabled: false,
  indexed_entity_types: Object.freeze([]) as unknown as IndexableType[],
  index_attachments: false,
  retain_chat: false,
  chat_retention_days: 0,
});

/** A fresh, caller-owned copy of the opted-out state. */
export function defaultPrivacy(): AiPrivacy {
  return { ...DEFAULT_PRIVACY, indexed_entity_types: [] };
}

/** Retention windows offered when chats are retained at all. */
export const RETENTION_CHOICES = [7, 30, 90] as const;

const DEFAULT_RETENTION_DAYS = 30;

/**
 * Flip the copilot on or off.
 *
 * Off is a complete opt-out: it clears the indexed types, attachment indexing
 * and chat retention too. Leaving those set would send the server a payload
 * that still described an index the user just opted out of.
 */
export function setAiEnabled(privacy: AiPrivacy, enabled: boolean): AiPrivacy {
  if (!enabled) return defaultPrivacy();
  return { ...privacy, ai_enabled: true };
}

export function toggleIndexedType(privacy: AiPrivacy, type: IndexableType): AiPrivacy {
  const selected = privacy.indexed_entity_types.includes(type);
  return {
    ...privacy,
    indexed_entity_types: selected
      ? privacy.indexed_entity_types.filter(value => value !== type)
      : [...privacy.indexed_entity_types, type],
  };
}

/** Retention days and the retention switch move together, so they cannot disagree. */
export function setRetainChat(privacy: AiPrivacy, retain: boolean): AiPrivacy {
  return {
    ...privacy,
    retain_chat: retain,
    chat_retention_days: retain ? DEFAULT_RETENTION_DAYS : 0,
  };
}

export function setRetentionDays(privacy: AiPrivacy, days: number): AiPrivacy {
  return { ...privacy, retain_chat: days > 0, chat_retention_days: days };
}

export interface AiInfo {
  provider: string;
  model: string;
  trains_on_prompts: boolean;
}

/**
 * What to tell the user about who sees approved records.
 *
 * Read from the server rather than hardcoded so this copy cannot drift from the
 * provider actually deployed.
 */
export function providerNotice(info: AiInfo): string {
  const training = info.trains_on_prompts
    ? 'This provider tier permits your questions and the record text sent with them to be used to train its models.'
    : 'Your questions and record text are not used to train the provider’s models.';
  return `Approved records are processed by ${info.provider} (${info.model}). ${training}`;
}

/** True when nothing at all can reach the provider. */
export function isFullyOptedOut(privacy: AiPrivacy): boolean {
  return !privacy.ai_enabled;
}

/** A short summary of what is currently exposed, for the section subtitle. */
export function privacySummary(privacy: AiPrivacy): string {
  if (!privacy.ai_enabled) return 'Copilot is off. Nothing is indexed or sent.';
  const count = privacy.indexed_entity_types.length;
  if (count === 0) return 'Copilot is on, but no record types are indexed.';
  const types = `${count} record type${count === 1 ? '' : 's'} indexed`;
  return privacy.retain_chat
    ? `${types} · chats kept ${privacy.chat_retention_days} days`
    : `${types} · chats not retained`;
}
