// Ответы FotMob и VK неожиданной формы дают понятную ошибку, а не пустой список.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDay } from '../src/core/day.mjs';
import { createFotmob } from '../src/core/fotmob.mjs';
import { resolve } from '../src/core/settings.mjs';
import { FormatError } from '../src/core/shape.mjs';
import { toItems } from '../src/core/vk-items.mjs';
import { notices } from '../src/web/view.mjs';

const answers = (body) => async () => new Response(JSON.stringify(body));
const changed = /изменил формат ответа \(.+\) — нужна новая версия приложения/;

test('FotMob: расписание без списка leagues, названия без Participants, матч без header.status — ошибка формата', async () => {
  const f = createFotmob(answers({ matches: [] }));
  await assert.rejects(f.day('20260920', 'Europe/Moscow'), (e) => e instanceof FormatError && /FotMob.*нет списка leagues/.test(e.message));
  await assert.rejects(f.names(), changed);
  await assert.rejects(f.leagues(), changed);
  await assert.rejects(f.match(1), changed);
});

test('FotMob: день за пределами расписания (null) — просто без матчей', async () => {
  assert.deepEqual(await createFotmob(answers(null)).day('20270715', 'Europe/Moscow'), { leagues: [] });
});

test('FotMob сменил формат после удачного ответа — отдаётся прежнее расписание с пометкой', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  let body = { leagues: [{ id: 47, matches: [] }] };
  const f = createFotmob(async () => new Response(JSON.stringify(body)));
  await f.day('20260920', 'UTC');
  body = { data: [] };
  t.mock.timers.tick(60e3);
  const day = await f.day('20260920', 'UTC');
  assert.equal(day.leagues.length, 1);
  assert.equal(day.stale.format, true);
  assert.match(day.stale.message, changed);
  const built = buildDay({ fm: day, ru: {}, settings: resolve({}), snapshot: { streams: [] } });
  assert.equal(built.stale.format, true);
  assert.match(notices({ day: built })[0][1], /FotMob изменил формат ответа.*Показано расписание, полученное ранее/);
});

test('buildDay: матч выбранного турнира без команд — ошибка формата; чужие турниры не проверяются', () => {
  const ok = { id: 1, home: { id: 1, name: 'A' }, away: { id: 2, name: 'B' }, status: { utcTime: '2026-09-20T15:00:00Z' } };
  const build = (leagues) => buildDay({ fm: { leagues }, ru: {}, settings: resolve({}), snapshot: { streams: [] } });
  assert.throws(() => build([{ id: 47, matches: [ok, { id: 2, homeTeam: {}, status: {} }] }]), /FotMob изменил формат ответа \(у матча 2 нет команд или времени начала\)/);
  assert.equal(build([{ id: 47, matches: [ok] }, { id: 999999, matches: [{ id: 3 }] }]).leagues.length, 1);
});

test('VK: ни у одного видео нет номера и названия — ошибка формата; пустой список и обычные видео — нет', () => {
  assert.throws(() => toItems([{ video_id: 1, name: 'Брайтон — Арсенал' }], { label: 'X' }), /VK изменил формат ответа/);
  assert.deepEqual(toItems([], { label: 'X' }), []);
  assert.deepEqual(toItems([{ owner_id: -1, id: 1, title: 'Обзор тура' }], { label: 'X' }), []);
});
