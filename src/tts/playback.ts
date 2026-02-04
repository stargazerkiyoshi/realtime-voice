import { AsyncQueue } from '../core/async-queue';

export class PlaybackQueue {
  private q = new AsyncQueue<Buffer>();
  private stopped = false;

  async put(audio: Buffer) {
    if (!this.stopped) {
      this.q.push(audio);
    }
  }

  async get(): Promise<Buffer> {
    return this.q.next();
  }

  stopAndClear() {
    this.stopped = true;
    this.q.clear();
  }

  resume() {
    this.stopped = false;
  }

  isStopped() {
    return this.stopped;
  }
}
