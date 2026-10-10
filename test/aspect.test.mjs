import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const { fitRatio } = createRequire(import.meta.url)('../src/electron/aspect.cjs');

const FRAME = { width: 16, height: 39 }; // рамка и заголовок окна Windows
const cur = { x: 100, y: 100, width: 816, height: 489 }; // содержимое 800×450
const fit = (next, edge, min) => fitRatio(cur, { ...cur, ...next }, edge, FRAME, 16 / 9, min);
const content = (b) => [b.width - FRAME.width, b.height - FRAME.height];

test('fitRatio: 16:9 держится по содержимому, а не по окну с заголовком', () => {
  assert.deepEqual(content(fit({ width: 976 }, 'right')), [960, 540]);
  assert.deepEqual(content(fit({ height: 579 }, 'bottom')), [960, 540], 'тянут за нижний край — ширина идёт за высотой');
  assert.deepEqual(content(fit({ width: 976, height: 500 }, 'bottom-right')), [960, 540], 'за угол — высота идёт за шириной');
});

test('fitRatio: тянут за левый или верхний край — на месте остаётся противоположный', () => {
  const left = fit({ x: -60, width: 976 }, 'left');
  assert.deepEqual([left.x + left.width, left.y], [cur.x + cur.width, cur.y]);
  const top = fit({ y: 10, height: 579 }, 'top');
  assert.deepEqual([top.y + top.height, top.x], [cur.y + cur.height, cur.x]);
  const corner = fit({ x: -60, y: 10, width: 976, height: 579 }, 'top-left');
  assert.deepEqual([corner.x + corner.width, corner.y + corner.height], [cur.x + cur.width, cur.y + cur.height]);
});

test('fitRatio: меньше наименьшего размера окно не становится и не уезжает', () => {
  const b = fit({ x: 700, width: 100 }, 'left', { width: 336, height: 219 });
  assert.deepEqual(content(b), [320, 180]);
  assert.equal(b.x + b.width, cur.x + cur.width);
});
