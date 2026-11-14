import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOpened, matchIdOf } from '../src/web/opened.mjs';

test('matchIdOf: номер матча из ключа строки', () => {
  assert.equal(matchIdOf('m:5795455'), 5795455);
  assert.equal(matchIdOf('live:101'), 101);
});

test('плеер один: новый эфир заменяет прежний, эфир узнаётся по ссылке', () => {
  const o = createOpened();
  o.play('live:1', 'a');
  o.play('m:2', 'b');
  assert.deepEqual(o.player, { rowKey: 'm:2', url: 'b' });
  assert.equal(o.isPlaying('m:2', 'b'), true);
  assert.equal(o.isPlaying('m:2', 'a'), false);
  assert.equal(o.isPlaying('live:1', 'a'), false);
  o.stop();
  assert.equal(o.player, null);
});

test('закреплена строка с плеером, пока он открыт', () => {
  const o = createOpened();
  assert.deepEqual([...o.pinned()], []);
  o.play('live:2', 'b');
  assert.deepEqual([...o.pinned()], ['live:2']);
  o.stop();
  assert.deepEqual([...o.pinned()], []);
});
