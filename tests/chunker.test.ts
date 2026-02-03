import test from 'node:test';
import assert from 'node:assert/strict';
import { Chunker } from '../src/llm/chunker';

test('chunker splits on punctuation after min chars', () => {
  const c = new Chunker(4);
  const out = c.push('你好，今天怎么样？');
  assert.ok(out.length >= 1);
  assert.equal(out.join(''), '你好，今天怎么样？');
});

test('chunker flush returns remaining buffer', () => {
  const c = new Chunker(8);
  c.push('hello');
  const flushed = c.flush();
  assert.deepEqual(flushed, ['hello']);
});
