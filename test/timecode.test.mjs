// Ссылка VK с секундой начала: так окно «В окне» продолжает запись с места, где её смотрели.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withTime } from '../src/web/format.mjs';

test('withTime', () => {
  assert.equal(withTime('https://vkvideo.ru/video_ext.php?oid=-1&id=2', 1214), 'https://vkvideo.ru/video_ext.php?oid=-1&id=2&t=20m14s');
  assert.equal(withTime('https://vkvideo.ru/live-1_2', 370), 'https://vkvideo.ru/live-1_2?t=6m10s');
  assert.equal(withTime('https://vkvideo.ru/live-1_2', null), 'https://vkvideo.ru/live-1_2');
});
