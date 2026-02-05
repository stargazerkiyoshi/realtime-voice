export class SimpleEnergyVAD {
  private sampleRate: number;
  private frameMs: number;
  private frameBytes: number;
  private startThreshold: number;
  private endSilenceFrames: number;
  private maxSpeechFrames: number;
  private inSpeech = false;
  private silenceCount = 0;
  private speechFrames = 0;

  constructor(
    sampleRate = 16000,
    frameMs = 20,
    startThreshold = 0.02,
    endSilenceMs = 300,
    maxSpeechMs = 8000
  ) {
    this.sampleRate = sampleRate;
    this.frameMs = frameMs;
    this.frameBytes = Math.floor(sampleRate * (frameMs / 1000)) * 2;
    this.startThreshold = startThreshold;
    this.endSilenceFrames = Math.max(1, Math.floor(endSilenceMs / frameMs));
    this.maxSpeechFrames = Math.max(1, Math.floor(maxSpeechMs / frameMs));
  }

  process(pcm16: Buffer): string[] {
    const events: string[] = [];
    for (let i = 0; i + this.frameBytes <= pcm16.length; i += this.frameBytes) {
      const frame = pcm16.subarray(i, i + this.frameBytes);
      const rms = this.rms(frame);

      if (!this.inSpeech) {
        if (rms >= this.startThreshold) {
          this.inSpeech = true;
          this.silenceCount = 0;
          this.speechFrames = 0;
          events.push('speech_start');
        }
      } else {
        this.speechFrames += 1;
        if (this.speechFrames >= this.maxSpeechFrames) {
          // Force an end to avoid hanging forever when silence is not detected.
          this.inSpeech = false;
          this.silenceCount = 0;
          this.speechFrames = 0;
          events.push('speech_end');
          continue;
        }
        if (rms < this.startThreshold * 0.6) {
          this.silenceCount += 1;
          if (this.silenceCount >= this.endSilenceFrames) {
            this.inSpeech = false;
            this.silenceCount = 0;
            this.speechFrames = 0;
            events.push('speech_end');
          }
        } else {
          this.silenceCount = 0;
        }
      }
    }
    return events;
  }

  private rms(pcm16: Buffer): number {
    let sum = 0;
    const len = pcm16.length / 2;
    for (let i = 0; i < len; i++) {
      const s = pcm16.readInt16LE(i * 2) / 32768;
      sum += s * s;
    }
    return Math.sqrt(sum / Math.max(1, len)) + 1e-8;
  }
}
