// Note attachment rules. Pure, so the size cap and list mutations are tested
// rather than only exercised through the picker.
//
// Attachments live only on the device: they are held as data URIs inside the
// encrypted note store and are never sent to the planner backend. Web does the
// same — it uploads only the extracted text of text/* files, never the binary.

import { NoteAttachment } from '@/types';

/** Matches web's per-file cap. These sit in device storage, base64-encoded. */
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

/** Rough decoded size of a base64 data URI, without materialising the bytes. */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  if (!base64) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function isWithinSizeLimit(bytes: number): boolean {
  return bytes > 0 && bytes <= MAX_ATTACHMENT_BYTES;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function addAttachment(
  existing: NoteAttachment[] | undefined,
  attachment: NoteAttachment,
): NoteAttachment[] {
  // New array rather than push: the note's own array is what the activity log
  // diffs against, so mutating in place would hide the change.
  return [...(existing || []), attachment];
}

export function removeAttachment(
  existing: NoteAttachment[] | undefined,
  id: string,
): NoteAttachment[] {
  return (existing || []).filter(attachment => attachment.id !== id);
}

/**
 * Keep whichever list actually has attachments, preferring the local one.
 *
 * The backend never receives attachments, so a record returned by the server
 * carries none. Overwriting the cache with it would delete every attachment the
 * moment a sync succeeded.
 */
export function preserveAttachments(
  local: NoteAttachment[] | undefined,
  fromServer: NoteAttachment[] | undefined,
): NoteAttachment[] | undefined {
  return local && local.length > 0 ? local : fromServer;
}
