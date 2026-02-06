import fs from 'node:fs/promises';
import path from 'node:path';

export class WavWriter {
  private handle: fs.FileHandle | null = null;
  private dataBytes = 0;

  constructor(
    private readonly filePath: string,
    private readonly sampleRate: number,
    private readonly channels: number,
    private readonly bitsPerSample: number
  ) {}

  getPath() {
    return this.filePath;
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    this.handle = await fs.open(this.filePath, 'w');
    const header = this.buildHeader(0);
    await this.handle.write(header);
  }

  async write(pcm16: Buffer) {
    if (!this.handle) return;
    if (pcm16.length === 0) return;
    await this.handle.write(pcm16);
    this.dataBytes += pcm16.length;
  }

  async close() {
    if (!this.handle) return;
    const header = this.buildHeader(this.dataBytes);
    await this.handle.write(header, 0, header.length, 0);
    await this.handle.close();
    this.handle = null;
  }

  private buildHeader(dataBytes: number) {
    const blockAlign = (this.channels * this.bitsPerSample) / 8;
    const byteRate = this.sampleRate * blockAlign;
    const buf = Buffer.alloc(44);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(36 + dataBytes, 4);
    buf.write('WAVE', 8);
    buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(this.channels, 22);
    buf.writeUInt32LE(this.sampleRate, 24);
    buf.writeUInt32LE(byteRate, 28);
    buf.writeUInt16LE(blockAlign, 32);
    buf.writeUInt16LE(this.bitsPerSample, 34);
    buf.write('data', 36);
    buf.writeUInt32LE(dataBytes, 40);
    return buf;
  }
}
