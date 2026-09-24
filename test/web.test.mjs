// Логика и разметка страницы — без браузера: src/web/*.mjs не трогают DOM.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markFavorites, scoresHidden, sections } from '../src/web/filter.mjs';
import { addDays, audience, embedUrl, esc, parseAliases, parseChannel } from '../src/web/format.mjs';
import { detailsHtml, notices, rowHtml, statusBadge, updateHtml } from '../src/web/view.mjs';

const stream = (o) => ({ status: 'started', channel: 'Sportcast', title: 'Челси — Арсенал', url: 'https://vkvideo.ru/video-1_2', embed: 'https://vkvideo.ru/video_ext.php?oid=-1&id=2&hash=h', ...o });
const match = (o = {}) => ({
  id: 1, utcTime: '2026-09-20T14:00:00Z', started: false, finished: false, cancelled: false,
  home: { id: 10, name: 'Челси', score: 0 }, away: { id: 20, name: 'Арсенал', score: 0 }, streams: [], ...o,
});
const view = (o = {}) => ({ favIds: new Set(), hidden: () => false, player: null, detailsKey: null, ...o });
const row = (m) => rowHtml({ key: `m:${m.id}`, m, lg: { name: 'Премьер-лига' } }, view());

// ---------- format ----------
test('esc экранирует всё, что ломает разметку', () => {
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});

test('addDays переходит через месяц и год', () => {
  assert.equal(addDays('20261231', 1), '20270101');
  assert.equal(addDays('20260301', -1), '20260228');
});

test('audience: зрители только у идущего эфира', () => {
  assert.match(audience(stream({ spectators: 1234 })).text, /^ · 1,2\sтыс\. смотрят$/);
  assert.equal(audience(stream({ status: 'finished', spectators: 18557 })), null);
  assert.equal(audience(stream({ spectators: 0 })), null);
});

test('embedUrl: только https-плеер VK, без __ref', () => {
  assert.equal(embedUrl(stream({ embed: 'https://vkvideo.ru/video_ext.php?oid=-1&id=2&hash=h&__ref=x' })), 'https://vkvideo.ru/video_ext.php?oid=-1&id=2&hash=h');
  assert.equal(embedUrl(stream({ embed: 'http://vkvideo.ru/video_ext.php' })), null);
  assert.equal(embedUrl(stream({ embed: 'https://evil.example/vkvideo.ru' })), null);
  assert.equal(embedUrl(stream({ embed: 'не ссылка' })), null);
  assert.equal(embedUrl(stream({ embed: null })), null);
});

test('parseChannel понимает ссылки и @имя', () => {
  for (const s of ['vkvideo.ru/@pl_forever', 'https://vkvideo.ru/@pl_forever/lives', 'https://www.vk.com/video/@pl_forever', '@pl_forever', ' pl_forever '])
    assert.equal(parseChannel(s), 'pl_forever', s);
  assert.equal(parseChannel('https://vkvideo.ru/'), null);
  assert.equal(parseChannel('два слова'), null);
});

test('parseAliases: строки «Команда = варианты», пустые пропускаются', () => {
  assert.deepEqual(parseAliases('Манчестер Юнайтед = МЮ, Ман Юнайтед\n\n Челси=Челси Лондон ').aliases,
    { 'Манчестер Юнайтед': ['МЮ', 'Ман Юнайтед'], Челси: ['Челси Лондон'] });
  assert.match(parseAliases('Челси').error, /Не понял строку «Челси»/);
  assert.match(parseAliases('Челси = ').error, /Челси =/);
});

// ---------- filter ----------
test('scoresHidden: только в режиме без спойлеров, у начавшихся и не раскрытых', () => {
  const on = { hideScores: true, revealed: new Set() };
  assert.equal(scoresHidden(match({ finished: true }), on), true);
  assert.equal(scoresHidden(match({ started: true }), on), true);
  assert.equal(scoresHidden(match(), on), false);
  assert.equal(scoresHidden(match({ finished: true }), { hideScores: true, revealed: new Set([1]) }), false);
  assert.equal(scoresHidden(match({ finished: true }), { hideScores: false, revealed: new Set() }), false);
});

test('markFavorites: ★ команды и 🔔 матча делают матч избранным', () => {
  const a = match({ id: 1 });
  const b = match({ id: 2, home: { id: 30, name: 'Фулхэм' }, away: { id: 40, name: 'Брентфорд' } });
  const c = match({ id: 3, home: { id: 50, name: 'Бёрнли' }, away: { id: 60, name: 'Лутон' } });
  markFavorites({ leagues: [{ matches: [a, b, c] }] }, { favorites: [{ id: 20 }], favoriteMatches: [{ id: 2 }] });
  assert.deepEqual([a, b, c].map((m) => [m.favorite, m.remind]), [[true, false], [true, true], [false, false]]);
});

function day() {
  const live = match({ id: 1, started: true, streams: [stream()] });
  const liveNoStream = match({ id: 2, started: true, home: { id: 30, name: 'Фулхэм' }, away: { id: 40, name: 'Брентфорд' } });
  const later = match({ id: 3, home: { id: 50, name: 'Бёрнли' }, away: { id: 60, name: 'Лутон' }, favorite: true });
  const cup = match({ id: 4, finished: true, home: { id: 70, name: 'Лидс' }, away: { id: 80, name: 'Хаддерсфилд' }, streams: [stream({ status: 'finished' })] });
  return { leagues: [{ id: 47, name: 'Премьер-лига', country: 'Англия', matches: [live, liveNoStream, later] }, { id: 132, name: 'Кубок Англии', country: 'Англия', matches: [cup] }] };
}
const NO = { streams: false, live: false, favorites: false };
const keys = (secs) => secs.map((s) => `${s.key}=${s.rows.map((r) => r.m.id).join(',')}`);
const pick = (o) => keys(sections({ day: day(), isToday: true, filters: NO, q: '', pinned: new Set(), ...o }));

test('sections: «Сейчас в эфире» — сегодня, только матчи с идущим эфиром', () => {
  assert.deepEqual(pick({}), ['live=1', 'lg:47=1,2,3', 'lg:132=4']);
  assert.deepEqual(pick({ isToday: false }), ['lg:47=1,2,3', 'lg:132=4']);
});

test('sections: фильтры и поиск, пустой турнир пропадает', () => {
  assert.deepEqual(pick({ filters: { ...NO, streams: true } }), ['live=1', 'lg:47=1', 'lg:132=4']);
  assert.deepEqual(pick({ filters: { ...NO, live: true } }), ['lg:47=1,2']); // без блока «Сейчас в эфире»
  assert.deepEqual(pick({ filters: { ...NO, favorites: true } }), ['lg:47=3']);
  assert.deepEqual(pick({ q: '  ЛУТОН ' }), ['lg:47=3']);
  assert.deepEqual(pick({ q: 'кубок' }), ['lg:132=4']);
});

test('sections: строка с открытым плеером не прячется фильтром', () => {
  assert.deepEqual(pick({ filters: { ...NO, favorites: true }, pinned: new Set(['m:4', 'live:1']) }), ['live=1', 'lg:47=3', 'lg:132=4']);
});

// ---------- view: строка матча ----------
test('rowHtml: статус FotMob как есть, у будущего — время и колокольчик', () => {
  assert.match(row(match({ finished: true, reason: 'AET' })), /<div class="when">AET/);
  assert.match(row(match({ started: true, liveTime: '67’' })), /<div class="when live">67’/);
  assert.match(row(match({ cancelled: true })), /Canc\./);
  assert.match(row(match()), /data-remind/);
  assert.doesNotMatch(row(match({ started: true })), /data-remind/);
  assert.match(row(match({ remind: true })), /class="bell on"/);
});

test('rowHtml: без спойлеров вместо счёта «?», победитель не подсвечен', () => {
  const m = match({ finished: true, home: { id: 10, name: 'Челси', score: 3 }, away: { id: 20, name: 'Арсенал', score: 1 } });
  const open = rowHtml({ key: 'm:1', m, lg: {} }, view());
  assert.match(open, /<span class="score">3<\/span>/);
  assert.match(open, /class="team win"/);
  const hidden = rowHtml({ key: 'm:1', m, lg: {} }, view({ hidden: () => true }));
  assert.doesNotMatch(hidden, /class="score"|win/);
  assert.equal(hidden.match(/data-reveal="1"/g).length, 2);
});

test('rowHtml: эфиры — зрители только у LIVE, повторы канала нумеруются', () => {
  const html = row(match({ started: true, streams: [stream({ spectators: 1500 }), stream({ status: 'finished', spectators: 9000 })] }));
  assert.match(html, /LIVE<\/span>Sportcast<span class="aud"> · 1,5\sтыс\. смотрят/);
  assert.match(html, /запись<\/span>Sportcast 2<\/a>/);
  assert.equal(html.match(/смотрят/g).length, 1);
});

test('rowHtml: «Искать в VK» только у не сыгранного матча без эфиров', () => {
  assert.match(row(match()), /class="stream find" href="https:\/\/vkvideo\.ru\/search\?q=%D0%A7/);
  assert.doesNotMatch(row(match({ finished: true })), /Искать в VK|class="streams"/);
});

test('rowHtml: избранное, активный эфир и раскрытые подробности', () => {
  const m = match({ streams: [stream(), stream()] });
  const html = rowHtml({ key: 'm:1', m, lg: {} }, view({ favIds: new Set([20]), player: { rowKey: 'm:1', i: 1 }, detailsKey: 'm:1' }));
  assert.match(html, /class="star on" data-fav="20"/);
  assert.match(html, /class="star" data-fav="10"/);
  assert.equal(html.match(/ active"/g).length, 1);
  assert.match(html, /data-play="1"/);
  assert.match(html, /class="more on" data-details aria-expanded="true"/);
});

test('rowHtml экранирует названия из внешних источников', () => {
  const html = row(match({ home: { id: 1, name: '<img src=x onerror=alert(1)>' }, streams: [stream({ channel: '<b>', title: '"x"' })] }));
  assert.doesNotMatch(html, /<img src=x|<b>/);
});

// ---------- view: подробности ----------
const lineups = { home: { starters: [{ number: 1, name: 'Санчес' }], subs: [{ number: 13, name: 'Йоргенсен' }], coach: 'Мареска', formation: '4-2-3-1' },
  away: { starters: [{ number: 22, name: 'Райя' }], subs: [{ number: 1, name: 'Арризабалага' }] } };

test('detailsHtml: без спойлеров события скрыты, пока не нажали «Показать»', () => {
  const d = { data: { state: 'finished', events: [{ kind: 'goal', side: 'home', minute: 10, player: 'Палмер', score: [1, 0] }], lineups } };
  assert.match(detailsHtml(match(), d, true), /События скрыты.*data-reveal="1"/);
  assert.doesNotMatch(detailsHtml(match(), d, true), /Палмер/);
  assert.match(detailsHtml(match(), d, false), /⚽.*1:0/s);
});

test('detailsHtml: задержка, загрузка, ошибка, матч не начался', () => {
  assert.match(detailsHtml(match(), { data: { pending: true, readyIn: 42, events: [] } }, false), /через 42 с/);
  assert.match(detailsHtml(match(), { data: null }, false), /Загрузка/);
  assert.match(detailsHtml(match(), { error: 'HTTP 500' }, false), /Не удалось загрузить: HTTP 500/);
  assert.match(detailsHtml(match(), { data: { state: 'upcoming', events: [] } }, false), /ещё не начался.*Составы появятся/s);
});

test('detailsHtml: «Запасные» открыты у обеих команд сразу', () => {
  const d = { data: { state: 'live', events: [], lineups } };
  assert.equal(detailsHtml(match(), { ...d, subsOpen: true }, false).match(/<details open>/g).length, 2);
  assert.equal(detailsHtml(match(), d, false).match(/<details open>/g), null);
});

// ---------- view: полосы и статус ----------
test('updateHtml: «Скачать» → прогресс → «Установить»', () => {
  assert.match(updateHtml({ state: 'available', version: '3.0.0' }), /Доступна версия 3\.0\.0.*update-download/s);
  assert.match(updateHtml({ state: 'downloading', version: '3.0.0', percent: 37 }), /37%.*value="37"/);
  assert.match(updateHtml({ state: 'ready', version: '3.0.0' }), /update-install/);
  assert.equal(updateHtml({ state: 'none' }), null);
});

test('notices: обновление первым, «напомнить позже» прячет только эту версию', () => {
  const update = { state: 'available', version: '3.0.0' };
  const base = { error: 'сеть', day: {}, status: null, saveError: null, update };
  assert.deepEqual(notices(base).map(([cls]) => cls), ['update', 'bad']);
  assert.deepEqual(notices({ ...base, updateDismissed: '3.0.0' }).map(([cls]) => cls), ['bad']);
  assert.deepEqual(notices({ ...base, updateDismissed: '3.0.0', update: { ...update, state: 'ready' } }).map(([cls]) => cls), ['update', 'bad']);
});

test('notices: предупреждение, когда не читается ни один канал', () => {
  const vk = (oks) => ({ ready: true, channels: oks.map((ok) => ({ ok })) });
  assert.equal(notices({ status: { vk: vk([false, false]) } }).length, 1);
  assert.equal(notices({ status: { vk: vk([false, true]) } }).length, 0);
});

test('statusBadge: цвет точки по доле упавших каналов', () => {
  const vk = (oks) => ({ ready: true, streamCount: 5, updatedAt: 0, channels: oks.map((ok) => ({ ok })) });
  assert.equal(statusBadge(null).cls, 'wait');
  assert.equal(statusBadge(vk([true, true])).cls, 'ok');
  assert.equal(statusBadge(vk([true, false])).cls, 'warn');
  assert.equal(statusBadge(vk([false, false])).cls, 'bad');
  assert.match(statusBadge(vk([true])).text, /^5 эфиров · /);
});
