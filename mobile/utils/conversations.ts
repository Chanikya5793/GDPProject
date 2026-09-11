/** A stored thread, as GET /v1/conversations lists it. */
export interface Conversation {
  conversation_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

/** One turn of a thread, as GET /v1/conversations/{id} returns it. */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;
  citations?: unknown[];
  created_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: ConversationTurn[];
}
