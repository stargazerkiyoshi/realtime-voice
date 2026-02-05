import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { VolcAsrClient } from '../src/asr/volc-asr';

type WavInfo = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  pcm: Buffer;
};

function parseWav(buf: Buffer): WavInfo {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Invalid WAV: missing RIFF/WAVE header');
  }
  let offset = 12;
  let fmt: {
    audioFormat: number;
    channels: number;
    sampleRate: number;
    bitsPerSample: number;
  } | null = null;
  let data: Buffer | null = null;
  let dataStart = 0;
  let dataSize = 0;

  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    offset += 8;
    const chunk = buf.slice(offset, offset + size);
    if (id === 'fmt ') {
      if (size < 16) throw new Error('Invalid WAV: fmt chunk too small');
      fmt = {
        audioFormat: chunk.readUInt16LE(0),
        channels: chunk.readUInt16LE(2),
        sampleRate: chunk.readUInt32LE(4),
        bitsPerSample: chunk.readUInt16LE(14)
      };
    } else if (id === 'data') {
      dataStart = offset;
      dataSize = size;
      data = chunk;
    }
    offset += size + (size % 2);
  }

  if (!fmt) throw new Error('Invalid WAV: missing fmt chunk');
  if (!data) throw new Error('Invalid WAV: missing data chunk');
  if (dataSize === 0 && buf.length > dataStart) {
    // Allow reading data from unfinalized WAVs where header wasn't patched yet.
    data = buf.slice(dataStart);
    dataSize = data.length;
  }
  if (fmt.audioFormat !== 1) throw new Error(`Unsupported WAV format: ${fmt.audioFormat} (expect PCM)`);

  return {
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    pcm: data
  };
}

function getFlag(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  if (!hit) return fallback;
  const v = Number(hit.slice(prefix.length));
  return Number.isFinite(v) ? v : fallback;
}

async function sleep(ms: number) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function convertToWavBuffer(inputPath: string): Promise<Buffer> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg-static not available; cannot convert non-wav input.');
  }
  return new Promise<Buffer>((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-ar',
      '16000',
      '-ac',
      '1',
      '-sample_fmt',
      's16',
      '-f',
      'wav',
      'pipe:1'
    ];
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on('data', (d) => chunks.push(Buffer.from(d)));
    proc.stderr.on('data', (d) => errChunks.push(Buffer.from(d)));
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        const msg = Buffer.concat(errChunks).toString('utf8').trim();
        reject(new Error(`ffmpeg convert failed (code ${code}): ${msg || 'unknown error'}`));
      }
    });
  });
}

async function main() {
  const wavPath = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  if (!wavPath) {
    throw new Error(
      'Usage: pnpm asr:diag <path.(wav|mp3|m4a)> [--sleep-ms=0] [--idle-ms=5000] [--wait-ms=1000]'
    );
  }

  const fullPath = path.resolve(wavPath);
  const ext = path.extname(fullPath).toLowerCase();
  const buf = ext === '.wav' ? await fs.readFile(fullPath) : await convertToWavBuffer(fullPath);
  const wav = parseWav(buf);

  if (wav.sampleRate !== 16000 || wav.channels !== 1 || wav.bitsPerSample !== 16) {
    throw new Error(
      `Unsupported WAV format: rate=${wav.sampleRate} channels=${wav.channels} bits=${wav.bitsPerSample} (expect 16k/mono/16-bit)`
    );
  }

  const idleMs = getFlag('idle-ms', 5000);
  const sleepMs = getFlag('sleep-ms', 0);
  const waitMs = getFlag('wait-ms', Math.max(1000, Math.floor(idleMs / 2)));

  const client = new VolcAsrClient({ idleMs });
  const results: Array<{ text: string; isFinal?: boolean }> = [];

  const streamTask = (async () => {
    for await (const res of client.stream()) {
      const label = res.isFinal ? 'final' : 'partial';
      console.log(`[asr ${label}] ${res.text}`);
      results.push({ text: res.text, isFinal: res.isFinal });
    }
  })();

  const frameBytes = 320; // 10ms @16kHz, 16-bit mono
  for (let i = 0; i < wav.pcm.length; i += frameBytes) {
    const frame = wav.pcm.slice(i, i + frameBytes);
    await client.feed(frame);
    if (sleepMs > 0) await sleep(sleepMs);
  }

  await sleep(waitMs);
  await client.close();
  await streamTask.catch((err) => {
    console.error('ASR stream error:', err instanceof Error ? err.message : String(err));
  });

  if (results.length === 0) {
    console.log('ASR finished with no text results.');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
