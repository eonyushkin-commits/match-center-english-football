// Разметка: данные → HTML-строка. Без DOM и без общего состояния — всё нужное приходит аргументами.
import { STATUS, audience, esc, eventMoment, hhmm, isLive, matchMinute, recordSecond } from './format.mjs';

// Шапка раздела: «Сейчас в эфире» или турнир с логотипом
export function sectionHeadHtml(s) {
  return s.live
    ? `Сейчас в эфире<span class="count">${s.rows.length}</span>`
    : `<img loading="lazy" src="https://images.fotmob.com/image_resources/logo/leaguelogo/${s.lg.id}.png" alt=""> ${esc(s.lg.name)} <small>${esc(s.lg.country)}</small><span class="count">${s.rows.length}</span>`;
}

// у канала бывает несколько эфиров на матч (перезапуск) — нумеруем: «Sportcast», «Sportcast 2»
function streamLabels(streams) {
  const seen = {};
  return streams.map((s) => ((seen[s.channel] = (seen[s.channel] || 0) + 1) > 1 ? `${s.channel} ${seen[s.channel]}` : s.channel));
}

// Строка матча. view: { favIds — Set команд в избранном, hidden(m) — прятать ли счёт,
// player — { rowKey, i } открытого плеера }
export function rowHtml({ key, m, lg, showLeague }, view) {
  const live = isLive(m);
  // статус — как его отдаёт FotMob (FT, HT, AET, Pen…)
  const when = esc(m.cancelled ? (m.reason || 'Canc.') : live ? (m.liveTime || 'LIVE') : m.finished ? (m.reason || 'FT') : hhmm(m.utcTime));
  const showScore = m.started || m.finished;
  const hidden = view.hidden(m);
  const team = (t, other) => {
    const fav = view.favIds.has(t.id);
    const score = hidden
      ? `<button type="button" class="score masked" data-reveal="${m.id}" title="Показать счёт">?</button>`
      : `<span class="score">${esc(t.score)}</span>`;
    return `<div class="team${!hidden && m.finished && t.score > other.score ? ' win' : ''}">
      <img loading="lazy" src="https://images.fotmob.com/image_resources/logo/teamlogo/${t.id}_small.png" alt="">
      <span class="name">${esc(t.name)}</span>
      <button type="button" class="star${fav ? ' on' : ''}" data-fav="${t.id}" data-name="${esc(t.name)}" aria-pressed="${fav}"
        title="${fav ? 'Убрать из избранного' : 'В избранное — напомню за 15 минут и в начале каждого матча команды'}">★</button>
      ${showScore ? score : ''}</div>`;
  };

  const labels = streamLabels(m.streams);
  const p = view.player;
  let chips = m.streams.map((s, i) => {
    const aud = audience(s);
    return `<a class="stream ${s.status}${p?.rowKey === key && p.i === i ? ' active' : ''}"
      href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(aud ? `${s.title}\n${aud.title}` : s.title)}" data-play="${i}">
      <span class="tag">${STATUS[s.status] || ''}</span>${esc(labels[i])}${aud ? `<span class="aud">${esc(aud.text)}</span>` : ''}</a>`;
  }).join('');
  if (!chips && !m.finished && !m.cancelled) {
    const q = encodeURIComponent(`${m.home.name} ${m.away.name}`);
    chips = `<a class="stream find" href="https://vkvideo.ru/search?q=${q}" target="_blank" rel="noopener">Искать в VK</a>`;
  }
  const bell = !m.started && !m.cancelled
    ? `<button type="button" class="bell${m.remind ? ' on' : ''}" data-remind aria-pressed="${!!m.remind}"
        title="${m.remind ? 'Не напоминать' : 'Напомнить за 15 минут и в начале матча'}">🔔</button>` : '';
  return `<div class="when${live ? ' live' : ''}">${when}${bell}</div>
    <div class="teams">${team(m.home, m.away)}${team(m.away, m.home)}</div>
    <div class="side">${showLeague ? `<span class="lg-tag">${esc(lg.name)}</span>` : ''}
      <a class="fm" href="https://www.fotmob.com/match/${m.id}" target="_blank" rel="noopener" title="Открыть в FotMob">FotMob ↗</a></div>
    ${chips ? `<div class="streams">${chips}</div>` : ''}`;
}

export function emptyHtml(filtered) {
  if (filtered) return '<b>Нет матчей по выбранным фильтрам</b><button type="button" class="btn" data-action="reset-filters">Сбросить фильтры</button>';
  return '<b>В этот день матчей нет</b>Турниры выбираются в настройках.';
}

// ---------- события и составы ----------
const CARD = { yellow: '🟨', red: '🟥', yellowred: '🟨🟥' };

// seek — «номер эфира:секунда» записи с этим голом или null
function eventHtml(e, seek) {
  if (e.kind === 'half') return `<li class="ev half"><span>${esc(e.label)} · ${esc(e.score.join(':'))}</span></li>`;
  let icon = '⇄';
  let text = `<span>${esc(e.in)}</span><small>${esc(e.out)}</small>`;
  if (e.kind === 'goal') {
    icon = '⚽';
    text = `<b>${esc(e.player)}</b>${e.penalty ? ' (пен.)' : ''}${e.own ? ' (авт.)' : ''}${e.assist ? `<small>${esc(e.assist)}</small>` : ''}`;
  } else if (e.kind === 'card') {
    icon = CARD[e.card] || '🟨';
    text = `<span>${esc(e.player)}</span>`;
  }
  const body = `<div class="evtext">${text}</div>`;
  return `<li class="ev ${e.kind}"><div class="h">${e.side === 'home' ? body : ''}</div>
    <div class="mid"><span class="min">${esc(e.minute)}’</span><span class="icon">${icon}</span>${e.kind === 'goal' ? `<b class="evscore">${esc(e.score.join(':'))}</b>` : ''}${seek ? `<button type="button" class="seek" data-seek="${seek}" title="Смотреть момент в записи">▶</button>` : ''}</div>
    <div class="a">${e.side === 'away' ? body : ''}</div></li>`;
}

function lineupsHtml(l, m, subsOpen) {
  const players = (list) => `<ol>${list.map((p) => `<li><span class="num">${esc(p.number)}</span>${esc(p.name)}</li>`).join('')}</ol>`;
  const team = (t, name) => `<div class="lu"><div class="luhead"><b>${esc(name)}</b>${t.formation ? `<span>${esc(t.formation)}</span>` : ''}</div>
    ${players(t.starters)}${t.coach ? `<div class="coach">Тренер: ${esc(t.coach)}</div>` : ''}
    ${t.subs.length ? `<details${subsOpen ? ' open' : ''}><summary>Запасные · ${t.subs.length}</summary>${players(t.subs)}</details>` : ''}</div>`;
  return `<div class="lineups">${team(l.home, m.home.name)}${team(l.away, m.away.name)}</div>`;
}

// Записи матча с первого свистка. Эфир, начатый после свистка, — с начала и с подписью минуты.
function recordingsHtml(m, k) {
  if (!k?.h1) return '';
  const labels = streamLabels(m.streams);
  const buttons = m.streams.map((s, i) => {
    if (s.status !== 'finished' || !s.time || !s.embed) return '';
    const sec = recordSecond(s, k.h1);
    if (sec != null) return `<button type="button" class="btn" data-seek="${i}:${sec}">${esc(labels[i])}</button>`;
    if (s.time < k.h1) return ''; // закончилась до свистка — видимо, превью или обрыв
    const late = matchMinute(k, s.time);
    return `<button type="button" class="btn" data-seek="${i}:0" title="Эфир начался на ${late}-й минуте">${esc(labels[i])} · с ${late}’</button>`;
  }).join('');
  return buttons ? `<div class="recs"><span>Смотреть с начала матча</span>${buttons}</div>` : '';
}

// Запись с моментом гола: сначала та, что уже открыта в плеере, иначе первая, где он есть
function goalSeek(m, k, e, playing) {
  const at = eventMoment(k, e.min, e.plus);
  if (at == null) return null;
  const order = playing == null ? m.streams.keys() : [playing, ...m.streams.keys()];
  for (const i of order) {
    const sec = m.streams[i] && m.streams[i].embed ? recordSecond(m.streams[i], at) : null;
    if (sec != null) return `${i}:${sec}`;
  }
  return null;
}

// d — раскрытые подробности { data, error, subsOpen }; hidden — счёт скрыт режимом без спойлеров;
// playing — номер эфира этого матча, открытого в плеере
export function detailsHtml(m, d, hidden, playing = null) {
  if (d.error) return `<div class="dnote">Не удалось загрузить: ${esc(d.error)}</div>`;
  if (!d.data) return '<div class="dnote">Загрузка…</div>';
  const x = d.data;
  let events;
  if (hidden) events = `<div class="dnote">События скрыты, чтобы не выдать счёт. <button type="button" class="btn" data-reveal="${m.id}">Показать счёт и события</button></div>`;
  else if (x.pending) events = `<div class="dnote">События появятся через ${x.readyIn} с — они идут с задержкой в минуту, чтобы не обгонять трансляцию.</div>`;
  else if (!x.events.length) events = `<div class="dnote">${x.state === 'upcoming' ? 'Матч ещё не начался.' : 'Событий пока нет.'}</div>`;
  else events = `<ol class="timeline">${x.events.map((e) => eventHtml(e, e.kind === 'goal' ? goalSeek(m, x.kickoffs, e, playing) : null)).join('')}</ol>${x.delayed ? '<div class="dnote small">С задержкой в минуту, чтобы не обгонять трансляцию.</div>' : ''}`;
  const lineups = x.lineups ? lineupsHtml(x.lineups, m, d.subsOpen) : x.state === 'upcoming' ? '<div class="dnote">Составы появятся примерно за час до начала.</div>' : '';
  return `<div class="dinner">${recordingsHtml(m, x.kickoffs)}<h4>События</h4>${events}${lineups ? `<h4>Составы</h4>${lineups}` : ''}</div>`;
}

// ---------- обновление приложения: «Скачать» → «Установить» ----------
// Крестик прячет полосу до следующего шага (загрузилось, ошибка) или до перезапуска приложения
export const updateKey = (u) => `${u.version}:${u.state}`;
const HIDE = {
  available: 'Скрыть — напомню при следующем запуске',
  downloading: 'Скрыть — загрузка продолжится',
  ready: 'Скрыть — обновление установится при выходе из приложения',
  error: 'Скрыть',
};

export function updateHtml(u) {
  if (!HIDE[u.state]) return null;
  const v = esc(u.version);
  const notes = u.notes ? ` <a href="${esc(u.notes)}" target="_blank" rel="noopener">Что нового ↗</a>` : '';
  const hide = `<button type="button" class="icon-btn" data-action="update-dismiss" aria-label="Скрыть" title="${HIDE[u.state]}">✕</button>`;
  if (u.state === 'available') return `<span><b>Доступна версия ${v}.</b>${notes}</span>
    <span class="actions"><button type="button" class="btn primary" data-action="update-download">Скачать</button>${hide}</span>`;
  if (u.state === 'downloading') return `<span><b>Загружается версия ${v}…</b> ${u.percent || 0}%</span><progress max="100" value="${u.percent || 0}"></progress>
    <span class="actions">${hide}</span>`;
  if (u.state === 'ready') return `<span><b>Версия ${v} загружена.</b> Приложение перезапустится — открытая трансляция прервётся.${notes}</span>
    <span class="actions"><button type="button" class="btn primary" data-action="update-install">Установить</button>${hide}</span>`;
  return `<span><b>Не удалось загрузить обновление:</b> ${esc(u.error)}</span>
    <span class="actions"><button type="button" class="btn" data-action="update-download">Повторить</button>${hide}</span>`;
}

// Полосы над списком: обновление, ошибки, недоступные источники → [[класс, html], …]
export function notices({ error, day, status, saveError, update: u, updateDismissed }) {
  const out = [];
  if (error && day) out.push(['bad', `<b>Не удалось обновить расписание:</b> ${esc(error)}. Показаны последние данные.`]);
  if (day?.stale) out.push(['', '<b>FotMob сейчас недоступен</b> — показано расписание, полученное ранее.']);
  for (const w of status?.warnings || []) out.push(['bad', esc(w)]);
  const vk = status?.vk;
  if (vk?.ready && vk.channels.length && vk.channels.every((c) => c.ok === false))
    out.push(['bad', '<b>Не удалось прочитать ни один канал VK.</b> Каналы читаются только с российского адреса. <button type="button" data-action="status">Подробнее</button>']);
  if (saveError) out.push(['bad', `<b>Не удалось сохранить настройки:</b> ${esc(saveError)}`]);
  const update = u && updateDismissed !== updateKey(u) && updateHtml(u);
  if (update) out.unshift(['update', update]);
  return out;
}

// ---------- панель каналов ----------
export function statusBadge(vk) {
  if (!vk?.ready) return { cls: 'wait', text: 'VK…' };
  const bad = vk.channels.filter((c) => c.ok === false).length;
  const cls = !vk.channels.length ? '' : !bad ? 'ok' : bad === vk.channels.length ? 'bad' : 'warn';
  return { cls, text: `${vk.streamCount} эфиров · ${hhmm(vk.updatedAt)}` };
}

export function popoverHtml(vk, refreshSeconds) {
  const rows = (vk?.channels || []).map((c) => {
    const cls = c.ok === null ? 'wait' : c.ok ? 'ok' : 'bad';
    const how = c.ok === null ? 'читается…' : c.ok ? (c.via === 'api' ? 'через API' : 'через страницу канала') : esc(c.error);
    const when = c.okAt ? ` · данные от ${hhmm(c.okAt)}` : '';
    return `<div class="chan"><span class="dot ${cls}"></span><b>${esc(c.label)}</b><span class="n">${c.count} эфиров</span><small>${how}${c.ok === null ? '' : when}</small></div>`;
  }).join('');
  return `<h4>Каналы VK</h4>${rows || '<div class="empty">Каналов нет — добавьте их в настройках</div>'}
    <div class="actions"><span>Обновляются раз в ${refreshSeconds ?? 60} с</span>
    <button type="button" class="btn" data-action="refresh-vk">Обновить сейчас</button></div>`;
}
