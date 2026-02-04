import WebSocket from 'ws';
import { config } from '../config';

export type VolcTtsOptions = {
  voiceType?: string;
  sampleRate?: number;
  url?: string;
  appId?: string;
  token?: string;
  cluster?: string;
};

// Minimal streaming TTS client for Volcengine WebSocket binary API.
export class VolcTtsClient {
  constructor(private readonly opts: VolcTtsOptions = {}) {}

  async *stream(text: string, signal?: AbortSignal): AsyncGenerator<Buffer> {
    const url = this.opts.url ?? config.volcTtsUrl;
    const ws = new WebSocket(url);

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    const startFrame = {
      app: { appid: this.opts.appId ?? config.volcAppId, token: this.opts.token ?? config.volcToken },
      user: { uid: 'anonymous' },
      cloud: { cluster: this.opts.cluster ?? config.volcCluster },
      audio: {
        voice_type: this.opts.voiceType ?? config.volcVoiceType,
        encoding: 'pcm',
        sample_rate: this.opts.sampleRate ?? config.volcSampleRate,
        speed_ratio: 1.0,
        volume_ratio: 1.0,
        pitch_ratio: 1.0
      },
      request: { reqid: Date.now().toString() },
      text: { content: text, language: 'zh' }
    };

    ws.send(JSON.stringify(startFrame));

    const done = new Promise<void>((resolve) => {
      ws.on('close', () => resolve());
      ws.on('error', () => resolve());
    });

    const pending: Buffer[] = [];
    ws.on('message', (data) => {
      if (signal?.aborted) {
        ws.close();
        return;
      }
      if (Buffer.isBuffer(data)) {
        pending.push(data);
      } else if (typeof data === 'string') {
        try {
          const obj = JSON.parse(data);
          if (obj?.event === 'close' || obj?.code) {
            ws.close();
          }
        } catch {
          ws.close();
        }
      }
    });

    while (ws.readyState === WebSocket.OPEN || pending.length > 0) {
      if (signal?.aborted) {
        ws.close();
        break;
      }
      const buf = pending.shift();
      if (buf) {
        yield buf;
      } else {
        await new Promise((r) => setTimeout(r, 5));
      }
    }

    await done;
  }
}
