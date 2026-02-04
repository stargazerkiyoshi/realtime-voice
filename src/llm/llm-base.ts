import { sleep } from './util';

export class LLMClient {
  async *stream(messages: Array<{ role: string; content: string }>, signal?: AbortSignal): AsyncGenerator<string> {
    const last = messages[messages.length - 1]?.content ?? '';
    const demo = `好的，我听到了。你刚才说的是：${last}。`;
    for (const ch of demo) {
      if (signal?.aborted) return;
      await sleep(20);
      yield ch;
    }
  }
}
