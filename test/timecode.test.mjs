// Переход по записи: время таймов FotMob → секунда записи VK. Реальные данные — Тоттенхэм — Астон
// Вилла, 19.09.2026: свисток на 20:14 записи Английского Акцента и на 6:10 у ВЫШЛИ! (в эфире он
// виден на 20:50 и 6:50 — эфир отстаёт от стадиона на 36–40 с, это и есть запас).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fotmobTime, parseKickoffs } from '../src/core/details.mjs';
import { eventMoment, matchMinute, recordSecond, withTime } from '../src/web/format.mjs';
import { detailsHtml } from '../src/web/view.mjs';

const iso = (ms) => new Date(ms).toISOString();
const halfs = { firstHalfStarted: '19.09.2026 13:31:12', secondHalfStarted: '19.09.2026 14:39:37', firstExtraHalfStarted: '', secondExtraHalfStarted: '' };
const k = parseKickoffs({ header: { status: { utcTime: '2026-09-19T11:30:00.000Z', halfs } } });
const rec = (o) => ({ status: 'finished', channel: 'Английский Акцент', embed: 'https://vkvideo.ru/video_ext.php?oid=-1&id=2&hash=h', time: Date.parse('2026-09-19T11:10:58Z'), duration: 8748, ...o });

test('fotmobTime: центральноевропейское время, летом UTC+2, зимой UTC+1', () => {
  assert.equal(iso(fotmobTime('19.09.2026 13:31:12')), '2026-09-19T11:31:12.000Z');
  assert.equal(iso(fotmobTime('03.01.2026 13:30:39')), '2026-01-03T12:30:39.000Z');
  assert.equal(iso(fotmobTime('29.03.2026 03:30:00')), '2026-03-29T01:30:00.000Z', 'сразу после перехода на летнее');
  assert.equal(fotmobTime(''), null);
  assert.equal(fotmobTime('2026-09-19 13:31'), null);
});

test('parseKickoffs: таймы в UTC; без начала матча или со странным временем — null', () => {
  assert.equal(iso(k.h1), '2026-09-19T11:31:12.000Z');
  assert.equal(iso(k.h2), '2026-09-19T12:39:37.000Z');
  assert.equal(k.e1, null);
  assert.equal(parseKickoffs({ header: { status: { halfs: { firstHalfStarted: '' } } } }), null);
  assert.equal(parseKickoffs({ header: { status: { utcTime: '2026-09-19T11:30:00Z', halfs: { firstHalfStarted: '19.09.2026 23:31:12' } } } }), null);
});

test('eventMoment: начало минуты гола от начала своего тайма', () => {
  const min = (m, plus) => (eventMoment(k, m, plus) - k.h1) / 60e3;
  assert.equal(min(1), 0);
  assert.equal(min(34), 33);
  assert.equal(min(45, 4), 48, '45+4 — ещё первый тайм');
  assert.equal((eventMoment(k, 46) - k.h2) / 60e3, 0);
  assert.equal((eventMoment(k, 90, 8) - k.h2) / 60e3, 52);
  assert.equal(eventMoment(k, 95), null, 'доп. времени не было');
  assert.equal(eventMoment(null, 10), null);
});

test('recordSecond: свисток — 20:14 у Английского Акцента, 6:10 у ВЫШЛИ!', () => {
  assert.equal(recordSecond(rec(), k.h1), 20 * 60 + 14);
  assert.equal(recordSecond(rec({ time: Date.parse('2026-09-19T11:25:02Z') }), k.h1), 6 * 60 + 10);
  assert.equal(recordSecond(rec({ time: k.h1 + 60e3 }), k.h1), null, 'эфир начался после свистка');
  assert.equal(recordSecond(rec({ duration: 600 }), k.h1), null, 'запись кончилась раньше');
  assert.equal(recordSecond(rec({ status: 'started' }), k.h1), null, 'идущий эфир не перематываем');
  assert.equal(recordSecond(rec({ time: null }), k.h1), null);
});

test('matchMinute и withTime', () => {
  assert.equal(matchMinute(k, k.h1 + 11.5 * 60e3), 12);
  assert.equal(matchMinute(k, k.h2 + 60e3), 47);
  assert.equal(matchMinute(k, k.h1 - 1), null);
  assert.equal(withTime('https://vkvideo.ru/video_ext.php?oid=-1&id=2', 1214), 'https://vkvideo.ru/video_ext.php?oid=-1&id=2&t=20m14s');
  assert.equal(withTime('https://vkvideo.ru/live-1_2', 370), 'https://vkvideo.ru/live-1_2?t=6m10s');
  assert.equal(withTime('https://vkvideo.ru/live-1_2', null), 'https://vkvideo.ru/live-1_2');
});

// ---------- разметка ----------
const goal = { kind: 'goal', minute: '45+4', min: 45, plus: 4, side: 'away', player: 'Буэндиа', score: [0, 1] };
const match = (streams) => ({ id: 1, home: { name: 'Тоттенхэм' }, away: { name: 'Астон Вилла' }, streams });
const details = (o = {}) => ({ data: { state: 'finished', events: [goal], lineups: null, kickoffs: k, ...o } });

test('detailsHtml: кнопки «с начала матча» у записей, поздний эфир — с минутой', () => {
  const m = match([rec(), rec({ channel: 'Sportcast', time: k.h1 + 11.5 * 60e3 }), rec({ channel: 'X', status: 'started' })]);
  const html = detailsHtml(m, details(), false);
  assert.match(html, /data-seek="0:1214">Английский Акцент</);
  assert.match(html, /data-seek="1:0" title="Эфир начался на 12-й минуте">Sportcast · с 12’/);
  assert.doesNotMatch(html, /data-seek="2:/, 'у идущего эфира кнопки нет');
});

test('detailsHtml: ▶ у гола — в открытой записи, если момент в ней есть', () => {
  const m = match([rec(), rec({ channel: 'ВЫШЛИ!', time: Date.parse('2026-09-19T11:25:02Z') })]);
  // 45+4 → 48:00 от свистка: 1214 + 2880 у первой записи, 370 + 2880 у второй
  assert.match(detailsHtml(m, details(), false), /class="seek" data-seek="0:4094"/);
  assert.match(detailsHtml(m, details(), false, 1), /class="seek" data-seek="1:3250"/);
  assert.doesNotMatch(detailsHtml(m, details({ kickoffs: null }), false), /data-seek/, 'без времени таймов — без переходов');
});

test('detailsHtml: без спойлеров — начало матча есть, голов нет', () => {
  const html = detailsHtml(match([rec()]), details(), true);
  assert.match(html, /data-seek="0:1214"/);
  assert.doesNotMatch(html, /class="seek"|Буэндиа/);
});
