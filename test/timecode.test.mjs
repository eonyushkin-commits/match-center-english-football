// Запись с первого свистка: время начала матча FotMob → секунда записи VK. Реальные данные —
// Тоттенхэм — Астон Вилла, 19.09.2026: свисток на 20:14 записи Английского Акцента и на 6:10 у ВЫШЛИ!
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fotmobTime, parseKickoff } from '../src/core/details.mjs';
import { recordSecond, withTime } from '../src/web/format.mjs';

const iso = (ms) => new Date(ms).toISOString();
const halfs = { firstHalfStarted: '19.09.2026 13:31:12', secondHalfStarted: '19.09.2026 14:39:37' };
const kickoff = parseKickoff({ header: { status: { utcTime: '2026-09-19T11:30:00.000Z', halfs } } });
const rec = (o) => ({ status: 'finished', channel: 'Английский Акцент', url: 'https://vkvideo.ru/video-1_2', embed: 'https://vkvideo.ru/video_ext.php?oid=-1&id=2&hash=h', time: Date.parse('2026-09-19T11:10:58Z'), duration: 8748, ...o });

test('fotmobTime: центральноевропейское время, летом UTC+2, зимой UTC+1', () => {
  assert.equal(iso(fotmobTime('19.09.2026 13:31:12')), '2026-09-19T11:31:12.000Z');
  assert.equal(iso(fotmobTime('03.01.2026 13:30:39')), '2026-01-03T12:30:39.000Z');
  assert.equal(iso(fotmobTime('29.03.2026 03:30:00')), '2026-03-29T01:30:00.000Z', 'сразу после перехода на летнее');
  assert.equal(fotmobTime(''), null);
  assert.equal(fotmobTime('2026-09-19 13:31'), null);
});

test('parseKickoff: первый свисток в UTC; без начала матча или со странным временем — null', () => {
  assert.equal(iso(kickoff), '2026-09-19T11:31:12.000Z');
  assert.equal(parseKickoff({ header: { status: { halfs: { firstHalfStarted: '' } } } }), null);
  assert.equal(parseKickoff({ header: { status: { utcTime: '2026-09-19T11:30:00Z', halfs: { firstHalfStarted: '19.09.2026 23:31:12' } } } }), null);
});

test('recordSecond: свисток — 20:14 у Английского Акцента, 6:10 у ВЫШЛИ!', () => {
  assert.equal(recordSecond(rec(), kickoff), 20 * 60 + 14);
  assert.equal(recordSecond(rec({ time: Date.parse('2026-09-19T11:25:02Z') }), kickoff), 6 * 60 + 10);
  assert.equal(recordSecond(rec({ time: kickoff + 60e3 }), kickoff), null, 'эфир начался после свистка');
  assert.equal(recordSecond(rec({ duration: 600 }), kickoff), null, 'запись кончилась раньше');
  assert.equal(recordSecond(rec({ status: 'started' }), kickoff), null, 'идущий эфир не перематываем');
  assert.equal(recordSecond(rec({ time: null }), kickoff), null);
});

test('withTime', () => {
  assert.equal(withTime('https://vkvideo.ru/video_ext.php?oid=-1&id=2', 1214), 'https://vkvideo.ru/video_ext.php?oid=-1&id=2&t=20m14s');
  assert.equal(withTime('https://vkvideo.ru/live-1_2', 370), 'https://vkvideo.ru/live-1_2?t=6m10s');
  assert.equal(withTime('https://vkvideo.ru/live-1_2', null), 'https://vkvideo.ru/live-1_2');
});
