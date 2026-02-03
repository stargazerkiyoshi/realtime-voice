import test from 'node:test';
import assert from 'node:assert/strict';
import { AsyncQueue } from '../src/core/async_queue';

test('async queue delivers items in order', async () => {
  const q = new AsyncQueue<number>();
  q.push(1);
  q.push(2);
  const a = await q.next();
  const b = await q.next();
  assert.equal(a, 1);
  assert.equal(b, 2);
});

test('async queue waits when empty', async () => {
  const q = new AsyncQueue<number>();
  const p = q.next();
  q.push(7);
  const v = await p;
  assert.equal(v, 7);
});
