export class AsyncQueue<T> {
  private items: T[] = [];
  private resolvers: Array<(value: T) => void> = [];

  push(item: T) {
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver(item);
      return;
    }
    this.items.push(item);
  }

  async next(): Promise<T> {
    if (this.items.length > 0) {
      return this.items.shift() as T;
    }
    return new Promise<T>((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  empty(): boolean {
    return this.items.length === 0;
  }

  clear(): void {
    this.items = [];
  }
}
