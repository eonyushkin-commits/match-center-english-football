// Главная страница: состояние, загрузка с сервера, плеер и обработчики. Разметка — в view.mjs,
// что показывать — в filter.mjs, что раскрыто — в opened.mjs, форматирование — в format.mjs:
// они без DOM и покрыты тестами.
import { reconcile, setHtml } from './dom.mjs';
import { markFavorites as mark, scoresHidden, sections as buildSections } from './filter.mjs';
import { addDays, dateStrip, embedUrl, esc, inDateRange, matchTitle, parseYmd, recordSecond, withTime, ymd } from './format.mjs';
import { createOpened, matchIdOf } from './opened.mjs';
import { openSettingsDialog } from './settings-ui.mjs';
import { detailsHtml, detailsToggleHtml, emptyHtml, notices, popoverHtml, rowHtml, sectionHeadHtml, statusBadge, updateKey } from './view.mjs';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

const state = {
  settings: null, // настройки с сервера: тема, фильтры, избранное живут там, а не в браузере
  status: null,
  day: null,
  error: null,
  saveError: null,
  today: ymd(new Date()),
  date: ymd(new Date()),
  stripStart: null, // первый день полосы дат; null — сегодня в середине
  q: '',
  revealed: new Set(), // матчи, у которых в режиме без спойлеров уже показали счёт
  update: null, // обновление приложения (только в приложении): { state, version, percent, notes, error }
  updateDismissed: null, // «версия:шаг» скрытой крестиком полосы обновления — до следующего шага или перезапуска
};
const opened = createOpened(); // плеер, события и составы, матчи «в окне»
let playerEl = null;

// режим без спойлеров: счёт скрыт, пока его не попросят показать
const isHidden = (m) => scoresHidden(m, { hideScores: state.settings?.ui.hideScores, revealed: state.revealed });

// ---------- сеть ----------
async function request(method, url, { body, signal } = {}) {
  const r = await fetch(url, {
    method, signal, cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `${r.status} ${r.statusText}`);
  return j;
}

// Один запрос за раз: новый отменяет предыдущий, таймер следующего заводит только последний.
let ctrl = null;
let timer = null;
let latest = null;
// Отменённая загрузка завершается вместе с той, что её сменила: кто ждёт load(), дождётся данных
function load() {
  return (latest = fetchDay());
}
async function fetchDay() {
  ctrl?.abort();
  const my = (ctrl = new AbortController());
  clearTimeout(timer);
  $('#refresh').classList.add('spin');
  let loaded = null;
  let error = null;
  try {
    loaded = await Promise.all([
      request('GET', `/api/day?date=${state.date}&tz=${encodeURIComponent(tz)}`, { signal: my.signal }),
      request('GET', '/api/status', { signal: my.signal }),
    ]);
  } catch (e) {
    error = e.message;
  }
  // нас отменили — ждём ту загрузку, что пришла на смену. Состояние пишет только последняя,
  // поэтому state.day всегда за state.date
  if (my !== ctrl) return latest;
  if (loaded) [state.day, state.status] = loaded;
  state.error = error;
  $('#refresh').classList.remove('spin');
  render();
  if (opened.details) loadDetails(); // события и составы обновляются вместе со счётом
  // окно скрыто (трей, свёрнуто) — не опрашиваем: при показе загрузит visibilitychange.
  // Пока каналы VK читаются впервые — спрашиваем чаще
  if (!document.hidden) timer = setTimeout(load, !state.status?.vk.ready ? 2000 : state.error ? 15000 : 30000);
}

// ---------- настройки ----------
let uiTimer = null;
let uiPending = {};
function saveUi(patch) {
  Object.assign(uiPending, patch);
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => {
    const ui = uiPending;
    uiPending = {};
    saveNow({ ui });
  }, 400);
}

function applyTheme() {
  const theme = state.settings?.ui.theme || 'system';
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  $('#theme').title = `Тема: ${{ system: 'как в системе', light: 'светлая', dark: 'тёмная' }[theme]}`;
}

const favoriteIds = () => new Set((state.settings?.favorites || []).map((f) => f.id));

function toggleFavorite(id, name) {
  const favs = state.settings.favorites;
  state.settings.favorites = favs.some((f) => f.id === id) ? favs.filter((f) => f.id !== id) : [...favs, { id, name }];
  markFavorites();
  render();
  saveNow({ favorites: state.settings.favorites });
}

// 🔔 у матча: напомнить за 15 минут и в начале, даже если команды не в избранном
function toggleRemind(m) {
  const list = state.settings.favoriteMatches;
  state.settings.favoriteMatches = list.some((f) => f.id === m.id)
    ? list.filter((f) => f.id !== m.id)
    : [...list, { id: m.id, name: matchTitle(m), utcTime: m.utcTime }];
  markFavorites();
  render();
  saveNow({ favoriteMatches: state.settings.favoriteMatches });
}

const markFavorites = () => mark(state.day, state.settings);

function saveNow(patch) {
  request('PUT', '/api/settings', { body: patch }).then(() => { state.saveError = null; }, (e) => {
    state.saveError = e.message;
    renderNotices();
  });
}

// ---------- что показывать ----------
const sections = () => buildSections({
  day: state.day,
  isToday: state.date === state.today,
  filters: state.settings.ui.filters,
  q: state.q,
  // матч с открытым плеером или подробностями не прячем никакими фильтрами
  pinned: opened.pinned(),
});

// ---------- отрисовка ----------
function render() {
  renderStatus();
  renderNotices();
  renderFilters();
  renderList();
}

// Полоса дат: ‹ › — на день назад и вперёд, в пределах сегодня ±10 дней
function renderDates() {
  const { start, days } = dateStrip(state.today, state.date, state.stripStart);
  state.stripStart = start;
  const arrow = (d, sign, label) => `<button type="button" class="shift" data-date="${d}" title="${label}" aria-label="${label}"${inDateRange(state.today, d) ? '' : ' disabled'}>${sign}</button>`;
  const html = [arrow(addDays(state.date, -1), '‹', 'Предыдущий день (←)')];
  for (const { date: d, offset: i } of days) {
    const dt = parseYmd(d);
    const label = i === 0 ? 'Сегодня' : i === -1 ? 'Вчера' : i === 1 ? 'Завтра' : dt.toLocaleDateString('ru-RU', { weekday: 'short' });
    const on = d === state.date;
    html.push(`<button type="button" data-date="${d}" class="${on ? 'on' : ''}" aria-pressed="${on}">${label}<small>${dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</small></button>`);
  }
  html.push(arrow(addDays(state.date, 1), '›', 'Следующий день (→)'));
  $('#dates').innerHTML = html.join('');
  $('#dates .on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderFilters() {
  const f = state.settings?.ui.filters || {};
  for (const b of $$('[data-filter]')) {
    b.classList.toggle('on', !!f[b.dataset.filter]);
    b.setAttribute('aria-pressed', String(!!f[b.dataset.filter]));
  }
  const hide = !!state.settings?.ui.hideScores;
  $('#spoilers').classList.toggle('on', hide);
  $('#spoilers').setAttribute('aria-pressed', String(hide));
}

function renderStatus() {
  const vk = state.status?.vk;
  const { cls, text } = statusBadge(vk);
  $('#status .dot').className = `dot ${cls}`;
  $('#status-text').textContent = text;
  $('#status').title = vk?.ready ? 'Каналы VK: нажмите, чтобы увидеть подробности' : 'Каналы VK читаются…';
  if (!$('#status-pop').hidden) renderPopover();
  if (state.status?.version) $('#foot').innerHTML = `Матч-центр ${esc(state.status.version)} · <kbd>←</kbd> <kbd>→</kbd> дни · <kbd>/</kbd> поиск · <kbd>R</kbd> обновить · <kbd>Esc</kbd> закрыть плеер`;
}

function renderNotices() {
  $('#notices').innerHTML = notices(state).map(([cls, html]) => `<div class="notice ${cls}">${html}</div>`).join('');
}

function renderList() {
  const list = $('#list');
  if (!state.settings || !state.day) {
    if (state.error) reconcile(list, [{ key: 'error', cls: 'empty', html: `<b>Не удалось загрузить расписание</b>${esc(state.error)}` }]);
    else reconcile(list, [1, 2, 3].map((i) => ({ key: `skeleton${i}`, cls: 'skeleton' })));
    return;
  }
  list.setAttribute('aria-busy', 'false');
  const secs = sections();
  if (!secs.length) {
    const f = state.settings.ui.filters;
    reconcile(list, [{ key: 'empty', cls: 'empty', html: emptyHtml(!!(state.q || f.streams || f.live || f.favorites)) }]);
    return;
  }
  reconcile(list, secs.map((s) => ({
    key: s.key,
    cls: s.live ? 'league live' : 'league',
    create: () => {
      const n = document.createElement('section');
      n.innerHTML = '<div class="lhead"></div><div class="rows"></div>';
      return n;
    },
  })));
  const view = { favIds: favoriteIds(), hidden: isHidden, player: opened.player };
  // кнопка «События и составы» под плеером показывает, раскрыты ли они
  const pmore = playerEl?.querySelector('.pmore');
  if (pmore) {
    const open = !!opened.player && opened.details?.rowKey === opened.player.rowKey;
    pmore.classList.toggle('on', open);
    pmore.setAttribute('aria-expanded', String(open));
  }
  const nodes = new Map([...list.children].map((n) => [n.dataset.key, n]));
  for (const s of secs) {
    const node = nodes.get(s.key);
    setHtml(node.firstElementChild, sectionHeadHtml(s));
    const items = [];
    for (const r of s.rows) {
      items.push({ key: r.key, cls: `match${r.m.favorite ? ' fav' : ''}`, html: rowHtml(r, view) });
      for (const what of opened.under(r.key)) items.push(under[what](r));
    }
    reconcile(node.lastElementChild, items);
  }
}

// что идёт под строкой матча (см. opened.under)
const under = {
  player: () => ({ key: 'player', node: playerEl }),
  popbar: (r) => ({ key: `pop:${r.key}`, cls: 'popbar', html: detailsToggleHtml(r.key, opened.details?.rowKey === r.key) }),
  details: (r) => ({ key: 'details', cls: 'details', html: detailsHtml(r.m, opened.details, isHidden(r.m)) }),
};

// ---------- события и составы ----------
function toggleDetails(rowKey) {
  const details = opened.toggleDetails(rowKey);
  renderList();
  if (details) loadDetails();
}

// Фактическое начало таймов матча (из подробностей) — чтобы открывать записи сразу на свистке.
// Запоминаем только найденное: нет ответа или времени — откроем запись с начала, а спросим в следующий раз.
const kickoffs = new Map(); // id матча → { h1, h2, e1, e2 }
async function kickoffsOf(id) {
  if (!kickoffs.has(id)) {
    try {
      const k = (await request('GET', `/api/match?id=${id}`)).kickoffs;
      if (k) kickoffs.set(id, k);
    } catch {}
  }
  return kickoffs.get(id) ?? null;
}

async function loadDetails() {
  const d = opened.details;
  if (!d) return;
  const id = matchIdOf(d.rowKey);
  try {
    d.data = await request('GET', `/api/match?id=${id}`);
    d.error = null;
    if (d.data.kickoffs) kickoffs.set(id, d.data.kickoffs);
  } catch (e) {
    if (!d.data) d.error = e.message; // уже показанные события разовый сбой не стирает
  }
  if (opened.details !== d) return; // пока грузили, закрыли или открыли другой матч
  renderList();
}

// ---------- панель каналов ----------
function renderPopover() {
  $('#status-pop').innerHTML = popoverHtml(state.status?.vk, state.settings?.refreshSeconds);
}

function togglePopover(show = $('#status-pop').hidden) {
  const pop = $('#status-pop');
  $('#status').setAttribute('aria-expanded', String(show));
  if (!show) { pop.hidden = true; return; }
  renderPopover();
  pop.hidden = false;
  const r = $('#status').getBoundingClientRect();
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.left = `${Math.max(12, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 12))}px`;
}

// ---------- плеер ----------
function findMatch(id) {
  for (const lg of state.day?.leagues || []) for (const m of lg.matches) if (m.id === id) return m;
  return null;
}
const matchOf = (rowKey) => (rowKey ? findMatch(matchIdOf(rowKey)) : null);

// url — ссылка эфира; t — с какой секунды открыть запись (первый свисток), без него — как обычно
function openPlayer(rowKey, url, t = null) {
  const m = matchOf(rowKey);
  const s = m?.streams.find((x) => x.url === url);
  const embed = s && embedUrl(s);
  if (!embed) return;
  const src = withTime(embed, t);
  const sameRow = playerEl && opened.player?.rowKey === rowKey;
  opened.play(rowKey, url, t);

  // тот же матч — переключаем канал без анимации
  if (sameRow) {
    playerEl.querySelector('iframe').src = src;
    playerEl.querySelector('.ext').href = withTime(s.url, t);
    render();
    return;
  }
  if (playerEl) playerEl.remove();

  const el = (playerEl = document.createElement('div'));
  el.className = 'player';
  el.innerHTML = `<div class="clip"><div class="inner">
    <div class="phead"><b>${esc(matchTitle(m))}</b>
      <a class="ext" href="${esc(withTime(s.url, t))}" target="_blank" rel="noopener">Открыть в VK ↗</a>
      <button type="button" class="btn popout" title="Смотреть в отдельном окне — можно открыть несколько матчей сразу">⧉ В окне</button>
      <button type="button" class="icon-btn close" title="Закрыть (Esc)" aria-label="Закрыть плеер"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="frame"><iframe src="${esc(src)}" title="Плеер VK" allow="autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock"></iframe></div>
    ${detailsToggleHtml(rowKey, false)}
  </div></div>`;
  el.addEventListener('transitionend', (e) => {
    if (e.target === el && e.propertyName === 'grid-template-rows' && el.classList.contains('open')) centerPlayer(el);
  });
  // события и составы сразу под трансляцией; в режиме без спойлеров — только по кнопке под плеером
  if (!state.settings?.ui.hideScores && opened.details?.rowKey !== rowKey) toggleDetails(rowKey);
  render();
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
}

function closePlayer(immediate = false) {
  const el = playerEl;
  playerEl = null;
  opened.stop();
  if (el) {
    if (immediate) el.remove();
    else {
      el.dataset.key = 'closing'; // доигрывает анимацию, отрисовка его не трогает
      el.classList.remove('open');
      setTimeout(() => el.remove(), 500);
    }
  }
  render();
}

// выравниваем плеер по центру видимой области под липкой шапкой
function centerPlayer(el) {
  const head = $('.top').getBoundingClientRect().bottom;
  const r = el.getBoundingClientRect();
  const free = innerHeight - head;
  scrollTo({ top: scrollY + r.top - head - Math.max(0, (free - r.height) / 2), behavior: 'smooth' });
}

// Плеер в отдельном окне: в приложении — своё окно поверх остальных, в браузере — всплывающее.
// Окон можно открыть сколько угодно — так смотрят несколько матчей сразу.
function popOut() {
  const p = opened.player;
  const m = matchOf(p?.rowKey);
  const s = m?.streams.find((x) => x.url === p.url);
  const embed = s && embedUrl(s);
  if (!embed) return;
  const q = new URLSearchParams({ src: withTime(embed, p.t), url: withTime(s.url, p.t), title: `${matchTitle(m)} · ${s.channel}` });
  window.open(`player.html?${q}`, '_blank', 'popup,width=800,height=450');
  opened.popOut(); // в двух местах сразу один эфир не нужен
  closePlayer();
}

// Клик по уведомлению: день матча, строка матча и плеер, если трансляция уже идёт
async function openMatchFromNotification(date, id) {
  await setDate(date);
  const m = findMatch(id);
  if (!m) return;
  const rowKey = document.querySelector(`[data-key="live:${id}"]`) ? `live:${id}` : `m:${id}`;
  const live = m.streams.find((s) => s.status === 'started');
  if (live && !opened.isPlaying(rowKey, live.url)) openPlayer(rowKey, live.url);
  const row = document.querySelector(`[data-key="${rowKey}"]`);
  row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row?.classList.add('flash');
  setTimeout(() => row?.classList.remove('flash'), 1700);
}
window.mc?.onOpenMatch(({ date, id }) => openMatchFromNotification(date, id));

// ---------- настройки ----------
// Названия турниров, добавленных по номеру: спрашиваем заранее, при запуске, чтобы диалог
// открывался сразу. FotMob не ответил — будет «Турнир N», а запрос повторится при открытии.
let leagueNames = null;
function loadLeagueNames() {
  if (!leagueNames) request('GET', '/api/leagues').then((names) => { leagueNames = names; }, () => {});
}

function openSettings() {
  if (!state.settings) return;
  togglePopover(false);
  loadLeagueNames();
  openSettingsDialog($('#settings'), {
    settings: state.settings,
    leagueNames: leagueNames || {},
    save: async (patch) => {
      state.settings = await request('PUT', '/api/settings', { body: patch });
      load();
    },
  });
}

// ---------- действия ----------
function setDate(d) {
  if (d === state.date) return load();
  state.date = d;
  state.day = null;
  state.error = null;
  opened.leaveDay();
  closePlayer(true);
  renderDates();
  scrollTo({ top: 0 });
  return load();
}

function setFilter(name, value) {
  state.settings.ui.filters[name] = value;
  saveUi({ filters: state.settings.ui.filters });
  render();
}

$('#dates').addEventListener('click', (e) => {
  const b = e.target.closest('[data-date]');
  if (b) setDate(b.dataset.date);
});
for (const b of $$('[data-filter]')) b.addEventListener('click', () => {
  if (state.settings) setFilter(b.dataset.filter, !state.settings.ui.filters[b.dataset.filter]);
});
$('#spoilers').addEventListener('click', () => {
  if (!state.settings) return;
  state.settings.ui.hideScores = !state.settings.ui.hideScores;
  state.revealed.clear(); // включили заново — прячем и то, что раскрывали раньше
  saveUi({ hideScores: state.settings.ui.hideScores });
  render();
});
$('#q').addEventListener('input', (e) => { state.q = e.target.value; if (state.settings) renderList(); });
$('#refresh').addEventListener('click', () => load());
$('#open-settings').addEventListener('click', openSettings);
$('#status').addEventListener('click', (e) => { e.stopPropagation(); togglePopover(); });
$('#theme').addEventListener('click', () => {
  if (!state.settings) return;
  const order = ['system', 'light', 'dark'];
  const theme = order[(order.indexOf(state.settings.ui.theme) + 1) % order.length];
  state.settings.ui.theme = theme;
  applyTheme();
  saveUi({ theme });
});

$('#list').addEventListener('click', (e) => {
  const star = e.target.closest('[data-fav]');
  if (star) { toggleFavorite(Number(star.dataset.fav), star.dataset.name); return; }
  if (e.target.closest('[data-remind]')) {
    const m = matchOf(e.target.closest('[data-key]').dataset.key);
    if (m) toggleRemind(m);
    return;
  }
  const reveal = e.target.closest('[data-reveal]');
  if (reveal) {
    state.revealed.add(Number(reveal.dataset.reveal));
    renderList();
    return;
  }
  if (e.target.closest('.player .close')) { closePlayer(); return; }
  if (e.target.closest('.player .popout')) { popOut(); return; }
  // клик по названиям команд или кнопка «События и составы» (под плеером или у матча в окне)
  const more = e.target.closest('[data-details]');
  if (more || e.target.closest('.match .teams')) {
    toggleDetails(more ? more.dataset.details : e.target.closest('[data-key]').dataset.key);
    return;
  }
  const a = e.target.closest('[data-play]');
  // Ctrl/Shift/средняя кнопка — как обычная ссылка, в браузере
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  const rowKey = a.closest('[data-key]').dataset.key;
  const m = matchOf(rowKey);
  const s = m?.streams.find((x) => x.url === a.getAttribute('href'));
  if (!s || !embedUrl(s)) return; // встроить нельзя — откроется ссылкой в браузере
  e.preventDefault();
  // повторный клик по открытому эфиру закрывает плеер
  if (opened.isPlaying(rowKey, s.url)) { closePlayer(); return; }
  if (s.status !== 'finished') { openPlayer(rowKey, s.url); return; }
  // запись — на первом свистке, запуск по кнопке плеера; эфир, начатый после свистка, — с начала
  kickoffsOf(m.id).then((k) => openPlayer(rowKey, s.url, recordSecond(s, k?.h1)));
});

// «Запасные» раскрываются у обеих команд сразу и остаются раскрытыми при обновлении событий.
// Событие toggle не всплывает — ловим на погружении.
$('#list').addEventListener('toggle', (e) => {
  if (!e.target.matches?.('.lu details')) return;
  const open = e.target.open;
  if (opened.details) opened.details.subsOpen = open;
  for (const d of e.target.closest('.lineups').querySelectorAll('details')) if (d.open !== open) d.open = open;
}, true);

document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-action]')?.dataset.action;
  if (act === 'reset-filters') {
    state.q = '';
    $('#q').value = '';
    for (const f of Object.keys(state.settings.ui.filters)) state.settings.ui.filters[f] = false;
    saveUi({ filters: state.settings.ui.filters });
    render();
  } else if (act === 'status') {
    e.stopPropagation();
    togglePopover(true);
  } else if (act === 'refresh-vk') {
    e.target.disabled = true;
    request('POST', '/api/refresh').finally(() => setTimeout(load, 1500));
  } else if (act === 'update-download') {
    window.mc?.downloadUpdate();
  } else if (act === 'update-install') {
    e.target.disabled = true;
    window.mc?.installUpdate();
  } else if (act === 'update-dismiss') {
    if (state.update) state.updateDismissed = updateKey(state.update);
    renderNotices();
  }
  if (!$('#status-pop').hidden && !e.target.closest('#status-pop, #status')) togglePopover(false);
});

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select, dialog')) {
    if (e.key === 'Escape' && e.target.id === 'q' && state.q) { e.target.value = ''; state.q = ''; renderList(); }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') {
    if (!$('#status-pop').hidden) togglePopover(false);
    else if (opened.player) closePlayer();
  } else if (e.key === '/') {
    e.preventDefault();
    $('#q').focus();
  } else if (e.code === 'KeyR') {
    load();
  } else if (e.key === ',') {
    openSettings();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const next = addDays(state.date, e.key === 'ArrowLeft' ? -1 : 1);
    if (inDateRange(state.today, next)) setDate(next); // за краем полосы она сдвинется на день
  }
});

// Смена дня: если смотрели «сегодня», в полночь переходим на новый день сами
setInterval(() => {
  const today = ymd(new Date());
  if (today === state.today) return;
  if (opened.player) return; // матч, который смотрят через полночь, не прерываем — перейдём, когда плеер закроют
  const wasToday = state.date === state.today;
  state.today = today;
  if (wasToday) setDate(today);
  else renderDates();
}, 30e3);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearTimeout(timer);
  else load();
});
addEventListener('resize', () => { if (!$('#status-pop').hidden) togglePopover(true); });

// ---------- запуск ----------
async function boot() {
  renderDates();
  render();
  try {
    state.settings = await request('GET', '/api/settings');
  } catch (e) {
    state.error = e.message;
    render();
    setTimeout(boot, 3000);
    return;
  }
  state.error = null;
  applyTheme();
  load();
  loadLeagueNames();
  // обновления приложения: состояние на момент загрузки страницы и дальнейшие изменения
  const onUpdate = (u) => {
    state.update = u?.state && u.state !== 'none' ? u : null;
    if (u?.manual) state.updateDismissed = null; // проверили из меню — полосу показываем снова
    renderNotices();
  };
  window.mc?.getUpdate().then(onUpdate);
  window.mc?.onUpdate(onUpdate);
}
boot();
