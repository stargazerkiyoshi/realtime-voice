import { config } from '../config';
import { VolcTtsClient } from './volc-tts';
import type { TtsProvider, TtsStreamSession } from './types';

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

  async openStream(signal?: AbortSignal): Promise<TtsStreamSession> {
    if (typeof this.provider.openStream !== 'function') {
      throw new Error('TTS provider does not support streaming');
    }
    return this.provider.openStream(signal);
  }

  async close() {
    await this.provider.close();
  }
}

export type { TtsProvider, TtsStreamSession } from './types';

function createTtsProvider(): TtsProvider {
  switch (config.ttsProvider) {
    case 'volc':
      return new VolcTtsClient();
    default:
      throw new Error(`Unsupported TTS provider: ${config.ttsProvider}`);
  }
}
