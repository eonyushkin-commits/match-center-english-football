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

test('«в окне»: в строке остаётся кнопка событий, пока матч снова не откроют в плеере', () => {
  const o = createOpened();
  o.play('m:1', 'a');
  o.popOut();
  assert.equal(o.player, null);
  assert.deepEqual(o.under('m:1'), ['popbar']);
  o.toggleDetails('m:1');
  assert.deepEqual(o.under('m:1'), ['popbar', 'details']);
  o.play('m:1', 'a');
  assert.deepEqual(o.under('m:1'), ['player', 'details']);
  o.stop();
  assert.deepEqual(o.under('m:1'), ['details']);
});

test('события раскрыты у одного матча; повторное нажатие сворачивает', () => {
  const o = createOpened();
  o.toggleDetails('m:1');
  assert.deepEqual(o.details, { rowKey: 'm:1', data: null, error: null });
  o.toggleDetails('m:2');
  assert.deepEqual(o.under('m:1'), []);
  assert.deepEqual(o.under('m:2'), ['details']);
  o.toggleDetails('m:2');
  assert.equal(o.details, null);
});

test('закреплены строки с плеером и событиями; другой день закрывает оба, но не матчи в окне', () => {
  const o = createOpened();
  assert.deepEqual([...o.pinned()], []);
  o.play('live:1', 'a');
  o.popOut();
  o.play('live:2', 'b');
  o.toggleDetails('m:3');
  assert.deepEqual([...o.pinned()], ['live:2', 'm:3']);
  o.leaveDay();
  assert.deepEqual([...o.pinned()], []);
  assert.deepEqual(o.under('live:1'), ['popbar']);
});
