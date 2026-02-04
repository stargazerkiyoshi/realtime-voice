import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { config } from '../config';
import { sleep } from '../llm/util';
import type { TtsProvider } from './types';

export type VolcTtsOptions = {
  voiceType?: string;
  sampleRate?: number;
  model?: string;
  url?: string;
  appKey?: string;
  accessKey?: string;
  resourceId?: string;
  connectId?: string;
};

type ParsedFrame = {
  msgType: number;
  flags: number;
  event?: number;
  sessionId?: string;
  payload: Buffer;
  errorCode?: number;
};

const VERSION = 0b0001;
const HEADER_SIZE_UNITS = 0b0001; // 4 bytes

const MSG_FULL_CLIENT_REQUEST = 0b0001;
const MSG_AUDIO_ONLY_RESPONSE = 0b1011;
const MSG_ERROR = 0b1111;

const FLAG_WITH_EVENT = 0b0100;

const SERIALIZE_RAW = 0b0000;
const SERIALIZE_JSON = 0b0001;
const COMPRESS_NONE = 0b0000;

const EVENT_START_CONNECTION = 1;
const EVENT_FINISH_CONNECTION = 2;
const EVENT_CONNECTION_STARTED = 50;
const EVENT_CONNECTION_FAILED = 51;
const EVENT_START_SESSION = 100;
const EVENT_FINISH_SESSION = 102;
const EVENT_SESSION_STARTED = 150;
const EVENT_SESSION_FINISHED = 152;
const EVENT_SESSION_FAILED = 153;
const EVENT_TASK_REQUEST = 200;
const EVENT_TTS_RESPONSE = 352;

function buildHeader(msgType: number, flags: number, serialization: number, compression: number): Buffer {
  const b0 = (VERSION << 4) | (HEADER_SIZE_UNITS & 0x0f);
  const b1 = ((msgType & 0x0f) << 4) | (flags & 0x0f);
  const b2 = ((serialization & 0x0f) << 4) | (compression & 0x0f);
  const b3 = 0x00;
  return Buffer.from([b0, b1, b2, b3]);
}

function toInt32BE(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}

function toUInt32BE(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function buildEventFrame(event: number, payload: Buffer, opts?: { sessionId?: string; messageType?: number; serialization?: number }) {
  const messageType = opts?.messageType ?? MSG_FULL_CLIENT_REQUEST;
  const serialization = opts?.serialization ?? SERIALIZE_JSON;
  const header = buildHeader(messageType, FLAG_WITH_EVENT, serialization, COMPRESS_NONE);

  const parts: Buffer[] = [header, toInt32BE(event)];
  if (opts?.sessionId) {
    const sidBuf = Buffer.from(opts.sessionId, 'utf8');
    parts.push(toUInt32BE(sidBuf.length), sidBuf);
  }
  parts.push(toUInt32BE(payload.length), payload);
  return Buffer.concat(parts);
}

function parseFrame(buf: Buffer): ParsedFrame | null {
  if (buf.length < 8) return null;
  const msgType = (buf[1] >> 4) & 0x0f;
  const flags = buf[1] & 0x0f;

  let offset = 4;
  const out: ParsedFrame = {
    msgType,
    flags,
    payload: Buffer.alloc(0)
  };

  if (msgType === MSG_ERROR) {
    if (buf.length < 12) return null;
    out.errorCode = buf.readInt32BE(offset);
    offset += 4;
    const payloadLen = buf.readUInt32BE(offset);
    offset += 4;
    out.payload = buf.slice(offset, offset + payloadLen);
    return out;
  }

  if (flags === FLAG_WITH_EVENT) {
    if (buf.length < offset + 4) return null;
    out.event = buf.readInt32BE(offset);
    offset += 4;
  }

  if (buf.length < offset + 4) return null;
  const maybeSessionIdLen = buf.readUInt32BE(offset);
  if (buf.length >= offset + 4 + maybeSessionIdLen + 4) {
    offset += 4;
    if (maybeSessionIdLen > 0) {
      out.sessionId = buf.slice(offset, offset + maybeSessionIdLen).toString('utf8');
      offset += maybeSessionIdLen;
    }
  }

  if (buf.length < offset + 4) return null;
  const payloadLen = buf.readUInt32BE(offset);
  offset += 4;
  out.payload = buf.slice(offset, offset + payloadLen);
  return out;
}

async function waitForFrame(
  queue: ParsedFrame[],
  waiters: Array<(frame: ParsedFrame) => void>,
  timeoutMs: number
): Promise<ParsedFrame> {
  if (queue.length > 0) {
    return queue.shift() as ParsedFrame;
  }
  return new Promise<ParsedFrame>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TTS timeout')), timeoutMs);
    waiters.push((frame) => {
      clearTimeout(timer);
      resolve(frame);
    });
  });
}

export class VolcTtsClient implements TtsProvider {
  constructor(private readonly opts: VolcTtsOptions = {}) {}

  async close(): Promise<void> {
    // no-op: each stream call owns its own websocket lifecycle
  }

  private headers() {
    return {
      'X-Api-App-Key': this.opts.appKey ?? config.volcAppKey ?? '',
      'X-Api-Access-Key': this.opts.accessKey ?? config.volcAccessKey ?? '',
      'X-Api-Resource-Id': this.opts.resourceId ?? config.volcTtsResourceId ?? config.volcResourceId ?? '',
      'X-Api-Connect-Id': this.opts.connectId ?? config.volcConnectId ?? randomUUID()
    };
  }

  async *stream(text: string, signal?: AbortSignal): AsyncGenerator<Buffer> {
    const ws = new WebSocket(this.opts.url ?? config.volcTtsUrl, { headers: this.headers() });
    const queue: ParsedFrame[] = [];
    const waiters: Array<(frame: ParsedFrame) => void> = [];
    let failed: Error | null = null;
    let closed = false;

    const pushFrame = (frame: ParsedFrame) => {
      const waiter = waiters.shift();
      if (waiter) {
        waiter(frame);
      } else {
        queue.push(frame);
      }
    };

    ws.on('message', (data: WebSocket.RawData) => {
      const raw =
        typeof data === 'string'
          ? Buffer.from(data, 'utf8')
          : Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data as ArrayBuffer);
      const parsed = parseFrame(raw);
      if (!parsed) return;
      pushFrame(parsed);
    });
    ws.on('error', (err) => {
      failed = err instanceof Error ? err : new Error(String(err));
    });
    ws.on('close', () => {
      closed = true;
    });

    const onAbort = () => {
      ws.close();
    };
    signal?.addEventListener('abort', onAbort);

    try {
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve());
        ws.once('error', reject);
      });

      const startConnection = buildEventFrame(EVENT_START_CONNECTION, Buffer.from('{}', 'utf8'));
      ws.send(startConnection);

      while (true) {
        const frame = await waitForFrame(queue, waiters, 15000);
        if (frame.msgType === MSG_ERROR) {
          throw new Error(`Volc TTS connect failed: ${frame.errorCode ?? 'unknown'}`);
        }
        if (frame.event === EVENT_CONNECTION_FAILED) {
          throw new Error(`Volc TTS connection failed: ${frame.payload.toString('utf8')}`);
        }
        if (frame.event === EVENT_CONNECTION_STARTED) break;
      }

      const sessionId = randomUUID();
      const startSessionPayload = {
        user: { uid: 'anonymous' },
        req_params: {
          speaker: this.opts.voiceType ?? config.volcVoiceType,
          model: this.opts.model ?? config.volcTtsModel,
          audio_params: {
            format: 'pcm',
            sample_rate: this.opts.sampleRate ?? config.volcSampleRate
          }
        }
      };
      ws.send(
        buildEventFrame(EVENT_START_SESSION, Buffer.from(JSON.stringify(startSessionPayload), 'utf8'), {
          sessionId
        })
      );

      while (true) {
        const frame = await waitForFrame(queue, waiters, 15000);
        if (frame.msgType === MSG_ERROR) {
          throw new Error(`Volc TTS session failed: ${frame.errorCode ?? 'unknown'}`);
        }
        if (frame.event === EVENT_SESSION_FAILED && frame.sessionId === sessionId) {
          throw new Error(`Volc TTS session failed: ${frame.payload.toString('utf8')}`);
        }
        if (frame.event === EVENT_SESSION_STARTED && frame.sessionId === sessionId) break;
      }

      ws.send(
        buildEventFrame(EVENT_TASK_REQUEST, Buffer.from(JSON.stringify({ req_params: { text } }), 'utf8'), {
          sessionId
        })
      );
      ws.send(buildEventFrame(EVENT_FINISH_SESSION, Buffer.from('{}', 'utf8'), { sessionId }));

      while (!signal?.aborted) {
        if (failed) throw failed;
        const frame = await waitForFrame(queue, waiters, 30000);
        if (frame.msgType === MSG_ERROR) {
          throw new Error(`Volc TTS stream error: ${frame.errorCode ?? 'unknown'}`);
        }
        if (frame.event === EVENT_TTS_RESPONSE && frame.msgType === MSG_AUDIO_ONLY_RESPONSE && frame.sessionId === sessionId) {
          if (frame.payload.length > 0) {
            yield frame.payload;
          }
          continue;
        }
        if (frame.event === EVENT_SESSION_FINISHED && frame.sessionId === sessionId) {
          break;
        }
        if (frame.event === EVENT_SESSION_FAILED && frame.sessionId === sessionId) {
          throw new Error(`Volc TTS session failed: ${frame.payload.toString('utf8')}`);
        }
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);

      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(buildEventFrame(EVENT_FINISH_CONNECTION, Buffer.from('{}', 'utf8')));
          await sleep(5);
        }
      } catch {
        // ignore cleanup errors
      }

      if (!closed) ws.close();
    }
  }
}
