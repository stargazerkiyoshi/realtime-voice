import WebSocket from 'ws';
import zlib from 'zlib';
import { randomUUID } from 'crypto';
import { config } from '../config';
import { sleep } from '../llm/util';
import type { AsrPartial, AsrFinal, AsrProvider } from './types';
import { logger } from '../observability/logger';

type HeaderFields = {
  version: number;
  headerSize: number;
  msgType: number;
  flags: number;
  serialization: number;
  compression: number;
  reserved: number;
};

const VERSION = 0b0001;
const HEADER_SIZE_UNITS = 0b0001; // 4 bytes
const MSG_FULL_CLIENT_REQUEST = 0b0001;
const MSG_AUDIO_ONLY = 0b0010;
const MSG_FULL_SERVER_RESPONSE = 0b1001;
const MSG_ERROR = 0b1111;

const FLAG_SEQ_POSITIVE = 0b0001;
const FLAG_LAST_PACKET_NO_SEQ = 0b0010;
const FLAG_SEQ_NEGATIVE_LAST = 0b0011;

const SERIALIZE_NONE = 0b0000;
const SERIALIZE_JSON = 0b0001;
const COMPRESS_NONE = 0b0000;
const COMPRESS_GZIP = 0b0001;

function buildHeader(msgType: number, flags: number, serialization: number, compression: number): Buffer {
  const b0 = (VERSION << 4) | (HEADER_SIZE_UNITS & 0x0f);
  const b1 = ((msgType & 0x0f) << 4) | (flags & 0x0f);
  const b2 = ((serialization & 0x0f) << 4) | (compression & 0x0f);
  const b3 = 0x00;
  return Buffer.from([b0, b1, b2, b3]);
}

function parseHeader(buf: Buffer): HeaderFields {
  const b0 = buf[0];
  const b1 = buf[1];
  const b2 = buf[2];
  return {
    version: (b0 >> 4) & 0x0f,
    headerSize: b0 & 0x0f,
    msgType: (b1 >> 4) & 0x0f,
    flags: b1 & 0x0f,
    serialization: (b2 >> 4) & 0x0f,
    compression: b2 & 0x0f,
    reserved: buf[3]
  };
}

function gzip(buf: Buffer): Buffer {
  return zlib.gzipSync(buf);
}

function gunzipMaybe(buf: Buffer, compression: number): Buffer {
  if (compression === COMPRESS_GZIP) return zlib.gunzipSync(buf);
  return buf;
}

function toBigEndian32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}

function readUInt32BE(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset);
}

export class VolcAsrClient implements AsrProvider {
  private ws: WebSocket | null = null;
  private connected = false;
  private closing = false;
  private finishing = false;
  private plannedIdleClose = false;
  private started = false;
  private seq = 2;
  private lastError: Error | null = null;
  private connectPromise: Promise<void> | null = null;
  private sentAudioFrames = 0;
  private recvFrames = 0;

  private resultQueue: Array<AsrPartial | AsrFinal> = [];
  private waiters: Array<(v?: AsrPartial | AsrFinal) => void> = [];
  private idleTimer: NodeJS.Timeout | null = null;
  private idleMs: number;

  constructor(
    private readonly opts: {
      appKey?: string;
      accessKey?: string;
      resourceId?: string;
      connectId?: string;
      url?: string;
      idleMs?: number;
    } = {}
  ) {
    this.idleMs = this.opts.idleMs ?? 5000;
  }

  private headers() {
    return {
      'X-Api-App-Key': this.opts.appKey ?? config.volcAppKey ?? '',
      'X-Api-Access-Key': this.opts.accessKey ?? config.volcAccessKey ?? '',
      'X-Api-Resource-Id': this.opts.resourceId ?? config.volcAsrResourceId ?? config.volcResourceId ?? '',
      'X-Api-Connect-Id': this.opts.connectId ?? config.volcConnectId ?? randomUUID()
    };
  }

  private async ensureConnected() {
    if (this.connected && this.ws) return;
    const url = this.opts.url ?? config.volcAsrUrl;
    this.ws = new WebSocket(url, { headers: this.headers() });
    logger.info('asr connect', {
      url,
      appKeySet: Boolean(this.opts.appKey ?? config.volcAppKey),
      accessKeySet: Boolean(this.opts.accessKey ?? config.volcAccessKey),
      resourceId: this.opts.resourceId ?? config.volcAsrResourceId ?? config.volcResourceId ?? ''
    });

    await new Promise<void>((resolve, reject) => {
      this.ws?.once('open', () => resolve());
      this.ws?.once('error', reject);
    });

    this.connected = true;
    this.lastError = null;
    this.closing = false;
    this.plannedIdleClose = false;
    this.finishing = false;
    this.seq = 2;
    this.ws.on('message', (data: WebSocket.RawData) => this.handleMessage(data as Buffer));
    this.ws.on('error', (err) => {
      logger.error('asr ws error', err);
      this.lastError = err instanceof Error ? err : new Error(String(err));
      this.connected = false;
      this.wakeWaiters();
    });
    this.ws.on('close', () => {
      logger.warn('asr ws closed', { closing: this.closing, sentAudioFrames: this.sentAudioFrames });
      this.connected = false;
      if (!this.closing && !this.lastError) {
        this.lastError = new Error('ASR websocket closed unexpectedly');
      }
      this.wakeWaiters();
    });
  }

  private enqueue(res: AsrPartial | AsrFinal) {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(res);
    } else {
      this.resultQueue.push(res);
    }
  }

  private resetIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    if (this.idleMs <= 0) return;
    this.idleTimer = setTimeout(() => {
      if (this.closing || this.finishing) return;
      this.plannedIdleClose = true;
      this.closing = true;
      try {
        this.sendAudioFrame(Buffer.alloc(0), true);
      } catch {
        /* ignore */
      }
      this.ws?.close();
    }, this.idleMs);
  }

  private handleMessage(data: Buffer) {
    if (data.length < 8) return;
    const header = parseHeader(data.slice(0, 4));
    this.recvFrames += 1;
    if (this.recvFrames % 20 === 0) {
      logger.debug('asr recv frame', { idx: this.recvFrames, msgType: header.msgType, flags: header.flags, len: data.length });
    }
    if (header.msgType === MSG_ERROR) {
      let code: number | undefined;
      let message = 'unknown';
      try {
        code = data.readInt32BE(4);
        const payloadSize = data.readUInt32BE(8);
        const payloadBuf = data.slice(12, 12 + payloadSize);
        const obj = JSON.parse(gunzipMaybe(payloadBuf, header.compression).toString('utf8'));
        if (typeof obj?.message === 'string') {
          message = obj.message;
        } else {
          message = JSON.stringify(obj);
        }
      } catch {
        // ignore parse errors and keep fallback message
      }
      this.lastError = new Error(`ASR server error${typeof code === 'number' ? `(${code})` : ''}: ${message}`);
      logger.error('asr server frame error', this.lastError.message);
      return;
    }

    const hasSeq = header.flags === FLAG_SEQ_POSITIVE || header.flags === FLAG_SEQ_NEGATIVE_LAST;
    let offset = 4;
    let seqNum: number | null = null;
    if (hasSeq) {
      seqNum = data.readInt32BE(offset);
      offset += 4;
    }
    const payloadSize = readUInt32BE(data, offset);
    offset += 4;
    const payloadBuf = data.slice(offset, offset + payloadSize);

    if (header.msgType !== MSG_FULL_SERVER_RESPONSE) return;

    const decompressed = gunzipMaybe(payloadBuf, header.compression);
    let obj: any;
    try {
      obj = JSON.parse(decompressed.toString('utf8'));
    } catch {
      return;
    }

    const result = obj?.result;
    if (!result) return;

    const utterances = Array.isArray(result.utterances) ? result.utterances : [];
    const lastUtt = utterances.length > 0 ? utterances[utterances.length - 1] : undefined;
    const text = (lastUtt?.text as string) || (result.text as string) || '';
    const startMs = typeof lastUtt?.start_time === 'number' ? lastUtt.start_time : undefined;
    const endMs = typeof lastUtt?.end_time === 'number' ? lastUtt.end_time : undefined;
    const isFinal =
      Boolean(lastUtt?.definite) ||
      Boolean(result.definite) ||
      Boolean(result.is_final) ||
      header.flags === FLAG_SEQ_NEGATIVE_LAST ||
      (typeof seqNum === 'number' && seqNum < 0);

    if (!text) return;
    logger.debug('asr text frame', { textLen: text.length, isFinal });

    this.enqueue({
      text,
      startMs,
      endMs,
      isFinal: isFinal || undefined
    });
  }

  private buildFullClientRequestPayload(): Buffer {
    const payload = {
      user: { uid: 'anonymous' },
      audio: { format: 'pcm', rate: 16000, bits: 16, channel: 1 },
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
        enable_ddc: false
      }
    };
    const json = Buffer.from(JSON.stringify(payload), 'utf8');
    return gzip(json);
  }

  private sendFullClientRequest() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`ASR websocket not open: ${this.ws?.readyState ?? 'null'}`);
    }
    const payload = this.buildFullClientRequestPayload();
    const header = buildHeader(MSG_FULL_CLIENT_REQUEST, 0b0000, SERIALIZE_JSON, COMPRESS_GZIP);
    const size = toBigEndian32(payload.length);
    const frame = Buffer.concat([header, size, payload]);
    this.ws?.send(frame);
    logger.info('asr full request sent', { bytes: frame.length });
  }

  private sendAudioFrame(pcm: Buffer, isLast = false) {
    const payload = gzip(pcm);
    const flags = isLast ? FLAG_SEQ_NEGATIVE_LAST : FLAG_SEQ_POSITIVE;
    const header = buildHeader(MSG_AUDIO_ONLY, flags, SERIALIZE_NONE, COMPRESS_GZIP);
    const seq = isLast ? -this.seq : this.seq;
    const seqBuf = toBigEndian32(seq);
    const sizeBuf = toBigEndian32(payload.length);
    const frame = Buffer.concat([header, seqBuf, sizeBuf, payload]);
    this.ws?.send(frame);
    this.seq += 1;
    this.sentAudioFrames += 1;
    if (this.sentAudioFrames % 20 === 0 || isLast) {
      logger.debug('asr audio frame sent', { idx: this.sentAudioFrames, isLast, pcmBytes: pcm.length, gzBytes: payload.length });
    }
  }

  private wakeWaiters() {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      waiter();
    }
  }

  async connect() {
    if (this.closing) return;
    if (!this.connectPromise) {
      this.connectPromise = (async () => {
        await this.ensureConnected();
        if (!this.started) {
          this.sendFullClientRequest();
          this.started = true;
        }
        this.resetIdleTimer();
      })().finally(() => {
        this.connectPromise = null;
      });
    }
    await this.connectPromise;
  }

  async close() {
    if (this.closing) return;
    this.finishing = true;
    this.closing = true;
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.connectPromise) {
      try {
        await this.connectPromise;
      } catch {
        // ignore and continue close
      }
    }
    try {
      if (this.connected && this.ws) {
        // send final (negative seq) packet to signal end
        this.sendAudioFrame(Buffer.alloc(0), true);
      }
    } catch {
      // ignore
    }
    await sleep(250);
    this.ws?.close();
    this.connected = false;
    this.started = false;
    this.finishing = false;
    this.seq = 2;
    this.wakeWaiters();
    logger.info('asr closed', { sentAudioFrames: this.sentAudioFrames, recvFrames: this.recvFrames });
  }

  async feed(pcm16: Buffer) {
    await this.connect();
    if (!this.ws || this.closing || this.finishing) return;
    this.resetIdleTimer();
    this.sendAudioFrame(pcm16, false);
  }

  isPlannedClose() {
    return this.plannedIdleClose;
  }

  planClose() {
    this.plannedIdleClose = true;
  }

  async *stream(): AsyncGenerator<AsrPartial | AsrFinal> {
    await this.connect();
    while (!this.closing) {
      if (this.lastError) {
        throw this.lastError;
      }
      if (this.resultQueue.length > 0) {
        const v = this.resultQueue.shift();
        if (v) {
          yield v;
          continue;
        }
      }
      const v = await new Promise<AsrPartial | AsrFinal | undefined>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('ASR timeout')), 30000);
        this.waiters.push((res) => {
          clearTimeout(timer);
          resolve(res);
        });
      }).catch(() => undefined);
      if (v) {
        yield v;
      }
    }
  }
}
