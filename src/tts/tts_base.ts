import { sleep } from '../llm/util';

export class TTSClient {
  async *stream(text: string, signal?: AbortSignal): AsyncGenerator<Buffer> {
    const chunk = Buffer.alloc(960 * 2, 0);
    const count = Math.max(1, Math.floor(text.length / 6));
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) return;
      await sleep(20);
      yield chunk;
    }
  }
}
