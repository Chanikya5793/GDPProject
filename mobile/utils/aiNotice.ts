// The one-time disclosure shown before a student first uses the assistant.
//
// The assistant is on by default, so their tasks and notes reach the model
// provider from the first question. Settings states that, but only for someone
// who goes looking; this is the unprompted version. Mirrors the web notice in
// src/components/AiSidebar.jsx so both clients say the same thing.
//
// Pure, so the wording rules are tested rather than eyeballed: the training
// sentence must appear exactly when the tier trains, and a failed provider
// lookup must not turn the disclosure into silence.

import { AiInfo } from './aiPrivacy';

/** Key in the encrypted store, which is already namespaced per signed-in user. */
export const AI_NOTICE_KEY = 'nw_ai_notice';

export const AI_NOTICE_TITLE = 'Before you start';

/**
 * The paragraphs to show, given whatever the server said about the provider.
 * `null` means the lookup failed — the notice still describes what happens.
 */
export function noticeParagraphs(info: AiInfo | null): string[] {
  const destination = info ? `${info.provider} (${info.model})` : 'the configured AI provider';
  const paragraphs = [
    'The assistant reads the planner records you have not excluded, and sends them '
    + `to ${destination} to answer you.`,
  ];
  if (info?.trains_on_prompts) {
    paragraphs.push(
      'That provider tier permits your questions and the record text sent with them '
      + 'to be used to train its models.',
    );
  }
  paragraphs.push(
    'You can turn the assistant off entirely in Settings, or keep an individual task, '
    + 'reminder or note out of it with its own visibility switch.',
  );
  return paragraphs;
}
