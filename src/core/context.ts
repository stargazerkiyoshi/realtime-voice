export interface HistoryItem {
  role: 'user' | 'assistant' | 'tool';
  content: string;
}

export class ConversationContext {
  history: HistoryItem[] = [];
  turnId = 0;
  meta: Record<string, unknown> = {};
}
