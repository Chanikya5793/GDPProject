// Turns the rendered conversation into the history the API accepts.
//
// The assistant asks a clarifying question and acts on the answer, so the
// earlier turns have to travel with each request. They are sent by the client
// rather than kept on the server, so a conversation works without switching on
// chat retention.

/** Matches ChatRequest.history in the API: at most 20 turns, 4000 chars each. */
export const MAX_TURNS = 20
export const MAX_TURN_CHARS = 4000

/**
 * The prior turns worth replaying, oldest first.
 *
 * The opening blurb is not something the student said, and a failed request is
 * not something the assistant said, so neither belongs in the transcript the
 * model reasons over.
 */
export function toHistory(messages, limit = MAX_TURNS) {
  const turns = []
  for (const message of messages || []) {
    if (message.id === 'welcome' || message.role === 'error') continue
    const text = String(message.text || '').trim()
    if (!text) continue
    turns.push({
      role: message.role === 'user' ? 'user' : 'assistant',
      text: text.slice(0, MAX_TURN_CHARS),
    })
  }
  return limit > 0 ? turns.slice(-limit) : []
}
