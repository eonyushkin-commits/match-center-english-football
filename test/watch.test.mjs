import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { localYmd } from '../src/core/day.mjs';
import { resolve } from '../src/core/settings.mjs';
import { watchFavorites } from '../src/core/watch.mjs';

const fm = { leagues: [{ id: 47, matches: [{
  id: 7, home: { id: 1, name: 'Fulham' }, away: { id: 2, name: 'Man United' },
  status: { utcTime: new Date().toISOString(), started: true },
}] }] };
const ru = { Participants: { 1: 'Фулхэм', 2: 'Манчестер Юнайтед' } };
const stream = (url, status = 'started') => ({ title: 'Фулхэм — Манчестер Юнайтед', teams: ['фулхэм', 'манчестер юнайтед'], status, time: null, url, channel: 'X' });
const tick = () => new Promise((r) => setTimeout(r, 10));

test('уведомляет о новой трансляции избранной команды один раз, без пачки при запуске', async () => {
  const poller = new EventEmitter();
  const settings = { get: () => resolve({ favorites: [{ id: 2, name: 'Манчестер Юнайтед' }] }) };
  const events = [];
  watchFavorites({ poller, settings, fotmob: { day: async () => fm, names: async () => ru }, onStart: (e) => events.push(e), log: {} });

  poller.emit('update', { streams: [stream('уже-шёл')] }); // шёл до запуска — молчим
  await tick();
  poller.emit('update', { streams: [stream('уже-шёл'), stream('новый', 'upcoming')] });
  await tick();
  poller.emit('update', { streams: [stream('уже-шёл'), stream('новый')] }); // начался
  await tick();
  poller.emit('update', { streams: [stream('уже-шёл'), stream('новый')] }); // повтор — молчим
  await tick();

  assert.deepEqual(events.map((e) => [e.stream.url, e.match.id, e.date]), [['новый', 7, localYmd()]]);
});

test('без избранного и с выключенными уведомлениями — тишина', async () => {
  for (const user of [{}, { favorites: [{ id: 1, name: 'Фулхэм' }], notifications: false }]) {
    const poller = new EventEmitter();
    const events = [];
    watchFavorites({ poller, settings: { get: () => resolve(user) }, fotmob: { day: async () => fm, names: async () => ru }, onStart: (e) => events.push(e), log: {} });
    poller.emit('update', { streams: [] });
    await tick();
    poller.emit('update', { streams: [stream('новый')] });
    await tick();
    assert.equal(events.length, 0);
  }
});
