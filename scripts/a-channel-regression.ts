import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';

type GateStage = 'A' | 'B' | 'C';
type ScenarioStatus = 'pass' | 'fail' | 'skip';
type RunStatus = 'pass' | 'fail' | 'warn';

type CliOptions = {
  url: string;
  output: string;
  gateStage: GateStage;
  spawnServer: boolean;
  scenarioIds: string[];
  enforceThresholds: boolean;
  audioFile?: string;
  verbose: boolean;
};

type TimedEvent = {
  atMs: number;
  type: string;
  payload: Record<string, unknown>;
};

type AssertionResult = {
  name: string;
  pass: boolean;
  details?: string;
};

type ScenarioMetric = {
  name: string;
  unit: 'ms';
  value: number;
};

type ScenarioRunResult = {
  assertions: AssertionResult[];
  metrics?: ScenarioMetric[];
  notes?: string[];
  events?: TimedEvent[];
  skipReason?: string;
};

type ScenarioDefinition = {
  id: string;
  name: string;
  description: string;
  timeoutMs: number;
  run: () => Promise<ScenarioRunResult>;
};

type RegressionPrerequisites = {
  asr: boolean;
  tts: boolean;
  llm: boolean;
  pipeline: boolean;
};

type AudioFixture = {
  path: string;
  frames: Buffer[];
  cursor: number;
  rmsP50: number;
  rmsP95: number;
};

type ScenarioOutput = {
  id: string;
  name: string;
  description: string;
  status: ScenarioStatus;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  assertions: AssertionResult[];
  metrics: ScenarioMetric[];
  notes: string[];
  skipReason?: string;
  error?: string;
  events: Array<{ atMs: number; type: string; payload: Record<string, unknown> }>;
};

type RunOutput = {
  runId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  git: { branch: string; head: string };
  options: {
    url: string;
    selectedScenarios: string[];
    gateStage: GateStage;
    spawnServer: boolean;
    enforceThresholds: boolean;
    audioFile?: string;
    prerequisites: RegressionPrerequisites;
  };
  thresholds: {
    metric: 'speech_end_to_first_audio_ms';
    p50Ms: number;
    p95Ms: number;
    stage: GateStage;
    appliedAsFailure: boolean;
  };
  performance: {
    sampleCount: number;
    p50Ms?: number;
    p95Ms?: number;
    thresholdStatus: 'pass' | 'fail' | 'na';
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    status: RunStatus;
  };
  scenarios: ScenarioOutput[];
};

const DEFAULT_URL = process.env.REGRESSION_WS_URL ?? 'ws://127.0.0.1:3000/ws/voice';
const DEFAULT_GATE_STAGE = (process.env.REGRESSION_GATE_STAGE ?? 'A').toUpperCase() as GateStage;
const DEFAULT_ENFORCE_THRESHOLDS = String(process.env.REGRESSION_ENFORCE_THRESHOLDS ?? 'false').toLowerCase() === 'true';
const DEFAULT_AUDIO_FILE_CANDIDATE = path.join('src', 'audio', 'test.mp3');
const DEFAULT_AUDIO_FILE =
  process.env.REGRESSION_AUDIO_FILE ??
  (existsSync(DEFAULT_AUDIO_FILE_CANDIDATE) ? DEFAULT_AUDIO_FILE_CANDIDATE : undefined);

const THRESHOLDS = {
  p50Ms: 900,
  p95Ms: 1500
};

const AUDIO_SAMPLE_RATE = 16000;
const AUDIO_FRAME_SAMPLES = 320; // 20ms @ 16k
const AUDIO_VOICE_AMPLITUDE = 12000;
const AUDIO_FRAME_BYTES = AUDIO_FRAME_SAMPLES * 2;

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseArgs(argv: string[]): CliOptions {
  let url = DEFAULT_URL;
  let output = path.join('logs', 'regression', 'a-channel', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  let gateStage: GateStage = ['A', 'B', 'C'].includes(DEFAULT_GATE_STAGE) ? DEFAULT_GATE_STAGE : 'A';
  let spawnServer = String(process.env.REGRESSION_SPAWN_SERVER ?? 'true').toLowerCase() !== 'false';
  let scenarioIds: string[] = [];
  let enforceThresholds = DEFAULT_ENFORCE_THRESHOLDS;
  let audioFile = DEFAULT_AUDIO_FILE;
  let verbose = String(process.env.REGRESSION_VERBOSE ?? 'false').toLowerCase() === 'true';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url' && argv[i + 1]) {
      url = argv[++i];
    } else if (arg === '--output' && argv[i + 1]) {
      output = argv[++i];
    } else if (arg === '--gate-stage' && argv[i + 1]) {
      const v = argv[++i].toUpperCase();
      if (v === 'A' || v === 'B' || v === 'C') gateStage = v;
    } else if (arg === '--scenarios' && argv[i + 1]) {
      scenarioIds = argv[++i]
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
    } else if (arg === '--spawn-server') {
      spawnServer = true;
    } else if (arg === '--no-spawn-server') {
      spawnServer = false;
    } else if (arg === '--enforce-thresholds') {
      enforceThresholds = true;
    } else if (arg === '--audio-file' && argv[i + 1]) {
      audioFile = argv[++i];
    } else if (arg === '--verbose') {
      verbose = true;
    }
  }

  return { url, output, gateStage, spawnServer, scenarioIds, enforceThresholds, audioFile, verbose };
}

function summarizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.type === 'tts' && typeof payload.payload_b64 === 'string') {
    const b64Len = payload.payload_b64.length;
    return {
      ...payload,
      payload_b64: `<${b64Len} chars>`
    };
  }
  if (payload.type === 'audio' && typeof payload.payload_b64 === 'string') {
    const b64Len = payload.payload_b64.length;
    return {
      ...payload,
      payload_b64: `<${b64Len} chars>`
    };
  }
  if (typeof payload.text === 'string' && payload.text.length > 120) {
    return { ...payload, text: `${payload.text.slice(0, 120)}...` };
  }
  return payload;
}

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const ratio = pos - lo;
  return sorted[lo] * (1 - ratio) + sorted[hi] * ratio;
}

function createPcmFrame(samples = AUDIO_FRAME_SAMPLES, amplitude = AUDIO_VOICE_AMPLITUDE, sampleRate = AUDIO_SAMPLE_RATE): Buffer {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const t = i / sampleRate;
    const v = Math.round(amplitude * Math.sin(2 * Math.PI * 440 * t));
    buf.writeInt16LE(v, i * 2);
  }
  return buf;
}

function createSilentFrame(samples = AUDIO_FRAME_SAMPLES): Buffer {
  return Buffer.alloc(samples * 2);
}

function frameRms(pcm16: Buffer): number {
  const len = Math.floor(pcm16.length / 2);
  if (len <= 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < len; i += 1) {
    const v = pcm16.readInt16LE(i * 2);
    const f = v / 32768;
    sumSq += f * f;
  }
  return Math.sqrt(sumSq / len);
}

async function loadAudioFixture(audioFile: string): Promise<AudioFixture> {
  const resolved = path.resolve(audioFile);
  const ffmpegBin = await resolveFfmpegBinary();
  const pcm = await new Promise<Buffer>((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      resolved,
      '-ar',
      String(AUDIO_SAMPLE_RATE),
      '-ac',
      '1',
      '-sample_fmt',
      's16',
      '-f',
      's16le',
      'pipe:1'
    ];
    const p = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    p.stdout.on('data', (d) => outChunks.push(Buffer.from(d)));
    p.stderr.on('data', (d) => errChunks.push(Buffer.from(d)));
    p.on('error', (err) => {
      reject(
        new Error(
          `ffmpeg 不可用 (${err instanceof Error ? err.message : String(err)})，请安装 ffmpeg 或设置 FFMPEG_BIN`
        )
      );
    });
    p.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(outChunks));
      } else {
        const msg = Buffer.concat(errChunks).toString('utf8').trim();
        reject(new Error(`ffmpeg 转码失败 (code=${code}): ${msg || 'unknown error'}`));
      }
    });
  });

  if (pcm.length < AUDIO_FRAME_BYTES) {
    throw new Error('音频夹具过短，无法生成有效音频帧');
  }

  const rawFrames: Buffer[] = [];
  for (let i = 0; i < pcm.length; i += AUDIO_FRAME_BYTES) {
    const frame = pcm.slice(i, i + AUDIO_FRAME_BYTES);
    if (frame.length === AUDIO_FRAME_BYTES) {
      rawFrames.push(frame);
    } else {
      const padded = Buffer.alloc(AUDIO_FRAME_BYTES);
      frame.copy(padded);
      rawFrames.push(padded);
    }
  }

  const voicedFrames = rawFrames.filter((frame) => frameRms(frame) >= 0.01);
  const frames = voicedFrames.length > 0 ? voicedFrames : rawFrames;
  const rmsValues = frames.map((f) => frameRms(f));

  return {
    path: resolved,
    frames,
    cursor: 0,
    rmsP50: percentile(rmsValues, 50) ?? 0,
    rmsP95: percentile(rmsValues, 95) ?? 0
  };
}

async function resolveFfmpegBinary(): Promise<string> {
  if (process.env.FFMPEG_BIN) return process.env.FFMPEG_BIN;
  try {
    const mod = (await import('ffmpeg-static')) as { default?: string };
    if (typeof mod.default === 'string' && mod.default.length > 0) {
      return mod.default;
    }
  } catch {
    // fallthrough to system ffmpeg
  }
  return 'ffmpeg';
}

function nextVoiceFrame(audioFixture: AudioFixture | null): Buffer {
  if (!audioFixture || audioFixture.frames.length === 0) {
    return createPcmFrame();
  }
  const idx = audioFixture.cursor % audioFixture.frames.length;
  audioFixture.cursor += 1;
  return audioFixture.frames[idx];
}

class WsScenarioClient {
  private ws: WebSocket | null = null;
  private events: TimedEvent[] = [];
  private waiters: Array<{
    predicate: (e: TimedEvent) => boolean;
    resolve: (e: TimedEvent) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
    description: string;
  }> = [];

  constructor(
    private readonly url: string,
    private readonly name: string,
    private readonly verbose: boolean
  ) {}

  async connect(timeoutMs = 5000): Promise<void> {
    if (this.ws) return;
    this.ws = new WebSocket(this.url);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('connect timeout')), timeoutMs);
      this.ws?.once('open', () => {
        clearTimeout(t);
        resolve();
      });
      this.ws?.once('error', (err) => {
        clearTimeout(t);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });

    this.ws.on('message', (data) => {
      const raw = typeof data === 'string' ? data : (data as Buffer).toString('utf8');
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        payload = { type: '__non_json__', raw };
      }
      const event: TimedEvent = {
        atMs: Date.now(),
        type: String(payload.type ?? '__unknown__'),
        payload: summarizePayload(payload)
      };
      this.events.push(event);
      if (this.verbose) {
        console.log(`[${this.name}] <= ${event.type}`, event.payload);
      }
      this.flushWaiters(event);
    });

    this.ws.on('close', () => {
      const err = new Error('websocket closed');
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(err);
      }
    });
  }

  private flushWaiters(event: TimedEvent) {
    const remain: typeof this.waiters = [];
    for (const waiter of this.waiters) {
      if (waiter.predicate(event)) {
        clearTimeout(waiter.timer);
        waiter.resolve(event);
      } else {
        remain.push(waiter);
      }
    }
    this.waiters = remain;
  }

  send(payload: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('websocket is not open');
    }
    if (this.verbose) {
      console.log(`[${this.name}] => ${String(payload.type ?? 'unknown')}`, summarizePayload(payload));
    }
    this.ws.send(JSON.stringify(payload));
  }

  sendRaw(raw: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('websocket is not open');
    }
    if (this.verbose) {
      console.log(`[${this.name}] => raw`, raw);
    }
    this.ws.send(raw);
  }

  waitFor(predicate: (e: TimedEvent) => boolean, timeoutMs: number, description: string): Promise<TimedEvent> {
    const existing = this.events.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise<TimedEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`timeout waiting ${description}`));
      }, timeoutMs);

      const waiter = { predicate, resolve, reject, timer, description };
      this.waiters.push(waiter);
    });
  }

  async waitForType(type: string, timeoutMs: number): Promise<TimedEvent> {
    return this.waitFor((e) => e.type === type, timeoutMs, `event type=${type}`);
  }

  getEvents(): TimedEvent[] {
    return [...this.events];
  }

  getEventCount(type: string): number {
    return this.events.filter((e) => e.type === type).length;
  }

  async close(): Promise<void> {
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) return;
    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.close();
      setTimeout(() => resolve(), 1200);
    });
  }
}

function assert(name: string, pass: boolean, details?: string): AssertionResult {
  return { name, pass, details };
}

async function sendAudioSequence(
  client: WsScenarioClient,
  voiceFrames = 20,
  silenceFrames = 25,
  frameIntervalMs = 20,
  audioFixture: AudioFixture | null = null
) {
  const silence = createSilentFrame();
  for (let i = 0; i < voiceFrames; i += 1) {
    const voice = nextVoiceFrame(audioFixture);
    client.send({ type: 'audio', payload_b64: voice.toString('base64'), ts_ms: Date.now() });
    await sleep(frameIntervalMs);
  }
  for (let i = 0; i < silenceFrames; i += 1) {
    client.send({ type: 'audio', payload_b64: silence.toString('base64'), ts_ms: Date.now() });
    await sleep(frameIntervalMs);
  }
}

async function startSession(client: WsScenarioClient, sid = randomId('reg')): Promise<TimedEvent> {
  client.send({ type: 'start', session_id: sid });
  return client.waitForType('ready', 8000);
}

async function stopSession(client: WsScenarioClient): Promise<TimedEvent> {
  client.send({ type: 'stop', reason: 'regression-stop' });
  return client.waitForType('end', 4000);
}

function extractSpeechEndToFirstAudio(events: TimedEvent[]): number | undefined {
  const speechEnd = events.find((e) => e.type === 'vad' && e.payload.event === 'speech_end');
  if (!speechEnd) return undefined;
  const firstTts = events.find((e) => e.type === 'tts' && e.atMs >= speechEnd.atMs);
  if (!firstTts) return undefined;
  return firstTts.atMs - speechEnd.atMs;
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`scenario timeout ${timeoutMs}ms`)), timeoutMs);
    task
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(t);
        reject(e);
      });
  });
}

function buildScenarios(
  url: string,
  verbose: boolean,
  prerequisites: RegressionPrerequisites,
  audioFixture: AudioFixture | null
): ScenarioDefinition[] {
  return [
    {
      id: 's01-lifecycle',
      name: '连接与会话生命周期',
      description: 'connect -> start -> ready -> stop -> end',
      timeoutMs: 15000,
      run: async () => {
        const client = new WsScenarioClient(url, 's01', verbose);
        const assertions: AssertionResult[] = [];
        try {
          await client.connect();
          const ready = await startSession(client, randomId('s01'));
          const end = await stopSession(client);
          assertions.push(assert('收到 ready', ready.type === 'ready'));
          assertions.push(assert('收到 end', end.type === 'end'));
          assertions.push(assert('ready 在 end 之前', ready.atMs <= end.atMs));
          return { assertions, events: client.getEvents() };
        } finally {
          await client.close();
        }
      }
    },
    {
      id: 's02-audio-before-start',
      name: '未 start 先 audio',
      description: '先发 audio 必须返回 NO_SESSION',
      timeoutMs: 12000,
      run: async () => {
        const client = new WsScenarioClient(url, 's02', verbose);
        const assertions: AssertionResult[] = [];
        try {
          await client.connect();
          const voice = createPcmFrame();
          client.send({ type: 'audio', payload_b64: voice.toString('base64'), ts_ms: Date.now() });
          const err = await client.waitFor((e) => e.type === 'error', 5000, 'error(NO_SESSION)');
          assertions.push(assert('收到 error', err.type === 'error'));
          assertions.push(assert('错误码为 NO_SESSION', err.payload.code === 'NO_SESSION', `code=${String(err.payload.code ?? '')}`));
          return { assertions, events: client.getEvents() };
        } finally {
          await client.close();
        }
      }
    },
    {
      id: 's03-audio-to-asr',
      name: '音频上行到 ASR',
      description: 'audio 可触发 asr 事件',
      timeoutMs: 25000,
      run: async () => {
        if (!prerequisites.pipeline) {
          return {
            assertions: [],
            skipReason: '缺少 ASR/TTS/LLM 必要环境变量，跳过链路场景',
            notes: ['需要同时配置 VOLC_* 与 OPENAI_API_KEY']
          };
        }
        const client = new WsScenarioClient(url, 's03', verbose);
        const assertions: AssertionResult[] = [];
        const notes: string[] = [];
        try {
          await client.connect();
          await startSession(client, randomId('s03'));
          await sendAudioSequence(client, 20, 25, 20, audioFixture);
          let asrSeen = false;
          try {
            await client.waitFor((e) => e.type === 'asr', 12000, 'asr event');
            asrSeen = true;
          } catch (e) {
            notes.push(e instanceof Error ? e.message : String(e));
          }
          assertions.push(assert('至少收到一次 asr 事件', asrSeen));
          await stopSession(client);
          return { assertions, notes, events: client.getEvents() };
        } finally {
          await client.close();
        }
      }
    },
    {
      id: 's04-asr-final-to-assistant',
      name: 'ASR final 到 assistant',
      description: 'asr final 后应出现 assistant 输出',
      timeoutMs: 30000,
      run: async () => {
        if (!prerequisites.pipeline) {
          return {
            assertions: [],
            skipReason: '缺少 ASR/TTS/LLM 必要环境变量，跳过链路场景',
            notes: ['需要同时配置 VOLC_* 与 OPENAI_API_KEY']
          };
        }
        const client = new WsScenarioClient(url, 's04', verbose);
        const assertions: AssertionResult[] = [];
        const notes: string[] = [];
        try {
          await client.connect();
          await startSession(client, randomId('s04'));
          let asrFinal: TimedEvent | null = null;
          let assistant: TimedEvent | null = null;
          for (let attempt = 1; attempt <= 2 && !assistant; attempt += 1) {
            if (attempt === 1) {
              await sendAudioSequence(client, 24, 30, 20, audioFixture);
            } else {
              notes.push('第1次未命中 asr final，执行第2次重试（更长语音）');
              await sleep(220);
              await sendAudioSequence(client, 32, 42, 20, audioFixture);
            }

            try {
              asrFinal = await client.waitFor(
                (e) => e.type === 'asr' && e.payload.is_final === true,
                attempt === 1 ? 12000 : 15000,
                `asr final (attempt ${attempt})`
              );
            } catch (e) {
              notes.push(e instanceof Error ? e.message : String(e));
            }

            if (!asrFinal) {
              continue;
            }

            try {
              assistant = await client.waitFor(
                (e) => e.type === 'assistant' && e.atMs >= asrFinal!.atMs,
                10000,
                `assistant after asr final (attempt ${attempt})`
              );
            } catch (e) {
              notes.push(e instanceof Error ? e.message : String(e));
            }
          }

          assertions.push(assert('收到 asr final', Boolean(asrFinal)));
          assertions.push(assert('asr final 后收到 assistant', Boolean(assistant)));
          await stopSession(client);
          return { assertions, notes, events: client.getEvents() };
        } finally {
          await client.close();
        }
      }
    },
    {
      id: 's05-assistant-to-tts',
      name: 'assistant 到 tts',
      description: 'assistant 输出后应出现 tts 下发',
      timeoutMs: 32000,
      run: async () => {
        if (!prerequisites.pipeline) {
          return {
            assertions: [],
            skipReason: '缺少 ASR/TTS/LLM 必要环境变量，跳过链路场景',
            notes: ['需要同时配置 VOLC_* 与 OPENAI_API_KEY']
          };
        }
        const client = new WsScenarioClient(url, 's05', verbose);
        const assertions: AssertionResult[] = [];
        const notes: string[] = [];
        const metrics: ScenarioMetric[] = [];
        try {
          await client.connect();
          await startSession(client, randomId('s05'));
          await sendAudioSequence(client, 24, 30, 20, audioFixture);

          let assistant: TimedEvent | null = null;
          let tts: TimedEvent | null = null;

          try {
            assistant = await client.waitFor((e) => e.type === 'assistant', 18000, 'assistant');
          } catch (e) {
            notes.push(e instanceof Error ? e.message : String(e));
          }

          if (assistant) {
            try {
              tts = await client.waitFor((e) => e.type === 'tts' && e.atMs >= assistant!.atMs, 12000, 'tts after assistant');
            } catch (e) {
              notes.push(e instanceof Error ? e.message : String(e));
            }
          }

          const delta = extractSpeechEndToFirstAudio(client.getEvents());
          if (typeof delta === 'number') {
            metrics.push({ name: 'speech_end_to_first_audio_ms', unit: 'ms', value: delta });
          } else {
            notes.push('未提取到 speech_end -> first_audio 指标');
          }

          assertions.push(assert('收到 assistant 输出', Boolean(assistant)));
          assertions.push(assert('assistant 后收到 tts', Boolean(tts)));

          await stopSession(client);
          return { assertions, notes, metrics, events: client.getEvents() };
        } finally {
          await client.close();
        }
      }
    },
    {
      id: 's06-barge-in',
      name: '打断语义',
      description: 'SPEAKING 期间开口触发 barge_in 并中断输出',
      timeoutMs: 30000,
      run: async () => {
        if (!prerequisites.pipeline) {
          return {
            assertions: [],
            skipReason: '缺少 ASR/TTS/LLM 必要环境变量，跳过链路场景',
            notes: ['需要同时配置 VOLC_* 与 OPENAI_API_KEY']
          };
        }
        const client = new WsScenarioClient(url, 's06', verbose);
        const assertions: AssertionResult[] = [];
        const notes: string[] = [];
        try {
          await client.connect();
          await startSession(client, randomId('s06'));
          await sendAudioSequence(client, 24, 28, 20, audioFixture);

          let firstTts: TimedEvent | null = null;
          try {
            firstTts = await client.waitForType('tts', 18000);
          } catch (e) {
            notes.push(e instanceof Error ? e.message : String(e));
          }

          let barge: TimedEvent | null = null;
          if (firstTts) {
            // 打断注入使用高能纯音，降低语音样本能量波动导致的误判。
            await sleep(120);
            await sendAudioSequence(client, 16, 8, 12, null);
            try {
              barge = await client.waitForType('barge_in', 8000);
            } catch (e) {
              notes.push(e instanceof Error ? e.message : String(e));
            }
          }

          let noImmediateTts = false;
          if (barge) {
            await sleep(350);
            const followup = client.getEvents().find((e) => e.type === 'tts' && e.atMs > barge!.atMs && e.atMs <= barge!.atMs + 300);
            noImmediateTts = !followup;
          }

          assertions.push(assert('收到打断事件 barge_in', Boolean(barge)));
          assertions.push(assert('barge_in 后短时间无继续 tts 输出', barge ? noImmediateTts : false));

          await stopSession(client);
          return { assertions, notes, events: client.getEvents() };
        } finally {
          await client.close();
        }
      }
    },
    {
      id: 's07-close-mic-recovery',
      name: 'close_mic 恢复能力',
      description: 'close_mic 后可继续新一轮输入',
      timeoutMs: 22000,
      run: async () => {
        if (!prerequisites.pipeline) {
          return {
            assertions: [],
            skipReason: '缺少 ASR/TTS/LLM 必要环境变量，跳过链路场景',
            notes: ['需要同时配置 VOLC_* 与 OPENAI_API_KEY']
          };
        }
        const client = new WsScenarioClient(url, 's07', verbose);
        const assertions: AssertionResult[] = [];
        const notes: string[] = [];
        try {
          await client.connect();
          await startSession(client, randomId('s07'));

          client.send({ type: 'close_mic' });
          // close_mic 会重建 ASR 客户端，给恢复留一点缓冲时间。
          await sleep(450);
          await sendAudioSequence(client, 24, 24, 20, audioFixture);

          let asrSeen = false;
          try {
            await client.waitFor((e) => e.type === 'asr', 10000, 'asr after close_mic');
            asrSeen = true;
          } catch (e) {
            notes.push(e instanceof Error ? e.message : String(e));
          }

          assertions.push(assert('close_mic 后仍可收到 asr', asrSeen));
          await stopSession(client);
          return { assertions, notes, events: client.getEvents() };
        } finally {
          await client.close();
        }
      }
    },
    {
      id: 's08-ping-pong',
      name: '保活链路',
      description: 'ping 必须返回 pong',
      timeoutMs: 10000,
      run: async () => {
        const client = new WsScenarioClient(url, 's08', verbose);
        const assertions: AssertionResult[] = [];
        try {
          await client.connect();
          client.send({ type: 'ping' });
          const pong = await client.waitForType('pong', 2500);
          assertions.push(assert('收到 pong', pong.type === 'pong'));
          return { assertions, events: client.getEvents() };
        } finally {
          await client.close();
        }
      }
    },
    {
      id: 's09-invalid-message',
      name: '非法消息健壮性',
      description: '非法 payload 返回错误且连接继续可用',
      timeoutMs: 14000,
      run: async () => {
        const client = new WsScenarioClient(url, 's09', verbose);
        const assertions: AssertionResult[] = [];
        const notes: string[] = [];
        try {
          await client.connect();
          client.sendRaw('this-is-not-json');

          let err: TimedEvent | null = null;
          try {
            err = await client.waitFor(
              (e) => e.type === 'error' && e.payload.code === 'WS_HANDLER_ERROR',
              5000,
              'WS_HANDLER_ERROR'
            );
          } catch (e) {
            notes.push(e instanceof Error ? e.message : String(e));
          }

          client.send({ type: 'ping' });
          let pong: TimedEvent | null = null;
          try {
            pong = await client.waitForType('pong', 3000);
          } catch (e) {
            notes.push(e instanceof Error ? e.message : String(e));
          }

          assertions.push(assert('收到 WS_HANDLER_ERROR', Boolean(err)));
          assertions.push(assert('异常后连接仍可返回 pong', Boolean(pong)));
          return { assertions, notes, events: client.getEvents() };
        } finally {
          await client.close();
        }
      }
    },
    {
      id: 's10-disconnect-cleanup',
      name: '断连清理能力',
      description: '客户端断连后服务仍可处理新连接',
      timeoutMs: 16000,
      run: async () => {
        const c1 = new WsScenarioClient(url, 's10-c1', verbose);
        const c2 = new WsScenarioClient(url, 's10-c2', verbose);
        const assertions: AssertionResult[] = [];
        const notes: string[] = [];
        try {
          await c1.connect();
          await startSession(c1, randomId('s10'));
          await c1.close();
          await sleep(350);

          await c2.connect();
          c2.send({ type: 'ping' });

          let pong: TimedEvent | null = null;
          try {
            pong = await c2.waitForType('pong', 3000);
          } catch (e) {
            notes.push(e instanceof Error ? e.message : String(e));
          }
          assertions.push(assert('断连后新连接可正常 pong', Boolean(pong)));
          return { assertions, notes, events: [...c1.getEvents(), ...c2.getEvents()] };
        } finally {
          await c1.close();
          await c2.close();
        }
      }
    }
  ];
}

function selectScenarios(all: ScenarioDefinition[], ids: string[]): ScenarioDefinition[] {
  if (ids.length === 0) return all;
  const wanted = new Set(ids);
  return all.filter((s) => wanted.has(s.id));
}

function detectPrerequisites(): RegressionPrerequisites {
  const hasAsr =
    Boolean(process.env.VOLC_APP_KEY) &&
    Boolean(process.env.VOLC_ACCESS_KEY) &&
    Boolean(process.env.VOLC_ASR_RESOURCE_ID || process.env.VOLC_RESOURCE_ID);
  const hasTts =
    Boolean(process.env.VOLC_APP_KEY) &&
    Boolean(process.env.VOLC_ACCESS_KEY) &&
    Boolean(process.env.VOLC_TTS_RESOURCE_ID || process.env.VOLC_RESOURCE_ID);
  const hasLlm = Boolean(process.env.OPENAI_API_KEY);

  return {
    asr: hasAsr,
    tts: hasTts,
    llm: hasLlm,
    pipeline: hasAsr && hasTts && hasLlm
  };
}

async function getGitMeta(): Promise<{ branch: string; head: string }> {
  const exec = async (args: string[]): Promise<string> => {
    return new Promise<string>((resolve) => {
      const p = spawn('git', args, { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      p.stdout.on('data', (d) => {
        out += d.toString('utf8');
      });
      p.on('close', () => resolve(out.trim()));
    });
  };

  const branch = (await exec(['rev-parse', '--abbrev-ref', 'HEAD'])) || 'unknown';
  const head = (await exec(['rev-parse', '--short', 'HEAD'])) || 'unknown';
  return { branch, head };
}

async function waitForServer(url: string, timeoutMs: number, verbose: boolean): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const client = new WsScenarioClient(url, 'probe', verbose);
      await client.connect(1200);
      await client.close();
      return;
    } catch {
      await sleep(300);
    }
  }
  throw new Error(`server not ready within ${timeoutMs}ms`);
}

async function startServerForRegression(url: string, verbose: boolean): Promise<{ proc: ChildProcess; stop: () => Promise<void> }> {
  const proc = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      // 回归矩阵默认要求验证打断能力，固定开启，避免被外部 shell 覆盖为 false。
      ENABLE_BARGE_IN: 'true',
      DEBUG_VOICE: process.env.DEBUG_VOICE ?? '0',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? 'regression-dummy-key'
    },
    stdio: verbose ? 'inherit' : 'ignore'
  });

  try {
    await waitForServer(url, 12000, false);
  } catch (err) {
    try {
      proc.kill('SIGTERM');
    } catch {
      // ignore
    }
    throw err;
  }

  return {
    proc,
    stop: async () => {
      if (proc.exitCode !== null) return;
      await new Promise<void>((resolve) => {
        proc.once('close', () => resolve());
        proc.kill('SIGTERM');
        setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // ignore
          }
          resolve();
        }, 2500);
      });
    }
  };
}

async function runScenario(def: ScenarioDefinition): Promise<ScenarioOutput> {
  const startedAt = nowIso();
  const t0 = Date.now();
  let assertions: AssertionResult[] = [];
  let metrics: ScenarioMetric[] = [];
  let notes: string[] = [];
  let events: TimedEvent[] = [];
  let error: string | undefined;
  let skipReason: string | undefined;

  try {
    const result = await withTimeout(def.run(), def.timeoutMs);
    assertions = result.assertions;
    metrics = result.metrics ?? [];
    notes = result.notes ?? [];
    events = result.events ?? [];
    skipReason = result.skipReason;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    assertions.push(assert('场景执行无未捕获错误', false, error));
  }

  const status: ScenarioStatus = skipReason
    ? 'skip'
    : assertions.every((a) => a.pass)
    ? 'pass'
    : 'fail';
  const endedAt = nowIso();

  if (events.length > 120) {
    events = events.slice(-120);
    notes.push('事件明细已截断为最近 120 条');
  }

  return {
    id: def.id,
    name: def.name,
    description: def.description,
    status,
    startedAt,
    endedAt,
    durationMs: Date.now() - t0,
    assertions,
    metrics,
    notes,
    skipReason,
    error,
    events: events.map((e) => ({ atMs: e.atMs, type: e.type, payload: e.payload }))
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = randomId('a-channel-regression');
  const startedAt = nowIso();
  const t0 = Date.now();
  let audioFixture: AudioFixture | null = null;
  if (options.audioFile) {
    try {
      audioFixture = await loadAudioFixture(options.audioFile);
      console.log(
        `音频夹具: ${audioFixture.path} (frames=${audioFixture.frames.length}, rms_p50=${audioFixture.rmsP50.toFixed(
          4
        )}, rms_p95=${audioFixture.rmsP95.toFixed(4)})`
      );
    } catch (err) {
      console.warn(
        `音频夹具加载失败，回退为内置纯音帧: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    console.log('音频夹具: 未配置，使用内置纯音帧');
  }

  const prerequisites = detectPrerequisites();
  const scenarios = buildScenarios(options.url, options.verbose, prerequisites, audioFixture);
  const selected = selectScenarios(scenarios, options.scenarioIds);

  if (selected.length === 0) {
    console.error('未匹配到任何场景，请检查 --scenarios 参数');
    process.exit(2);
  }

  const git = await getGitMeta();

  let serverCtl: { proc: ChildProcess; stop: () => Promise<void> } | null = null;
  if (options.spawnServer) {
    console.log('启动本地服务用于回归...');
    serverCtl = await startServerForRegression(options.url, options.verbose);
  }

  const scenarioOutputs: ScenarioOutput[] = [];
  try {
    for (const scenario of selected) {
      console.log(`\n[RUN] ${scenario.id} ${scenario.name}`);
      const out = await runScenario(scenario);
      scenarioOutputs.push(out);
      console.log(`[${out.status.toUpperCase()}] ${scenario.id} (${out.durationMs}ms)`);
      for (const a of out.assertions) {
        if (!a.pass) {
          console.log(`  - FAIL ${a.name}${a.details ? `: ${a.details}` : ''}`);
        }
      }
    }
  } finally {
    if (serverCtl) {
      await serverCtl.stop();
    }
  }

  const metricValues = scenarioOutputs
    .flatMap((s) => s.metrics)
    .filter((m) => m.name === 'speech_end_to_first_audio_ms')
    .map((m) => m.value);

  const p50 = percentile(metricValues, 50);
  const p95 = percentile(metricValues, 95);
  const thresholdStatus: 'pass' | 'fail' | 'na' =
    typeof p50 === 'number' && typeof p95 === 'number'
      ? p50 <= THRESHOLDS.p50Ms && p95 <= THRESHOLDS.p95Ms
        ? 'pass'
        : 'fail'
      : 'na';

  const failed = scenarioOutputs.filter((s) => s.status === 'fail').length;
  const passed = scenarioOutputs.filter((s) => s.status === 'pass').length;
  const skipped = scenarioOutputs.filter((s) => s.status === 'skip').length;

  const thresholdGateActive = options.gateStage === 'C' && options.enforceThresholds;
  let status: RunStatus = failed > 0 ? 'fail' : 'pass';
  if (status === 'pass' && thresholdStatus === 'fail') {
    if (thresholdGateActive) {
      status = 'fail';
    } else if (options.gateStage === 'B') {
      status = 'warn';
    }
  }

  const output: RunOutput = {
    runId,
    startedAt,
    endedAt: nowIso(),
    durationMs: Date.now() - t0,
    git,
    options: {
      url: options.url,
      selectedScenarios: selected.map((s) => s.id),
      gateStage: options.gateStage,
      spawnServer: options.spawnServer,
      enforceThresholds: options.enforceThresholds,
      audioFile: audioFixture?.path,
      prerequisites
    },
    thresholds: {
      metric: 'speech_end_to_first_audio_ms',
      p50Ms: THRESHOLDS.p50Ms,
      p95Ms: THRESHOLDS.p95Ms,
      stage: options.gateStage,
      appliedAsFailure: thresholdGateActive
    },
    performance: {
      sampleCount: metricValues.length,
      p50Ms: p50,
      p95Ms: p95,
      thresholdStatus
    },
    summary: {
      total: scenarioOutputs.length,
      passed,
      failed,
      skipped,
      status
    },
    scenarios: scenarioOutputs
  };

  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, JSON.stringify(output, null, 2), 'utf8');

  console.log('\n=== A 通道回归汇总 ===');
  console.log(`输出文件: ${options.output}`);
  console.log(`场景结果: pass=${passed}, fail=${failed}, skip=${skipped}`);
  console.log(
    `依赖检测: pipeline=${prerequisites.pipeline} (asr=${prerequisites.asr}, tts=${prerequisites.tts}, llm=${prerequisites.llm})`
  );
  console.log(`性能样本: ${metricValues.length}`);
  console.log(`性能阈值: p50<=${THRESHOLDS.p50Ms}ms, p95<=${THRESHOLDS.p95Ms}ms`);
  if (typeof p50 === 'number' && typeof p95 === 'number') {
    console.log(`实际性能: p50=${Math.round(p50)}ms, p95=${Math.round(p95)}ms, status=${thresholdStatus}`);
  } else {
    console.log('实际性能: 样本不足（status=na）');
  }
  console.log(`总状态: ${status}`);

  if (status === 'fail') {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('回归执行失败:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
