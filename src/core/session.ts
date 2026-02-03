import { EventBus } from './event_bus';
import type { Event } from './events';
import { State, FSM } from './fsm';
import { ConversationContext } from './context';
import { BargeInController } from './barge_in';
import { SimpleEnergyVAD } from '../audio/vad';
import { LLMClient } from '../llm/llm_base';
import { Chunker } from '../llm/chunker';
import { TTSClient } from '../tts/tts_base';
import { PlaybackQueue } from '../tts/playback';

const nowMs = () => Date.now();

type SendJson = (payload: Record<string, unknown>) => Promise<void>;

export class Session {
  sessionId: string;
  sendJson: SendJson;

  private bus = new EventBus();
  private fsm = new FSM();
  private ctx = new ConversationContext();

  private vad = new SimpleEnergyVAD();
  private llm = new LLMClient();
  private tts = new TTSClient();
  private chunker = new Chunker();

  private playback = new PlaybackQueue();
  private barge = new BargeInController(this.playback);

  private playbackTask: Promise<void> | null = null;
  private runnerTask: Promise<void> | null = null;

  private turnPcm = Buffer.alloc(0);

  constructor(sessionId: string, sendJson: SendJson) {
    this.sessionId = sessionId;
    this.sendJson = sendJson;
  }

  async start() {
    await this.sendJson({ type: 'ready', session_id: this.sessionId });
    this.fsm.state = State.LISTENING;
    this.playbackTask = this.playbackLoop();
    this.runnerTask = this.eventLoop();
  }

  async stop(reason = 'stop') {
    await this.bus.emit({ type: 'SESSION_END_REQUEST', data: { reason }, ts_ms: nowMs() });
  }

  async feedAudio(pcm16: Buffer, tsMs: number) {
    await this.bus.emit({ type: 'AUDIO_IN', data: { pcm16 }, ts_ms: tsMs });
  }

  private async playbackLoop() {
    while (this.fsm.state !== State.ENDED) {
      const audio = await this.playback.get();
      if (this.playback.isStopped()) continue;
      await this.sendJson({
        type: 'tts',
        seq: 0,
        format: 'pcm16',
        sample_rate: 24000,
        payload_b64: audio.toString('base64')
      });
    }
  }

  private async eventLoop() {
    let llmAbort: AbortController | null = null;
    let ttsAbort: AbortController | null = null;

    while (this.fsm.state !== State.ENDED) {
      const e = await this.bus.next();

      if (e.type === 'SESSION_END_REQUEST' || e.type === 'REMOTE_HANGUP' || e.type === 'ERROR') {
        this.barge.interrupt();
        this.fsm.state = State.ENDED;
        await this.sendJson({ type: 'end', reason: (e.data as any).reason ?? 'ended' });
        break;
      }

      if (this.fsm.state === State.LISTENING) {
        if (e.type === 'AUDIO_IN') {
          const pcm16 = (e.data as any).pcm16 as Buffer;
          this.turnPcm = Buffer.concat([this.turnPcm, pcm16]);

          for (const ev of this.vad.process(pcm16)) {
            if (ev === 'speech_start') {
              await this.sendJson({ type: 'vad', event: 'speech_start', ts_ms: e.ts_ms });
            } else if (ev === 'speech_end') {
              await this.sendJson({ type: 'vad', event: 'speech_end', ts_ms: e.ts_ms });
              await this.bus.emit({
                type: 'ASR_FINAL',
                data: { text: '（ASR占位）我说了一句话' },
                ts_ms: nowMs()
              });
            }
          }
        } else if (e.type === 'ASR_FINAL') {
          const text = (e.data as any).text as string;
          await this.sendJson({ type: 'asr', is_final: true, text, ts_ms: e.ts_ms });

          this.ctx.turnId += 1;
          this.ctx.history.push({ role: 'user', content: text });

          this.fsm.state = State.THINKING;

          llmAbort = new AbortController();
          const llmSignal = llmAbort.signal;
          const runLLM = async () => {
            try {
              for await (const delta of this.llm.stream(this.ctx.history.slice(-10), llmSignal)) {
                await this.bus.emit({ type: 'LLM_TOKEN', data: { delta }, ts_ms: nowMs() });
              }
              await this.bus.emit({ type: 'LLM_DONE', data: {}, ts_ms: nowMs() });
            } catch {
              return;
            }
          };
          void runLLM();
          this.barge.bindControllers(llmAbort, ttsAbort);
        }
      } else if (this.fsm.state === State.THINKING) {
        if (e.type === 'LLM_TOKEN') {
          const chunks = this.chunker.push((e.data as any).delta as string);
          for (const c of chunks) {
            await this.bus.emit({ type: 'ASSISTANT_CHUNK', data: { text: c }, ts_ms: nowMs() });
          }
        } else if (e.type === 'ASSISTANT_CHUNK') {
          const text = (e.data as any).text as string;
          await this.sendJson({ type: 'assistant', text });

          this.fsm.state = State.SPEAKING;
          this.playback.resume();

          if (!ttsAbort) ttsAbort = new AbortController();
          const ttsSignal = ttsAbort.signal;
          const runTTS = async () => {
            try {
              for await (const audio of this.tts.stream(text, ttsSignal)) {
                await this.playback.put(audio);
              }
            } catch {
              return;
            }
          };
          void runTTS();
          this.barge.bindControllers(llmAbort, ttsAbort);
        } else if (e.type === 'LLM_DONE') {
          for (const c of this.chunker.flush()) {
            await this.bus.emit({ type: 'ASSISTANT_CHUNK', data: { text: c }, ts_ms: nowMs() });
          }
          if (this.fsm.state === State.THINKING) {
            this.fsm.state = State.LISTENING;
          }
        }
      } else if (this.fsm.state === State.SPEAKING) {
        if (e.type === 'AUDIO_IN') {
          const pcm16 = (e.data as any).pcm16 as Buffer;
          for (const ev of this.vad.process(pcm16)) {
            if (ev === 'speech_start') {
              await this.bus.emit({ type: 'BARGE_IN', data: {}, ts_ms: nowMs() });
              break;
            }
          }
        } else if (e.type === 'ASSISTANT_CHUNK') {
          const text = (e.data as any).text as string;
          if (!ttsAbort) ttsAbort = new AbortController();
          const ttsSignal = ttsAbort.signal;
          const runTTS = async () => {
            try {
              for await (const audio of this.tts.stream(text, ttsSignal)) {
                await this.playback.put(audio);
              }
            } catch {
              return;
            }
          };
          void runTTS();
          this.barge.bindControllers(llmAbort, ttsAbort);
        } else if (e.type === 'BARGE_IN') {
          await this.sendJson({ type: 'barge_in' });
          this.barge.interrupt();
          this.playback.resume();
          this.chunker.flush();
          this.fsm.state = State.LISTENING;
          this.turnPcm = Buffer.alloc(0);
          llmAbort = null;
          ttsAbort = null;
        }
      }
    }
  }
}
