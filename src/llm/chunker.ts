const PUNCTS = new Set(['。', '！', '？', '?', '!', ';', '\n']);

type ChunkerOptions = {
  minChars?: number;
  maxChars?: number;
  firstMinChars?: number;
};

export class Chunker {
  private buf = '';
  private minChars: number;
  private maxChars: number;
  private firstMinChars: number;
  private firstChunkSent = false;

  constructor(opts: ChunkerOptions | number = 8) {
    if (typeof opts === 'number') {
      this.minChars = opts;
      this.maxChars = 40;
      this.firstMinChars = opts;
      return;
    }
    this.minChars = opts.minChars ?? 8;
    this.maxChars = opts.maxChars ?? 40;
    this.firstMinChars = opts.firstMinChars ?? this.minChars;
  }

  push(delta: string): string[] {
    const out: string[] = [];
    this.buf += delta;

    if (!this.firstChunkSent) {
      const idx = this.findPunctIndex(this.firstMinChars);
      if (idx >= 0) {
        out.push(this.buf.slice(0, idx + 1));
        this.buf = this.buf.slice(idx + 1);
        this.firstChunkSent = true;
      } else if (this.buf.length >= this.firstMinChars) {
        const cut = Math.min(this.firstMinChars, this.buf.length);
        out.push(this.buf.slice(0, cut));
        this.buf = this.buf.slice(cut);
        this.firstChunkSent = true;
      } else {
        return out;
      }
    }

    while (true) {
      const idx = this.findPunctIndex(this.minChars);
      if (idx === -1) {
        if (this.buf.length >= this.maxChars) {
          out.push(this.buf.slice(0, this.maxChars));
          this.buf = this.buf.slice(this.maxChars);
          continue;
        }
        break;
      }
      out.push(this.buf.slice(0, idx + 1));
      this.buf = this.buf.slice(idx + 1);
    }
    return out;
  }

  flush(): string[] {
    if (this.buf.trim().length > 0) {
      const s = this.buf;
      this.buf = '';
      this.firstChunkSent = false;
      return [s];
    }
    this.firstChunkSent = false;
    return [];
  }

  private findPunctIndex(minChars: number) {
    if (minChars <= 0) return -1;
    for (let i = 0; i < this.buf.length; i++) {
      const ch = this.buf[i];
      if (PUNCTS.has(ch) && i + 1 >= minChars) {
        return i;
      }
    }
    return -1;
  }
}
