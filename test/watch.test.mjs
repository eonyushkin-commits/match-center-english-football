import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { resolve } from '../src/core/settings.mjs';
import { watchFavorites } from '../src/core/watch.mjs';

const KICKOFF = Date.parse('2026-09-20T15:30:00Z');
const MIN = 60e3;
const ru = { Participants: { 1: 'Фулхэм', 2: 'Манчестер Юнайтед' } };
const stream = (url, status = 'started') => ({ title: 'Фулхэм — Манчестер Юнайтед', teams: ['фулхэм', 'манчестер юнайтед'], status, time: null, url, channel: 'X' });

// Матч в расписании FotMob; status меняется по ходу теста
function setup(user = { favorites: [{ id: 2, name: 'Манчестер Юнайтед' }] }) {
  const status = { utcTime: new Date(KICKOFF).toISOString(), started: false, finished: false };
  const fm = { leagues: [{ id: 47, matches: [{ id: 7, home: { id: 1, name: 'Fulham' }, away: { id: 2, name: 'Man United' }, status }] }] };
  const poller = new EventEmitter();
  let streams = [];
  poller.snapshot = () => ({ streams });
  let now = KICKOFF - 60 * MIN;
  const events = [];
  const w = watchFavorites({
    poller, settings: { get: () => resolve(user) }, fotmob: { day: async () => fm, names: async () => ru },
    onEvent: (e) => events.push(`${e.kind}${e.stream ? `:${e.stream.url}` : ''}`), now: () => now, intervalMs: 1e9, log: {},
  });
  return {
    events, status,
    at: async (t, s = streams) => { now = t; streams = s; await w.check(); },
    stop: w.stop,
  };
}

test('за 15 минут, в начале матча и при запуске трансляции — по одному разу', async () => {
  const t = setup();
  await t.at(KICKOFF - 40 * MIN, [stream('уже-шёл')]); // шёл до запуска — молчим
  await t.at(KICKOFF - 20 * MIN, [stream('уже-шёл'), stream('новый', 'upcoming')]);
  await t.at(KICKOFF - 15 * MIN);
  await t.at(KICKOFF - 14 * MIN, [stream('уже-шёл'), stream('новый')]);
  await t.at(KICKOFF - 5 * MIN);
  t.status.started = true;
  await t.at(KICKOFF + 1 * MIN);
  await t.at(KICKOFF + 3 * MIN);
  t.stop();
  assert.deepEqual(t.events, ['soon', 'stream:новый', 'kickoff']);
});

test('приложение открыли за 5 минут до начала — напоминание сразу; через полчаса после — уже нет', async () => {
  const late = setup();
  await late.at(KICKOFF - 5 * MIN);
  late.stop();
  assert.deepEqual(late.events, ['soon']);

  const tooLate = setup();
  tooLate.status.started = true;
  await tooLate.at(KICKOFF + 30 * MIN);
  tooLate.stop();
  assert.deepEqual(tooLate.events, []);
});

test('без избранного и с выключенными уведомлениями — тишина', async () => {
  for (const user of [{}, { favorites: [{ id: 1, name: 'Фулхэм' }], notifications: false }]) {
    const t = setup(user);
    await t.at(KICKOFF - 10 * MIN, []);
    await t.at(KICKOFF + 1 * MIN, [stream('новый')]);
    t.stop();
    assert.deepEqual(t.events, []);
  }
});
