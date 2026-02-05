import { logger } from '../observability/logger';

type TurnManagerOpts = {
  idleMs?: number;
  maxUtterMs?: number;
  onIdleTimeout: () => Promise<void>;
  onMaxUtterTimeout: () => Promise<void>;
};

export class TurnManager {
  private idleMs: number;
  private maxUtterMs: number | undefined;
  private onIdleTimeout: () => Promise<void>;
  private onMaxUtterTimeout: () => Promise<void>;

  private idleTimer: NodeJS.Timeout | null = null;
  private speechTimer: NodeJS.Timeout | null = null;
  private lastPartialText = '';
  private turnPcm = Buffer.alloc(0);

  constructor(opts: TurnManagerOpts) {
    this.idleMs = typeof opts.idleMs === 'number' ? opts.idleMs : 5000;
    this.maxUtterMs = opts.maxUtterMs;
    this.onIdleTimeout = opts.onIdleTimeout;
    this.onMaxUtterTimeout = opts.onMaxUtterTimeout;
  }

  recordAudio(pcm16: Buffer) {
    this.turnPcm = Buffer.concat([this.turnPcm, pcm16]);
  }

  onSpeechStart() {
    this.lastPartialText = '';
    this.clearIdleTimer();
    if (!this.speechTimer && typeof this.maxUtterMs === 'number') {
      this.speechTimer = setTimeout(() => {
        void this.onMaxUtterTimeout();
      }, this.maxUtterMs);
    }
  }

  onSpeechEnd() {
    this.clearSpeechTimer();
    if (this.idleMs > 0 && !this.idleTimer) {
      this.idleTimer = setTimeout(() => {
        void this.onIdleTimeout();
      }, this.idleMs);
    }
  }

  onPartial(text: string) {
    this.lastPartialText = text;
  }

  onFinal() {
    this.clearAllTimers();
    this.lastPartialText = '';
    this.turnPcm = Buffer.alloc(0);
  }

  reset() {
    this.clearAllTimers();
    this.lastPartialText = '';
    this.turnPcm = Buffer.alloc(0);
  }

  getLastPartial() {
    return this.lastPartialText;
  }

  getTurnPcm() {
    return this.turnPcm;
  }

  private clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private clearSpeechTimer() {
    if (this.speechTimer) {
      clearTimeout(this.speechTimer);
      this.speechTimer = null;
    }
  }

  private clearAllTimers() {
    this.clearIdleTimer();
    this.clearSpeechTimer();
  }
}
