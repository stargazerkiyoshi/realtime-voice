import test from 'node:test';
import assert from 'node:assert/strict';
import { VolcAsrClient } from '../src/asr/volc-asr';

function buildServerResponseFrame(payloadObj: unknown, opts?: { flags?: number }) {
  const VERSION = 0b0001;
  const HEADER_SIZE_UNITS = 0b0001;
  const MSG_FULL_SERVER_RESPONSE = 0b1001;
  const SERIALIZE_JSON = 0b0001;
  const COMPRESS_NONE = 0b0000;

  const flags = opts?.flags ?? 0b0000;
  const b0 = (VERSION << 4) | (HEADER_SIZE_UNITS & 0x0f);
  const b1 = ((MSG_FULL_SERVER_RESPONSE & 0x0f) << 4) | (flags & 0x0f);
  const b2 = ((SERIALIZE_JSON & 0x0f) << 4) | (COMPRESS_NONE & 0x0f);
  const header = Buffer.from([b0, b1, b2, 0x00]);

  const payload = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, size, payload]);
}

test('volc asr parses text result and enqueues final', () => {
  const client = new VolcAsrClient();
  const frame = buildServerResponseFrame({
    result: {
      text: 'hello',
      utterances: [{ text: 'hello', definite: true, start_time: 0, end_time: 100 }]
    }
  });

  (client as any).handleMessage(frame);
  const queue = (client as any).resultQueue as Array<any>;
  assert.equal(queue.length, 1);
  assert.equal(queue[0].text, 'hello');
  assert.equal(queue[0].isFinal, true);
  assert.equal(queue[0].startMs, 0);
  assert.equal(queue[0].endMs, 100);
});

test('volc asr ignores responses without text', () => {
  const client = new VolcAsrClient();
  const frame = buildServerResponseFrame({
    result: { additions: { log_id: 'x' } }
  });

  (client as any).handleMessage(frame);
  const queue = (client as any).resultQueue as Array<any>;
  assert.equal(queue.length, 0);
});
