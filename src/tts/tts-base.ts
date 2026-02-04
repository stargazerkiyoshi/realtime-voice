import { VolcTtsClient } from './volc-tts';

export class TTSClient {
  private client = new VolcTtsClient();

  async *stream(text: string, signal?: AbortSignal): AsyncGenerator<Buffer> {
    for await (const audio of this.client.stream(text, signal)) {
      if (signal?.aborted) return;
      yield audio;
    }
  }
}
