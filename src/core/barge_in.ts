import { PlaybackQueue } from '../tts/playback';

export class BargeInController {
  private playback: PlaybackQueue;
  private llmAbort: AbortController | null = null;
  private ttsAbort: AbortController | null = null;

  constructor(playback: PlaybackQueue) {
    this.playback = playback;
  }

  bindControllers(llmAbort: AbortController | null, ttsAbort: AbortController | null) {
    this.llmAbort = llmAbort;
    this.ttsAbort = ttsAbort;
  }

  interrupt() {
    this.playback.stopAndClear();
    if (this.llmAbort) this.llmAbort.abort();
    if (this.ttsAbort) this.ttsAbort.abort();
  }
}
