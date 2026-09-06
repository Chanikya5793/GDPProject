/**
 * What the device kept of the current thread.
 *
 * The shape changed once: builds before conversations existed stored a bare
 * array of messages. Reading one back has to yield a thread id as well, or the
 * screen shows one conversation while the next turn quietly starts another.
 */
export interface StoredThread<TMessage> {
  conversationId: string | null;
  messages: TMessage[];
}

export function normalizeStoredThread<TMessage>(
  saved: StoredThread<TMessage> | TMessage[] | null | undefined,
): StoredThread<TMessage> {
  if (Array.isArray(saved)) return { conversationId: null, messages: saved };
  return {
    conversationId: saved?.conversationId ?? null,
    messages: saved?.messages ?? [],
  };
}
