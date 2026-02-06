import { AsyncQueue } from '../core/async-queue';

export class PlaybackQueue {
  private q = new AsyncQueue<Buffer>();
  private stopped = false;
  private queued = 0;
  private drainWaiters: Array<() => void> = [];

  async put(audio: Buffer) {
    if (!this.stopped) {
      this.queued += 1;
      this.q.push(audio);
    }
  }

  async get(): Promise<Buffer> {
    const audio = await this.q.next();
    this.queued = Math.max(0, this.queued - 1);
    if (this.queued === 0) {
      const waiters = this.drainWaiters.splice(0);
      for (const resolve of waiters) resolve();
    }
    return audio;
  }

  stopAndClear() {
    this.stopped = true;
    this.q.clear();
    this.queued = 0;
    const waiters = this.drainWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  resume() {
    this.stopped = false;
  }

  isStopped() {
    return this.stopped;
  }

  async waitForDrain(): Promise<void> {
    if (this.queued === 0) return;
    await new Promise<void>((resolve) => {
      this.drainWaiters.push(resolve);
    });
  }
}
