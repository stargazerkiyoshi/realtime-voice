import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaybackQueue } from '../src/tts/playback';

test('playback queue drains when items are consumed', async () => {
  const q = new PlaybackQueue();
  await q.put(Buffer.from([1, 2, 3]));

  const drained = q.waitForDrain();
  const item = await q.get();
  assert.equal(item.length, 3);
  await drained;
});

test('playback queue drain resolves immediately when empty', async () => {
  const q = new PlaybackQueue();
  await q.waitForDrain();
  assert.equal(q.isStopped(), false);
});

test('playback queue stop clears and drains', async () => {
  const q = new PlaybackQueue();
  await q.put(Buffer.from([4]));
  const drained = q.waitForDrain();
  q.stopAndClear();
  await drained;
});
