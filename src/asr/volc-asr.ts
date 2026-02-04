import WebSocket from 'ws';
import { config } from '../config';
import { sleep } from '../llm/util';

export type AsrPartial = {
  text: string;
  confidence?: number;
  startMs?: number;
  endMs?: number;
  isFinal?: boolean;
};

export type AsrFinal = AsrPartial & { isFinal: true };

export class VolcAsrClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private closing = false;
  private queue: Buffer[] = [];

  constructor(
    private readonly opts: {
      appId?: string;
      token?: string;
      cluster?: string;
      url?: string;
    } = {}
  ) {}

  async connect() {
    if (this.connected) return;
    const url = this.opts.url ?? config.volcAsrUrl;
    this.ws = new WebSocket(url);

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) return reject(new Error('ws not created'));
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });

    this.connected = true;

    const startFrame = {
      app: { appid: this.opts.appId ?? config.volcAppId, token: this.opts.token ?? config.volcToken },
      user: { uid: 'anonymous' },
      cloud: { cluster: this.opts.cluster ?? config.volcCluster }
    };
    this.ws.send(JSON.stringify(startFrame));
  }

  async close() {
    this.closing = true;
    if (this.ws && this.connected) {
      this.ws.close();
    }
    this.ws = null;
    this.connected = false;
  }

  async feed(pcm16: Buffer) {
    if (!this.ws || !this.connected) {
      await this.connect();
    }
    if (!this.ws) return;
    this.ws.send(pcm16);
  }

  async *stream(): AsyncGenerator<AsrPartial | AsrFinal> {
    while (!this.ws) {
      await sleep(10);
    }
    const ws = this.ws!;

    ws.on('message', (data) => {
      // no-op; actual messages consumed via async iterator below
    });

    const messages: Array<AsrPartial | AsrFinal> = [];
    ws.on('message', (data) => {
      try {
        const txt = typeof data === 'string' ? data : data.toString('utf8');
        const obj = JSON.parse(txt);
        const isFinal = obj?.is_final || obj?.result?.is_final;
        const text = obj?.text ?? obj?.result?.text ?? '';
        const confidence = obj?.confidence ?? obj?.result?.confidence;
        const startMs = obj?.start_time ?? obj?.result?.start_ms;
        const endMs = obj?.end_time ?? obj?.result?.end_ms;
        if (text) {
          messages.push({ text, confidence, startMs, endMs, isFinal: !!isFinal });
        }
      } catch {
        // ignore parse errors
      }
    });

    while (!this.closing) {
      if (messages.length === 0) {
        await sleep(10);
        continue;
      }
      const m = messages.shift();
      if (m) {
        yield m;
      }
    }
  }
}
