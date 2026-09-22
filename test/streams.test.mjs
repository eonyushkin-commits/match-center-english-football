import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStreamPoller } from '../src/core/streams.mjs';
import { toItems } from '../src/core/vk-items.mjs';

const quiet = { warn() {}, error() {} };
const channels = [{ screenName: 'a', label: 'A' }, { screenName: 'b', label: 'B' }];

function poller(readers, opts = {}) {
  const p = createStreamPoller({ channels: () => channels, intervalMs: () => 1e9, readers, log: quiet, ...opts });
  return p;
}

test('первый способ не сработал — канал читается вторым', async () => {
  const p = poller([
    { name: 'api', read: async (ch) => { if (ch.screenName === 'b') throw new Error('сбой'); return [{ url: 'a1' }]; } },
    { name: 'страница', read: async () => [{ url: 'b1' }] },
  ]);
  await p.refresh();
  p.stop();
  const s = p.snapshot();
  assert.deepEqual(s.channels.map((c) => [c.screenName, c.ok, c.via]), [['a', true, 'api'], ['b', true, 'страница']]);
  assert.deepEqual(s.streams.map((x) => x.url), ['a1', 'b1']);
});

test('при сбое канала остаются его последние эфиры и видна ошибка', async () => {
  let fail = false;
  const p = poller([{ name: 'api', read: async (ch) => { if (fail) throw new Error('нет сети'); return [{ url: ch.screenName }]; } }]);
  await p.refresh();
  fail = true;
  await p.refresh();
  p.stop();
  const s = p.snapshot();
  assert.deepEqual(s.streams.map((x) => x.url), ['a', 'b']);
  assert.equal(s.channels[0].ok, false);
  assert.match(s.channels[0].error, /нет сети/);
});

test('зависший способ чтения обрывается по таймауту', async () => {
  const p = poller([{ name: 'api', read: () => new Promise(() => {}) }], { timeoutMs: 50 });
  await p.refresh();
  p.stop();
  assert.match(p.snapshot().channels[0].error, /нет ответа/);
});

test('повторный refresh во время чтения не запускает второе параллельно', async () => {
  let running = 0;
  let maxRunning = 0;
  const p = poller([{ name: 'api', read: async () => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((r) => setTimeout(r, 20));
    running--;
    return [];
  } }]);
  p.refresh();
  p.refresh();
  await p.refresh();
  await new Promise((r) => setTimeout(r, 80));
  p.stop();
  assert.equal(maxRunning, channels.length);
});

test('toItems: повторы одного видео убираются, статусы переводятся', () => {
  const v = (status, id = 1) => ({ owner_id: -5, id, title: 'Брайтон — Арсенал | АПЛ', live_status: status, date: 1758380000, player: 'https://vkvideo.ru/video_ext.php?oid=-5&id=1&hash=x' });
  const items = toItems([v('upcoming'), v('started'), v('postlive', 2), { ...v('started', 3), title: 'Обзор тура' }], { label: 'Канал' });
  assert.deepEqual(items.map((s) => [s.url, s.status]), [['https://vkvideo.ru/live-5_1', 'started'], ['https://vkvideo.ru/live-5_2', 'finished']]);
  assert.equal(items[0].channel, 'Канал');
  assert.equal(items[0].time, 1758380000000);
});
