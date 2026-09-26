import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchStreams, parseTeams } from '../src/core/match.mjs';
import { createStreamPoller } from '../src/core/streams.mjs';
import { createVkApi } from '../src/core/vk-api.mjs';
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

test('toItems: зрители эфира и дата создания видео передаются дальше', () => {
  const v = (id, status, extra) => ({ owner_id: -5, id, title: 'Фулхэм — Манчестер Юнайтед | АПЛ', live_status: status, ...extra });
  const [live, record] = toItems([
    v(1, 'started', { spectators: 1234, date: 1758370000, live_start_time: 1758380000 }),
    v(2, 'postlive', { views: 18557, date: 1758360000 }), // у записей VK не присылает spectators
  ], { label: 'Канал' });
  assert.equal(live.spectators, 1234);
  assert.equal(live.created, 1758370000000, 'дата создания, а не начала эфира');
  assert.equal(live.time, 1758380000000);
  assert.equal(record.spectators, null);
  assert.equal('views' in record, false, 'просмотры записей не нужны');
});

test('matchStreams: эфиры впереди и по времени начала, записи — по дате создания', () => {
  const m = { home: { id: 1 }, away: { id: 2 }, status: { utcTime: '2026-09-20T15:30:00Z', finished: false } };
  const at = (hhmm) => Date.parse(`2026-09-20T${hhmm}:00Z`);
  const s = (channel, status, extra) => ({
    title: 'Фулхэм — Манчестер Юнайтед', teams: parseTeams('Фулхэм — Манчестер Юнайтед'), status, channel, url: channel,
    time: at('15:00'), created: at('10:00'), spectators: null, ...extra,
  });
  const order = matchStreams(m, ['фулхэм'], ['манчестер юнайтед'], [
    s('запись-поздняя', 'finished', { created: at('14:00') }),
    s('эфир-поздний', 'started', { time: at('15:20'), spectators: 5200 }),
    s('запись-ранняя', 'finished', { created: at('09:00') }),
    s('эфир-ранний', 'started', { time: at('15:05'), spectators: 150 }),
    s('запись-средняя', 'finished', { created: at('12:00') }),
  ]).map((x) => x.channel);
  assert.deepEqual(order, ['эфир-ранний', 'эфир-поздний', 'запись-ранняя', 'запись-средняя', 'запись-поздняя'], 'зрители на порядок не влияют');
});

test('VK API: каналы, читаемые параллельно, ждут один токен', async () => {
  let tokens = 0;
  const fetchImpl = async (url) => {
    const json = url.includes('get_anonym_token')
      ? (tokens++, { data: { access_token: 't', expired_at: Date.now() / 1000 + 3600 } })
      : { response: { videos: [{ owner_id: -1, id: 1, title: 'Фулхэм — Челси', live_status: 'started', date: 1758380000 }] } };
    return { ok: true, json: async () => json };
  };
  const api = createVkApi(fetchImpl);
  const lists = await Promise.all(['a', 'b', 'c', 'd'].map((screenName) => api.read({ screenName })));
  assert.equal(tokens, 1);
  assert.ok(lists.every((l) => l.length === 1));
  await api.read({ screenName: 'a' });
  assert.equal(tokens, 1, 'пока токен действует, новый не нужен');
});
