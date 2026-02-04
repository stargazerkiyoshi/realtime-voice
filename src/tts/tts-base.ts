import { config } from '../config';
import { VolcTtsClient } from './volc-tts';
import type { TtsProvider } from './types';

export class TTSClient {
  private provider: TtsProvider;

  constructor(provider?: TtsProvider) {
    this.provider = provider ?? createTtsProvider();
  }

  async *stream(text: string, signal?: AbortSignal): AsyncGenerator<Buffer> {
    for await (const audio of this.provider.stream(text, signal)) {
      if (signal?.aborted) return;
      yield audio;
    }
  }

  async close() {
    await this.provider.close();
  }
}

export type { TtsProvider } from './types';

function createTtsProvider(): TtsProvider {
  switch (config.ttsProvider) {
    case 'volc':
      return new VolcTtsClient();
    default:
      throw new Error(`Unsupported TTS provider: ${config.ttsProvider}`);
  }
}
