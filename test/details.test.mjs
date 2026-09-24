import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DELAY_MS, createDetails, parseEvents, parseLineups } from '../src/core/details.mjs';

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
    header: { status: { started: true, finished: false } },
    content: { matchFacts: { events: { events: Array.from({ length: goals }, (_, i) => ({
      type: 'Goal', time: 10 + i, isHome: true, player: { name: `Игрок ${i + 1}` }, newScore: [i + 1, 0],
    })) } } },
  });
  return { fotmob: { match: async () => { calls++; return match(); } }, goal: () => goals++, calls: () => calls };
}

test('идущий матч отдаётся с задержкой в минуту', async () => {
  let now = 0;
  const f = liveFotmob();
  const get = createDetails({ fotmob: f.fotmob, now: () => now });

  const first = await get('1');
  assert.equal(first.pending, true, 'сразу после открытия — ещё нечего показать');
  assert.equal(first.readyIn, DELAY_MS / 1000);

  f.goal(); // гол забили через 10 секунд после открытия
  now = 30e3;
  assert.equal((await get('1')).pending, true);

  now = 60e3; // прошла минута: показываем состояние минутной давности — ещё без гола
  const before = await get('1');
  assert.equal(before.pending, undefined);
  assert.equal(before.delayed, true);
  assert.equal(before.events.length, 0, 'гол из последней минуты не показан');

  now = 95e3; // гол подтянулся в снимок на 30-й секунде, ему уже больше минуты
  assert.equal((await get('1')).events.length, 1);
});

test('завершённый матч — без задержки и без лишних запросов', async () => {
  let calls = 0;
  const get = createDetails({ fotmob: { match: async () => { calls++; return raw; } }, now: () => 0 });
  const d = await get('5795461');
  assert.equal(d.state, 'finished');
  assert.equal(d.delayed, false);
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
