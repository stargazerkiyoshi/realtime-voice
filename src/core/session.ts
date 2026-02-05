import { EventBus } from './event-bus';
import type { Event } from './events';
import { State, FSM } from './fsm';
import { ConversationContext } from './context';
import { BargeInController } from './barge-in';
import { SimpleEnergyVAD } from '../audio/vad';
import { LLMClient } from '../llm/llm-base';
import { Chunker } from '../llm/chunker';
import { TTSClient } from '../tts/tts-base';
import { PlaybackQueue } from '../tts/playback';
import { AsrClient } from '../asr/asr-base';
import { config } from '../config';
import { logger } from '../observability/logger';

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
  private asr = new AsrClient();

  private playback = new PlaybackQueue();
  private barge = new BargeInController(this.playback);

  private playbackTask: Promise<void> | null = null;
  private runnerTask: Promise<void> | null = null;
  private asrTask: Promise<void> | null = null;
  private asrRestarting = false;

  private turnPcm = Buffer.alloc(0);
  private audioInPackets = 0;
  private asrPartials = 0;
  private ttsChunks = 0;

  constructor(sessionId: string, sendJson: SendJson) {
    this.sessionId = sessionId;
    this.sendJson = sendJson;
  }

  async start() {
    logger.info('session start', { sid: this.sessionId });
    await this.sendJson({ type: 'ready', session_id: this.sessionId });
    this.fsm.state = State.LISTENING;
    this.playbackTask = this.playbackLoop();
    this.runnerTask = this.eventLoop();
  }

  async stop(reason = 'stop') {
    logger.info('session stop requested', { sid: this.sessionId, reason });
    await this.bus.emit({ type: 'SESSION_END_REQUEST', data: { reason }, ts_ms: nowMs() });
  }

  async feedAudio(pcm16: Buffer, tsMs: number) {
    this.audioInPackets += 1;
    if (this.audioInPackets % 20 === 0) {
      logger.debug('session audio in', { sid: this.sessionId, packets: this.audioInPackets, bytes: pcm16.length });
    }
    await this.bus.emit({ type: 'AUDIO_IN', data: { pcm16 }, ts_ms: tsMs });
  }

  private async playbackLoop() {
    while (this.fsm.state !== State.ENDED) {
      const audio = await this.playback.get();
      if (this.playback.isStopped()) continue;
      this.ttsChunks += 1;
      if (this.ttsChunks % 10 === 0) {
        logger.debug('session playback chunk', { sid: this.sessionId, chunks: this.ttsChunks, bytes: audio.length });
      }
      await this.sendJson({
        type: 'tts',
        seq: 0,
        format: 'pcm16',
        sample_rate: config.volcSampleRate,
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
        logger.info('session ending', { sid: this.sessionId, event: e.type, data: e.data });
        this.barge.interrupt();
        this.fsm.state = State.ENDED;
        if (e.type === 'ERROR') {
          await this.sendJson({
            type: 'error',
            code: 'SESSION_ERROR',
            message: String((e.data as any).message ?? (e.data as any).reason ?? 'unknown')
          });
        }
        await this.sendJson({ type: 'end', reason: (e.data as any).reason ?? 'ended' });
        if (typeof this.asr.planClose === 'function') this.asr.planClose();
        await this.asr.close();
        await this.tts.close();
        break;
      }

      if (this.fsm.state === State.LISTENING) {
        if (e.type === 'AUDIO_IN') {
          const pcm16 = (e.data as any).pcm16 as Buffer;
          this.turnPcm = Buffer.concat([this.turnPcm, pcm16]);

          if (!this.asrTask) {
            this.asrTask = this.asrLoop();
          }
          await this.asr.feed(pcm16);

          for (const ev of this.vad.process(pcm16)) {
            if (ev === 'speech_start') {
              await this.sendJson({ type: 'vad', event: 'speech_start', ts_ms: e.ts_ms });
            } else if (ev === 'speech_end') {
              await this.sendJson({ type: 'vad', event: 'speech_end', ts_ms: e.ts_ms });
              await this.restartAsrForNextTurn();
            }
          }
        } else if (e.type === 'ASR_PARTIAL') {
          this.asrPartials += 1;
          if (this.asrPartials % 5 === 0) {
            logger.debug('asr partial count', { sid: this.sessionId, partials: this.asrPartials });
          }
          const text = (e.data as any).text as string;
          const confidence = (e.data as any).confidence as number | undefined;
          await this.sendJson({ type: 'asr', is_final: false, text, confidence, ts_ms: e.ts_ms });
        } else if (e.type === 'ASR_FINAL') {
          logger.info('asr final', { sid: this.sessionId, text: (e.data as any).text });
          const text = (e.data as any).text as string;
          const confidence = (e.data as any).confidence as number | undefined;
          const start_ms = (e.data as any).startMs as number | undefined;
          const end_ms = (e.data as any).endMs as number | undefined;
          await this.sendJson({ type: 'asr', is_final: true, text, confidence, start_ms, end_ms, ts_ms: e.ts_ms });

          this.ctx.turnId += 1;
          this.ctx.history.push({ role: 'user', content: text });

          this.fsm.state = State.THINKING;

          llmAbort = new AbortController();
          const llmSignal = llmAbort.signal;
          const runLLM = async () => {
            try {
              logger.info('llm stream start', { sid: this.sessionId });
              for await (const delta of this.llm.stream(this.ctx.history.slice(-10), llmSignal)) {
                await this.bus.emit({ type: 'LLM_TOKEN', data: { delta }, ts_ms: nowMs() });
              }
              logger.info('llm stream done', { sid: this.sessionId });
              await this.bus.emit({ type: 'LLM_DONE', data: {}, ts_ms: nowMs() });
            } catch {
              logger.warn('llm stream aborted', { sid: this.sessionId });
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
          logger.info('assistant chunk', { sid: this.sessionId, len: text.length });
          await this.sendJson({ type: 'assistant', text });

          this.fsm.state = State.SPEAKING;
          this.playback.resume();

          if (!ttsAbort) ttsAbort = new AbortController();
          const ttsSignal = ttsAbort.signal;
          const runTTS = async () => {
            try {
              logger.info('tts stream start', { sid: this.sessionId, len: text.length });
              for await (const audio of this.tts.stream(text, ttsSignal)) {
                await this.playback.put(audio);
              }
              logger.info('tts stream done', { sid: this.sessionId });
              await this.bus.emit({ type: 'TTS_DONE', data: {}, ts_ms: nowMs() });
            } catch {
              logger.warn('tts stream aborted', { sid: this.sessionId });
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
              logger.info('tts append stream start', { sid: this.sessionId, len: text.length });
              for await (const audio of this.tts.stream(text, ttsSignal)) {
                await this.playback.put(audio);
              }
              logger.info('tts append stream done', { sid: this.sessionId });
              await this.bus.emit({ type: 'TTS_DONE', data: {}, ts_ms: nowMs() });
            } catch {
              logger.warn('tts append stream aborted', { sid: this.sessionId });
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
        } else if (e.type === 'TTS_DONE') {
          // Playback will still drain any queued audio; we switch to listening for the next turn.
          this.fsm.state = State.LISTENING;
          this.turnPcm = Buffer.alloc(0);
          llmAbort = null;
          ttsAbort = null;
        }
      }
    }
  }

  private async asrLoop() {
    try {
      logger.info('asr loop start', { sid: this.sessionId });
      for await (const res of this.asr.stream()) {
        const type = res.isFinal ? 'ASR_FINAL' : 'ASR_PARTIAL';
        logger.debug('asr result', { sid: this.sessionId, type, textLen: res.text.length, isFinal: Boolean(res.isFinal) });
        await this.bus.emit({
          type,
          data: {
            text: res.text,
            confidence: res.confidence,
            startMs: res.startMs,
            endMs: res.endMs
          },
          ts_ms: nowMs()
        });
      }
      if (this.fsm.state !== State.ENDED) {
        if (this.asrRestarting) {
          logger.info('asr loop ended due to planned restart', { sid: this.sessionId });
          return;
        }
        if (typeof this.asr.isPlannedClose === 'function' && this.asr.isPlannedClose()) {
          logger.info('asr loop ended after idle close', { sid: this.sessionId });
          await this.restartAsrForNextTurn();
          return;
        }
        logger.warn('asr loop ended unexpectedly', { sid: this.sessionId });
        await this.bus.emit({
          type: 'ERROR',
          data: { reason: 'asr_stream_ended', message: 'ASR stream ended unexpectedly' },
          ts_ms: nowMs()
        });
      }
    } catch (e) {
      if (this.asrRestarting) {
        logger.info('asr loop stopped during planned restart', { sid: this.sessionId });
        return;
      }
      logger.error('asr loop error', { sid: this.sessionId, error: e });
      if (this.fsm.state !== State.ENDED) {
        await this.bus.emit({
          type: 'ERROR',
          data: {
            reason: 'asr_stream_error',
            message: e instanceof Error ? e.message : String(e)
          },
          ts_ms: nowMs()
        });
      }
    } finally {
      this.asrTask = null;
    }
  }

  private async restartAsrForNextTurn() {
    if (this.asrRestarting || this.fsm.state === State.ENDED) return;
    this.asrRestarting = true;
    logger.info('asr restart begin', { sid: this.sessionId });
    try {
      if (typeof this.asr.planClose === 'function') this.asr.planClose();
      await this.asr.close();
      if (this.asrTask) {
        await this.asrTask;
      }
      this.asr = new AsrClient();
      logger.info('asr restart complete', { sid: this.sessionId });
    } finally {
      this.asrRestarting = false;
    }
  }

  async handleMicClose() {
    logger.info('session mic close', { sid: this.sessionId });
    await this.restartAsrForNextTurn();
  }
}
