import OpenAI from 'openai';
import { config } from '../config';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type InputMessage = ChatMessage | { role: 'tool'; content: string };

export class LLMClient {
  private client: OpenAI;
  private model: string;

  constructor() {
    this.client = new OpenAI({
      apiKey: config.openaiApiKey,
      baseURL: config.openaiBaseUrl
    });
    this.model = config.openaiModel;
  }

  async *stream(messages: Array<InputMessage>, signal?: AbortSignal): AsyncGenerator<string> {
    const chatMessages = messages.filter((m) => m.role !== 'tool') as ChatMessage[];
    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        stream: true,
        messages: chatMessages
      },
      { signal }
    );

    for await (const chunk of response) {
      if (signal?.aborted) return;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (!delta) continue;
      if (typeof delta === 'string') {
        yield delta;
      } else if (Array.isArray(delta)) {
        for (const part of delta) {
          if (part.type === 'text') {
            yield part.text ?? '';
          }
        }
      }
    }
  }
}
