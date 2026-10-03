// Лента: что и когда ядро присылает подписанной странице.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createFeed } from '../src/core/feed.mjs';
import { resolve } from '../src/core/settings.mjs';

const pause = (ms = 5) => new Promise((r) => setTimeout(r, ms));

function setup({ intervalMs = 1e9, retryMs = 1e9 } = {}) {
  const state = { score: 0, streams: [], fail: null, detailsFail: null, user: {}, calls: 0 };
  const poller = Object.assign(new EventEmitter(), { snapshot: () => ({ ready: true, channels: [], streams: state.streams }) });
  const settings = Object.assign(new EventEmitter(), { warnings: [], get: () => resolve(state.user) });
  const fotmob = {
    names: async () => ({}),
    day: async () => {
      state.calls++;
      if (state.fail) throw new Error(state.fail);
      return { leagues: [{ id: 47, name: 'PL', matches: [{ id: 7, home: { id: 1, name: 'Fulham', score: state.score }, away: { id: 2, name: 'Arsenal', score: 0 }, status: { utcTime: '2026-09-20T15:00:00Z', started: true } }] }] };
    },
  };
  const details = async (id) => {
    if (state.detailsFail) throw new Error(state.detailsFail);
    return { id, goals: state.score };
  };
  const feed = createFeed({ settings, poller, fotmob, details, version: 'v', intervalMs, retryMs });
  const log = [];
  const sub = (watch = {}) => feed.subscribe({ date: '20260920', tz: 'UTC', ...watch }, (event, json) => log.push([event, JSON.parse(json)]));
  return { state, poller, settings, feed, log, sub, names: () => log.map(([e]) => e) };
}

test('подписка сразу получает состояние каналов, расписание и события раскрытого матча', async () => {
  const t = setup();
  const stop = t.sub({ matchId: '7' });
  await pause();
  stop();
  assert.deepEqual(t.names().sort(), ['day', 'details', 'status']);
  assert.equal(t.log.find(([e]) => e === 'status')[1].version, 'v');
  assert.equal(t.log.find(([e]) => e === 'day')[1].leagues[0].matches[0].home.name, 'Fulham');
  assert.deepEqual(t.log.find(([e]) => e === 'details')[1], { id: '7', goals: 0 });
});

test('без раскрытого матча события не запрашиваются', async () => {
  const t = setup();
  const stop = t.sub();
  await pause();
  stop();
  assert.deepEqual(t.names().sort(), ['day', 'status']);
});

test('по часам присылается только изменившееся: счёт поменялся — расписание, нет — ничего', async () => {
  const t = setup({ intervalMs: 20 });
  const stop = t.sub();
  await pause();
  const before = t.log.length;
  await pause(60);
  assert.equal(t.log.length, before, 'ничего не изменилось — ничего не пришло');
  assert.ok(t.state.calls > 1, 'но FotMob спрашивали');
  t.state.score = 1;
  await pause(60);
  stop();
  assert.equal(t.log.at(-1)[0], 'day');
  assert.equal(t.log.at(-1)[1].leagues[0].matches[0].home.score, 1);
});

test('прочитаны каналы или сохранены настройки — расписание приходит сразу, не дожидаясь круга', async () => {
  const t = setup();
  const stop = t.sub();
  await pause();
  t.state.streams = [{ title: 'Fulham — Arsenal', teams: ['fulham', 'arsenal'], status: 'started', time: null, url: 'u', channel: 'X' }];
  t.poller.emit('update');
  await pause();
  assert.deepEqual(t.log.at(-1)[1].leagues[0].matches[0].streams.map((s) => s.url), ['u']);
  assert.equal(t.log.at(-2)[0], 'status');
  t.state.user = { favorites: [{ id: 1, name: 'Fulham' }] };
  t.settings.emit('change');
  await pause();
  stop();
  assert.equal(t.log.at(-1)[1].leagues[0].matches[0].favorite, true);
});

test('сбой FotMob — ошибка; после сбоя расписание приходит заново, даже прежнее', async () => {
  const t = setup();
  const stop = t.sub();
  await pause();
  t.state.fail = 'FotMob ответил 503';
  t.poller.emit('update');
  await pause();
  assert.deepEqual(t.log.at(-1), ['day-error', { message: 'FotMob ответил 503' }]);
  t.state.fail = null;
  t.poller.emit('update');
  await pause();
  stop();
  assert.equal(t.log.at(-1)[0], 'day');
});

test('после сбоя следующий круг — через retryMs, а не через intervalMs', async () => {
  const t = setup({ retryMs: 20 });
  t.state.fail = 'нет сети';
  const stop = t.sub();
  await pause();
  t.state.fail = null;
  await pause(60);
  stop();
  assert.deepEqual(t.names().filter((e) => e !== 'status'), ['day-error', 'day']);
});

test('после отписки ничего не приходит и ядро никого не слушает', async () => {
  const t = setup({ intervalMs: 10 });
  const stop = t.sub();
  await pause();
  stop();
  const before = t.log.length;
  t.state.score = 5;
  t.poller.emit('update');
  await pause(40);
  assert.equal(t.log.length, before);
  assert.equal(t.poller.listenerCount('update'), 0);
  assert.equal(t.settings.listenerCount('change'), 0);
  t.sub();
  t.feed.close();
  assert.equal(t.poller.listenerCount('update'), 0);
});
