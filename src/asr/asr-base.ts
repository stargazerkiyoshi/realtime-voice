import { config } from '../config';
import { VolcAsrClient } from './volc-asr';
import type { AsrProvider, AsrResult } from './types';
export type { AsrProvider, AsrResult, AsrPartial, AsrFinal } from './types';

function createAsrProvider(): AsrProvider {
  switch (config.asrProvider) {
    case 'volc':
      return new VolcAsrClient();
    default:
      throw new Error(`Unsupported ASR provider: ${config.asrProvider}`);
  }
}

export class AsrClient {
  private provider: AsrProvider;

  constructor(provider?: AsrProvider) {
    this.provider = provider ?? createAsrProvider();
  }

  async connect() {
    await this.provider.connect();
  }

  async close() {
    await this.provider.close();
  }

  async feed(pcm16: Buffer) {
    await this.provider.feed(pcm16);
  }

  stream(): AsyncGenerator<AsrResult> {
    return this.provider.stream();
  }
}
