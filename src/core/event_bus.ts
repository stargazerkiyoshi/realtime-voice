import { AsyncQueue } from './async_queue';
import type { Event } from './events';

export class EventBus {
  private q = new AsyncQueue<Event>();

  async emit(e: Event) {
    this.q.push(e);
  }

  async next(): Promise<Event> {
    return this.q.next();
  }

  empty(): boolean {
    return this.q.empty();
  }
}
