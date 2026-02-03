const PUNCTS = new Set(['。', '！', '？', '?', '!', ';', '\n']);

export class Chunker {
  private buf = '';
  private minChars: number;

  constructor(minChars = 8) {
    this.minChars = minChars;
  }

  push(delta: string): string[] {
    const out: string[] = [];
    this.buf += delta;
    while (true) {
      let idx = -1;
      for (let i = 0; i < this.buf.length; i++) {
        const ch = this.buf[i];
        if (PUNCTS.has(ch) && i + 1 >= this.minChars) {
          idx = i;
          break;
        }
      }
      if (idx === -1) {
        if (this.buf.length >= 40) {
          out.push(this.buf.slice(0, 40));
          this.buf = this.buf.slice(40);
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
      return [s];
    }
    return [];
  }
}
