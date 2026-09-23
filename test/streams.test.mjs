import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchStreams, parseTeams } from '../src/core/match.mjs';
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

test('toItems: просмотры записи и зрители эфира передаются дальше', () => {
  const v = (id, status, extra) => ({ owner_id: -5, id, title: 'Фулхэм — Манчестер Юнайтед | АПЛ', live_status: status, date: 1758380000, ...extra });
  const [live, record, card] = toItems([
    v(1, 'started', { views: 900, spectators: 1234 }),
    v(2, 'postlive', { views: 18557 }), // у записей VK не присылает spectators
    v(3, 'postlive', {}),
  ], { label: 'Канал' });
  assert.deepEqual([live.views, live.spectators], [900, 1234]);
  assert.deepEqual([record.views, record.spectators], [18557, null]);
  assert.deepEqual([card.views, card.spectators], [null, null]);
});

test('matchStreams: внутри статуса самый популярный эфир первым', () => {
  const m = { home: { id: 1 }, away: { id: 2 }, status: { utcTime: '2026-09-20T15:30:00Z', finished: false } };
  const s = (channel, status, extra) => ({
    title: 'Фулхэм — Манчестер Юнайтед', teams: parseTeams('Фулхэм — Манчестер Юнайтед'), status, channel, url: channel,
    time: Date.parse('2026-09-20T15:00:00Z'), views: null, spectators: null, ...extra,
  });
  const order = matchStreams(m, ['фулхэм'], ['манчестер юнайтед'], [
    s('запись-мало', 'finished', { views: 3000 }),
    s('эфир-мало', 'started', { spectators: 150, views: 99999 }), // у эфира считаются зрители, а не просмотры
    s('запись-без-чисел', 'finished'),
    s('эфир-много', 'started', { spectators: 5200 }),
    s('запись-много', 'finished', { views: 65201 }),
  ]).map((x) => x.channel);
  assert.deepEqual(order, ['эфир-много', 'эфир-мало', 'запись-много', 'запись-мало', 'запись-без-чисел']);
});
