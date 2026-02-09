import { FSM, State } from './fsm';
import { ConversationContext } from './context';
import { SimpleEnergyVAD } from '../audio/vad';
import { LLMClient } from '../llm/llm-base';
import { Chunker } from '../llm/chunker';
import { TTSClient } from '../tts/tts-base';
import { PlaybackQueue } from '../tts/playback';
import { AsrClient } from '../asr/asr-base';
import { config } from '../config';
import { logger } from '../observability/logger';
import { WavWriter } from '../audio/wav-writer';
import { AsyncQueue } from './async-queue';
import path from 'node:path';
import { TtsStreamSession } from '../tts/tts-base';

const nowMs = () => Date.now();

type SendJson = (payload: Record<string, unknown>) => Promise<void>;

type LatencyMark = {
  utteranceId: number;
  vadSpeechEndMs?: number;
  asrFinalMs?: number;
  assistantFirstMs?: number;
  ttsFirstAudioMs?: number;
  playbackFirstMs?: number;
  asrFinalTextLen?: number;
};

export class Session {
  sessionId: string;
  sendJson: SendJson;

  private fsm = new FSM();
  private ctx = new ConversationContext();

  private vad = new SimpleEnergyVAD(16000, 10);
  private llm = new LLMClient();
  private tts = new TTSClient();
  private chunker = new Chunker({ firstMinChars: 2, minChars: 14, maxChars: 40 });
  private asr = new AsrClient();

  private playback = new PlaybackQueue();
  private backendVadEnabled = config.enableBackendVad;
  private bargeEnabled = config.enableBargeIn;
  private speechActive = false;
  private vadEndTimer: NodeJS.Timeout | null = null;
  private vadEndMs = 600;
  private asrClosing = false;

  private inputQueue = new AsyncQueue<{ pcm16: Buffer; tsMs: number }>();
  private inputTask: Promise<void> | null = null;
  private asrTask: Promise<void> | null = null;
  private playbackTask: Promise<void> | null = null;

  private llmAbort: AbortController | null = null;
  private ttsAbort: AbortController | null = null;
  private assistantRunId = 0;

  private audioInPackets = 0;
  private asrPartials = 0;
  private ttsChunks = 0;
  private wavWriter: WavWriter | null = null;
  private recordPath: string | null = null;
  private lastSpeechEndMs: number | null = null;
  private perfSeq = 0;
  private playbackMark: { runId: number; mark: LatencyMark } | null = null;

  constructor(sessionId: string, sendJson: SendJson) {
    this.sessionId = sessionId;
    this.sendJson = sendJson;
  }

  async start() {
    logger.info('session start', { sid: this.sessionId });
    await this.sendJson({ type: 'ready', session_id: this.sessionId });
    this.fsm.state = State.LISTENING;
    await this.startRecording();
    this.playbackTask = this.playbackLoop();
    this.inputTask = this.inputLoop();
  }

  async stop(reason = 'stop') {
    if (this.fsm.state === State.ENDED) return;
    logger.info('session stop requested', { sid: this.sessionId, reason });
    this.fsm.state = State.ENDED;
    this.clearVadEndTimer();
    this.playbackMark = null;
    this.interruptAssistant('session_end');
    try {
      await this.sendJson({ type: 'end', reason });
    } catch {
      // ignore send failures during shutdown
    }
    if (typeof this.asr.planClose === 'function') this.asr.planClose();
    await this.asr.close();
    await this.tts.close();
    await this.stopRecording();
  }

  async feedAudio(pcm16: Buffer, tsMs: number) {
    if (!this.bargeEnabled && this.fsm.state === State.SPEAKING) {
      // 在顺序对话模式下，播放期间不处理上行音频，避免 TTS 回录触发 ASR
      return;
    }
    if (this.fsm.state === State.ENDED) return;

    this.audioInPackets += 1;
    if (this.wavWriter) {
      try {
        await this.wavWriter.write(pcm16);
      } catch (err) {
        logger.warn('session record write failed', {
          sid: this.sessionId,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    if (this.audioInPackets % 20 === 0) {
      const { rms, zeroSamples, samples } = this.summarizePcm(pcm16);
      logger.debug('session audio in', {
        sid: this.sessionId,
        packets: this.audioInPackets,
        bytes: pcm16.length,
        rms: Number(rms.toFixed(6)),
        zero_pct: samples > 0 ? Number(((zeroSamples / samples) * 100).toFixed(2)) : 0
      });
    }

    this.inputQueue.push({ pcm16, tsMs });
  }

  private async inputLoop() {
    while (this.fsm.state !== State.ENDED) {
      const { pcm16, tsMs } = await this.inputQueue.next();

      const wasSpeechActive = this.speechActive;
      let vadStarted = false;
      if (this.backendVadEnabled) {
        for (const ev of this.vad.process(pcm16)) {
          if (ev === 'speech_start') {
            vadStarted = true;
            this.speechActive = true;
            this.clearVadEndTimer();
            await this.sendJson({ type: 'vad', event: 'speech_start', ts_ms: tsMs });
            if (this.fsm.state === State.SPEAKING && this.bargeEnabled) {
              await this.handleBargeIn();
              break;
            }
          } else if (ev === 'speech_end') {
            this.speechActive = false;
            this.lastSpeechEndMs = tsMs;
            await this.sendJson({ type: 'vad', event: 'speech_end', ts_ms: tsMs });
            this.scheduleVadEnd();
          }
        }
      } else {
        this.speechActive = true;
      }

      if (this.fsm.state !== State.LISTENING) {
        continue;
      }

      const shouldFeed = this.speechActive || vadStarted || wasSpeechActive;
      if (shouldFeed && !this.asrClosing) {
        this.ensureAsrLoop();
        await this.asr.feed(pcm16);
      }
    }
  }

  private ensureAsrLoop() {
    if (this.asrTask || this.fsm.state === State.ENDED) return;
    this.asrTask = this.asrLoop();
  }

  private async asrLoop() {
    try {
      logger.info('asr loop start', { sid: this.sessionId });
      for await (const res of this.asr.stream()) {
        if (res.isFinal) {
          await this.handleAsrFinal(res.text, res.confidence, res.startMs, res.endMs);
        } else {
          await this.handleAsrPartial(res.text, res.confidence);
        }
      }
      if (this.fsm.state !== State.ENDED) {
        logger.info('asr loop ended', { sid: this.sessionId });
      }
    } catch (e) {
      logger.error('asr loop error', { sid: this.sessionId, error: e });
      if (this.fsm.state !== State.ENDED) {
        await this.sendJson({
          type: 'error',
          code: 'ASR_ERROR',
          message: e instanceof Error ? e.message : String(e)
        });
      }
    } finally {
      this.asrTask = null;
      if (this.fsm.state !== State.ENDED) {
        this.asr = new AsrClient();
        this.asrClosing = false;
      }
    }
  }

  private async handleAsrPartial(text: string, confidence?: number) {
    if (text.length === 0) return;
    this.asrPartials += 1;
    if (this.asrPartials % 5 === 0) {
      logger.debug('asr partial count', { sid: this.sessionId, partials: this.asrPartials });
    }
    if (this.fsm.state !== State.LISTENING) return;
    await this.sendJson({ type: 'asr', is_final: false, text, confidence, ts_ms: nowMs() });
  }

  private async handleAsrFinal(text: string, confidence?: number, start_ms?: number, end_ms?: number) {
    if (!text || this.fsm.state !== State.LISTENING) return;
    logger.info('asr final', { sid: this.sessionId, text });
    await this.sendJson({ type: 'asr', is_final: true, text, confidence, start_ms, end_ms, ts_ms: nowMs() });

    this.ctx.turnId += 1;
    this.ctx.history.push({ role: 'user', content: text });

    const perf: LatencyMark = {
      utteranceId: ++this.perfSeq,
      vadSpeechEndMs: this.lastSpeechEndMs ?? undefined,
      asrFinalMs: nowMs(),
      asrFinalTextLen: text.length
    };
    this.lastSpeechEndMs = null;

    void this.runAssistant(text, perf);
  }

  private async runAssistant(text: string, perf?: LatencyMark) {
    if (this.fsm.state === State.ENDED) return;
    const runId = ++this.assistantRunId;

    this.fsm.state = State.SPEAKING;
    this.playback.resume();

    if (this.llmAbort) this.llmAbort.abort();
    if (this.ttsAbort) this.ttsAbort.abort();
    this.llmAbort = new AbortController();
    this.ttsAbort = new AbortController();

    const llmSignal = this.llmAbort.signal;
    const ttsSignal = this.ttsAbort.signal;

    const perfMark = perf;
    if (perfMark) {
      this.playbackMark = { runId, mark: perfMark };
    }

    let ttsSession: TtsStreamSession | null = null;
    let ttsAudioTask: Promise<void> | null = null;
    let ttsQueue: AsyncQueue<string | null> | null = null;
    let ttsWorker: Promise<void> | null = null;

    try {
      ttsSession = await this.tts.openStream(ttsSignal);
      ttsAudioTask = (async () => {
        try {
          for await (const audio of ttsSession!.audio()) {
            if (perfMark && !perfMark.ttsFirstAudioMs) {
              perfMark.ttsFirstAudioMs = nowMs();
            }
            await this.playback.put(audio);
          }
        } catch {
          logger.warn('tts stream aborted', { sid: this.sessionId });
        }
      })();
    } catch (err) {
      logger.warn('tts streaming not available, fallback to per-chunk', {
        sid: this.sessionId,
        error: err instanceof Error ? err.message : String(err)
      });
      ttsQueue = new AsyncQueue<string | null>();
      ttsWorker = (async () => {
        try {
          while (true) {
            const chunk = await ttsQueue!.next();
            if (chunk === null) break;
            logger.info('tts stream start', { sid: this.sessionId, len: chunk.length });
            for await (const audio of this.tts.stream(chunk, ttsSignal)) {
              if (perfMark && !perfMark.ttsFirstAudioMs) {
                perfMark.ttsFirstAudioMs = nowMs();
              }
              await this.playback.put(audio);
            }
            logger.info('tts stream done', { sid: this.sessionId });
          }
        } catch {
          logger.warn('tts stream aborted', { sid: this.sessionId });
        }
      })();
    }

    let assistantText = '';
    const enqueueChunk = async (chunk: string) => {
      if (!chunk) return;
      assistantText += chunk;
      if (perfMark && !perfMark.assistantFirstMs) {
        perfMark.assistantFirstMs = nowMs();
      }
      await this.sendJson({ type: 'assistant', text: chunk });
      if (ttsSession) {
        await ttsSession.send(chunk);
      } else if (ttsQueue) {
        ttsQueue.push(chunk);
      }
    };

    try {
      logger.info('llm stream start', { sid: this.sessionId });
      for await (const delta of this.llm.stream(this.ctx.history.slice(-10), llmSignal)) {
        if (runId !== this.assistantRunId || llmSignal.aborted) break;
        const chunks = this.chunker.push(delta);
        for (const c of chunks) {
          await enqueueChunk(c);
        }
      }
      logger.info('llm stream done', { sid: this.sessionId });
      for (const c of this.chunker.flush()) {
        await enqueueChunk(c);
      }
    } catch {
      logger.warn('llm stream aborted', { sid: this.sessionId });
    } finally {
      if (ttsSession) {
        await ttsSession.close();
      } else if (ttsQueue) {
        ttsQueue.push(null);
      }
    }

    if (ttsAudioTask) {
      await ttsAudioTask;
    }
    if (ttsWorker) {
      await ttsWorker;
    }
    await this.playback.waitForDrain();

    if (this.isEnded()) return;
    if (runId !== this.assistantRunId || llmSignal.aborted) return;

    const trimmedAssistant = assistantText.trim();
    if (trimmedAssistant.length > 0) {
      this.ctx.history.push({ role: 'assistant', content: trimmedAssistant });
    }

    if (perfMark) {
      this.emitLatencyMetric(perfMark);
      if (this.playbackMark?.runId === runId) {
        this.playbackMark = null;
      }
    }

    this.fsm.state = State.LISTENING;
  }

  private async handleBargeIn() {
    if (!this.bargeEnabled) return;
    await this.sendJson({ type: 'barge_in' });
    this.interruptAssistant('barge_in');
  }

  private interruptAssistant(reason: 'barge_in' | 'session_end') {
    this.assistantRunId += 1;
    this.chunker.flush();
    this.playback.stopAndClear();
    this.playbackMark = null;
    if (this.llmAbort) this.llmAbort.abort();
    if (this.ttsAbort) this.ttsAbort.abort();
    if (reason === 'barge_in') {
      this.fsm.state = State.LISTENING;
    }
  }

  private async playbackLoop() {
    while (this.fsm.state !== State.ENDED) {
      const audio = await this.playback.get();
      if (this.playback.isStopped()) continue;
      if (this.playbackMark && this.playbackMark.runId === this.assistantRunId) {
        if (!this.playbackMark.mark.playbackFirstMs) {
          this.playbackMark.mark.playbackFirstMs = nowMs();
        }
      }
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

  private emitLatencyMetric(mark: LatencyMark) {
    const diff = (start?: number, end?: number) => {
      if (typeof start !== 'number' || typeof end !== 'number') return undefined;
      if (end < start) return undefined;
      return end - start;
    };

    const payload: Record<string, unknown> = {
      metric_type: 'perf_latency',
      sid: this.sessionId,
      utterance_id: mark.utteranceId,
      vad_speech_end_ms: mark.vadSpeechEndMs,
      asr_final_ms: mark.asrFinalMs,
      assistant_first_ms: mark.assistantFirstMs,
      tts_first_audio_ms: mark.ttsFirstAudioMs,
      playback_first_ms: mark.playbackFirstMs,
      asr_final_text_len: mark.asrFinalTextLen,
      speech_end_to_asr_final_ms: diff(mark.vadSpeechEndMs, mark.asrFinalMs),
      asr_final_to_assistant_first_ms: diff(mark.asrFinalMs, mark.assistantFirstMs),
      assistant_first_to_tts_first_ms: diff(mark.assistantFirstMs, mark.ttsFirstAudioMs),
      speech_end_to_tts_first_ms: diff(mark.vadSpeechEndMs, mark.ttsFirstAudioMs),
      asr_final_to_tts_first_ms: diff(mark.asrFinalMs, mark.ttsFirstAudioMs),
      speech_end_to_playback_first_ms: diff(mark.vadSpeechEndMs, mark.playbackFirstMs),
      asr_final_to_playback_first_ms: diff(mark.asrFinalMs, mark.playbackFirstMs),
      ts_ms: nowMs()
    };

    logger.info(JSON.stringify(payload));
  }

  private summarizePcm(pcm16: Buffer) {
    const len = Math.floor(pcm16.length / 2);
    if (len === 0) return { rms: 0, zeroSamples: 0, samples: 0 };
    let sumSq = 0;
    let zeroSamples = 0;
    for (let i = 0; i < len; i += 1) {
      const v = pcm16.readInt16LE(i * 2);
      if (v === 0) zeroSamples += 1;
      const f = v / 32768;
      sumSq += f * f;
    }
    const rms = Math.sqrt(sumSq / len);
    return { rms, zeroSamples, samples: len };
  }

  async handleMicClose() {
    logger.info('session mic close', { sid: this.sessionId });
    this.clearVadEndTimer();
    this.asrClosing = true;
    if (typeof this.asr.planClose === 'function') this.asr.planClose();
    await this.asr.close();
    this.asr = new AsrClient();
    this.asrTask = null;
    this.speechActive = false;
    this.asrClosing = false;
  }

  private async startRecording() {
    if (!config.recordPcm) return;
    const filename = `session-${this.sessionId}-${Date.now()}.wav`;
    this.recordPath = path.join(config.recordPcmDir, filename);
    this.wavWriter = new WavWriter(this.recordPath, 16000, 1, 16);
    try {
      await this.wavWriter.init();
      logger.info('session record start', { sid: this.sessionId, path: this.recordPath });
    } catch (err) {
      logger.warn('session record init failed', {
        sid: this.sessionId,
        error: err instanceof Error ? err.message : String(err)
      });
      this.wavWriter = null;
      this.recordPath = null;
    }
  }

  private async stopRecording() {
    if (!this.wavWriter) return;
    const pathHint = this.recordPath;
    try {
      await this.wavWriter.close();
      logger.info('session record end', { sid: this.sessionId, path: pathHint });
    } catch (err) {
      logger.warn('session record close failed', {
        sid: this.sessionId,
        error: err instanceof Error ? err.message : String(err)
      });
    } finally {
      this.wavWriter = null;
      this.recordPath = null;
    }
  }

  private isEnded(): boolean {
    return this.fsm.state === State.ENDED;
  }

  private scheduleVadEnd() {
    this.clearVadEndTimer();
    this.vadEndTimer = setTimeout(() => {
      this.vadEndTimer = null;
      void this.endAsrUtterance();
    }, this.vadEndMs);
  }

  private clearVadEndTimer() {
    if (this.vadEndTimer) {
      clearTimeout(this.vadEndTimer);
      this.vadEndTimer = null;
    }
  }

  private async endAsrUtterance() {
    if (this.asrClosing || this.fsm.state === State.ENDED) return;
    this.asrClosing = true;
    logger.info('vad end -> asr close', { sid: this.sessionId, delay_ms: this.vadEndMs });
    if (typeof this.asr.planClose === 'function') this.asr.planClose();
    await this.asr.close();
  }
}
