import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createDetails, parseEvents, parseLineups } from '../src/core/details.mjs';

// Манчестер Сити — Сандерленд 5:3, 20.09.2026 — ответ FotMob, урезанный до нужных полей
const raw = JSON.parse(readFileSync(new URL('./fixtures/fotmob-match-5795461.json', import.meta.url), 'utf8'));

test('parseEvents: голы со счётом после гола, карточки, замены, перерыв', () => {
  const ev = parseEvents(raw);
  const goals = ev.filter((e) => e.kind === 'goal');
  assert.equal(goals.length, 8);
  assert.deepEqual(goals.at(-1).score, [5, 3], 'итоговый счёт 5:3');
  assert.deepEqual(goals[0], { kind: 'goal', minute: '9', min: 9, plus: 0, side: 'home', player: 'Enzo Fernández', assist: null, own: false, penalty: false, score: [1, 0] });
  assert.equal(goals[2].assist, 'Antoine Semenyo', '«assist by» убран');
  assert.deepEqual(ev.find((e) => e.kind === 'card'), { kind: 'card', minute: '8', side: 'away', player: 'Dayann Méthalie', card: 'yellow' });
  assert.deepEqual(ev.find((e) => e.kind === 'sub'), { kind: 'sub', minute: '60', side: 'away', in: 'Malick Fofana', out: 'Nilson Angulo' });
  assert.deepEqual(ev.find((e) => e.kind === 'half'), { kind: 'half', minute: '45', label: 'HT', score: [3, 2] });
});

test('parseLineups: схема, тренер, основа и запасные', () => {
  const l = parseLineups(raw);
  assert.equal(l.home.formation, '4-2-3-1');
  assert.equal(l.home.coach, 'Enzo Maresca');
  assert.equal(l.home.starters.length, 11);
  assert.deepEqual(l.home.starters[0], { number: '1', name: 'Gianluigi Donnarumma' });
  assert.equal(l.home.subs.length, 9);
  assert.equal(parseLineups({}), null, 'составов ещё нет');
});

// FotMob, у которого матч идёт и в котором мы сами двигаем время и счёт
function liveFotmob() {
  let goals = 0;
  let calls = 0;
  const match = () => ({
    header: { status: { started: true, finished: false, utcTime: '2026-09-19T11:30:00.000Z', halfs: { firstHalfStarted: '19.09.2026 13:31:12' } } },
    content: { matchFacts: { events: { events: Array.from({ length: goals }, (_, i) => ({
      type: 'Goal', time: 10 + i, isHome: true, player: { name: `Игрок ${i + 1}` }, newScore: [i + 1, 0],
    })) } } },
  });
  return { fotmob: { match: async () => { calls++; return match(); } }, goal: () => goals++, calls: () => calls };
}

test('идущий матч — сразу свежие события, FotMob не чаще раза в 20 с', async () => {
  let now = 0;
  const f = liveFotmob();
  const get = createDetails({ fotmob: f.fotmob, now: () => now });

  const first = await get('1');
  assert.equal(first.state, 'live');
  assert.equal(first.kickoffs.h1, Date.parse('2026-09-19T11:31:12Z'));

  f.goal(); // гол забили через 5 секунд после открытия
  now = 10e3;
  assert.equal((await get('1')).events.length, 0, 'в пределах 20 с — из кэша');
  now = 20e3;
  assert.equal((await get('1')).events.length, 1, 'при следующем обновлении гол уже виден');
  assert.equal(f.calls(), 2);
});

test('предстоящий матч перечитывается так же часто — к началу события уже идут', async () => {
  let now = 0;
  let started = false;
  const get = createDetails({ fotmob: { match: async () => ({ header: { status: { started, finished: false } } }) }, now: () => now });
  assert.equal((await get('1')).state, 'upcoming');
  started = true;
  now = 20e3;
  assert.equal((await get('1')).state, 'live');
});

test('завершённый матч — без лишних запросов', async () => {
  let calls = 0;
  const get = createDetails({ fotmob: { match: async () => { calls++; return raw; } }, now: () => 0 });
  const d = await get('5795461');
  assert.equal(d.state, 'finished');
  assert.equal(d.events.filter((e) => e.kind === 'goal').length, 8);
  await get('5795461');
  assert.equal(calls, 1, 'повторно FotMob не спрашиваем');
});

test('parseEvents: добавленное время — «45+4», без повтора', () => {
  const ev = parseEvents({ content: { matchFacts: { events: { events: [
    { type: 'Goal', time: 45, timeStr: '45 + 4', overloadTime: 4, overloadTimeStr: '+4', isHome: true, newScore: [0, 1], player: { name: 'A' } },
    { type: 'Card', time: 19, timeStr: 19, isHome: false, card: 'Yellow', player: { name: 'B' } },
  ] } } } });
  assert.deepEqual(ev.map((e) => e.minute), ['45+4', '19']);
});
