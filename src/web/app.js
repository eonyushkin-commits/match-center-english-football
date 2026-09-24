// Главная страница: состояние, загрузка с сервера, плеер и обработчики. Разметка — в view.mjs,
// что показывать — в filter.mjs, форматирование — в format.mjs: они без DOM и покрыты тестами.
import { reconcile, setHtml } from './dom.mjs';
import { markFavorites as mark, scoresHidden, sections as buildSections } from './filter.mjs';
import { addDays, embedUrl, esc, parseYmd, ymd } from './format.mjs';
import { openSettingsDialog } from './settings-ui.mjs';
import { detailsHtml, emptyHtml, notices, popoverHtml, rowHtml, sectionHeadHtml, statusBadge } from './view.mjs';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const DAYS = { from: -3, to: 4 }; // полоса дат: три дня назад — четыре вперёд

const state = {
  settings: null, // настройки с сервера: тема, фильтры, избранное живут там, а не в браузере
  status: null,
  day: null,
  dayDate: null, // за какую дату state.day
  error: null,
  saveError: null,
  today: ymd(new Date()),
  date: ymd(new Date()),
  q: '',
  player: null, // { rowKey, i }
  details: null, // { rowKey, id, data, error, timer } — раскрытые события и составы матча
  revealed: new Set(), // матчи, у которых в режиме без спойлеров уже показали счёт
  update: null, // обновление приложения (только в приложении): { state, version, percent, notes, error }
  updateDismissed: null, // версия, о которой попросили пока не напоминать
};
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
async function load() {
  ctrl?.abort();
  const my = (ctrl = new AbortController());
  clearTimeout(timer);
  const date = state.date;
  $('#refresh').classList.add('spin');
  try {
    const [day, status] = await Promise.all([
      request('GET', `/api/day?date=${date}&tz=${encodeURIComponent(tz)}`, { signal: my.signal }),
      request('GET', '/api/status', { signal: my.signal }),
    ]);
    state.day = day;
    state.dayDate = date;
    state.status = status;
    state.error = null;
  } catch (e) {
    if (my.signal.aborted) return;
    state.error = e.message;
  }
  if (my !== ctrl) return;
  $('#refresh').classList.remove('spin');
  render();
  // пока каналы VK читаются впервые — спрашиваем чаще
  timer = setTimeout(load, !state.status?.vk.ready ? 2000 : state.error ? 15000 : 30000);
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
    request('PUT', '/api/settings', { body: { ui } }).then(() => { state.saveError = null; }, (e) => {
      state.saveError = e.message;
      renderNotices();
    });
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
    : [...list, { id: m.id, name: `${m.home.name} — ${m.away.name}`, utcTime: m.utcTime }];
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
  isToday: state.dayDate === state.today,
  filters: state.settings.ui.filters,
  q: state.q,
  // матч с открытым плеером или подробностями не прячем никакими фильтрами
  pinned: new Set([state.player?.rowKey, state.details?.rowKey]),
});

// ---------- отрисовка ----------
function render() {
  renderStatus();
  renderNotices();
  renderFilters();
  renderList();
}

function renderDates() {
  const html = [];
  for (let i = DAYS.from; i <= DAYS.to; i++) {
    const d = addDays(state.today, i);
    const dt = parseYmd(d);
    const label = i === 0 ? 'Сегодня' : i === -1 ? 'Вчера' : i === 1 ? 'Завтра' : dt.toLocaleDateString('ru-RU', { weekday: 'short' });
    const on = d === state.date;
    html.push(`<button type="button" data-date="${d}" class="${on ? 'on' : ''}" aria-pressed="${on}">${label}<small>${dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</small></button>`);
  }
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
  if (!state.settings || !state.day || state.dayDate !== state.date) {
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
  const view = { favIds: favoriteIds(), hidden: isHidden, player: state.player, detailsKey: state.details?.rowKey };
  const nodes = new Map([...list.children].map((n) => [n.dataset.key, n]));
  for (const s of secs) {
    const node = nodes.get(s.key);
    setHtml(node.firstElementChild, sectionHeadHtml(s));
    const items = [];
    for (const r of s.rows) {
      items.push({ key: r.key, cls: `match${r.m.favorite ? ' fav' : ''}`, html: rowHtml(r, view) });
      if (state.player?.rowKey === r.key && playerEl) items.push({ key: 'player', node: playerEl });
      if (state.details?.rowKey === r.key) items.push({ key: 'details', cls: 'details', html: detailsHtml(r.m, state.details, isHidden(r.m)) });
    }
    reconcile(node.lastElementChild, items);
  }
}

// ---------- события и составы ----------
function toggleDetails(rowKey) {
  clearTimeout(state.details?.timer);
  state.details = state.details?.rowKey === rowKey ? null : { rowKey, id: Number(rowKey.split(':')[1]), data: null, error: null, timer: null };
  renderList();
  if (state.details) loadDetails();
}

async function loadDetails() {
  const d = state.details;
  if (!d) return;
  clearTimeout(d.timer);
  try {
    d.data = await request('GET', `/api/match?id=${d.id}`);
    d.error = null;
  } catch (e) {
    d.error = e.message;
  }
  if (state.details !== d) return; // пока грузили, закрыли или открыли другой матч
  renderList();
  // идущий матч обновляем, пока панель открыта; «появятся через N с» — ровно к этому моменту
  if (d.data?.pending) d.timer = setTimeout(loadDetails, Math.max(5, d.data.readyIn) * 1000);
  else if (d.data?.state === 'live') d.timer = setTimeout(loadDetails, 30e3);
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

function openPlayer(rowKey, i) {
  const m = findMatch(Number(rowKey.split(':')[1]));
  const s = m?.streams[i];
  const src = s && embedUrl(s);
  if (!src) return false;

  // тот же матч — переключаем канал без анимации
  if (playerEl && state.player?.rowKey === rowKey) {
    if (state.player.i === i) closePlayer();
    else {
      state.player = { rowKey, i };
      playerEl.querySelector('iframe').src = src;
      playerEl.querySelector('.ext').href = s.url;
      render();
    }
    return true;
  }
  if (playerEl) playerEl.remove();

  state.player = { rowKey, i };
  const el = (playerEl = document.createElement('div'));
  el.className = 'player';
  el.innerHTML = `<div class="clip"><div class="inner">
    <div class="phead"><b>${esc(m.home.name)} — ${esc(m.away.name)}</b>
      <a class="ext" href="${esc(s.url)}" target="_blank" rel="noopener">Открыть в VK ↗</a>
      <button type="button" class="btn popout" title="Смотреть в отдельном окне — можно открыть несколько матчей сразу">⧉ В окне</button>
      <button type="button" class="icon-btn close" title="Закрыть (Esc)" aria-label="Закрыть плеер"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="frame"><iframe src="${esc(src)}" title="Плеер VK" allow="autoplay; encrypted-media; fullscreen; picture-in-picture"></iframe></div>
  </div></div>`;
  el.addEventListener('transitionend', (e) => {
    if (e.target === el && e.propertyName === 'grid-template-rows' && el.classList.contains('open')) centerPlayer(el);
  });
  render();
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('open')));
  return true;
}

function closePlayer(immediate = false) {
  const el = playerEl;
  playerEl = null;
  state.player = null;
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
  const m = findMatch(Number(state.player?.rowKey.split(':')[1]));
  const s = m?.streams[state.player.i];
  const src = s && embedUrl(s);
  if (!src) return;
  const q = new URLSearchParams({ src, url: s.url, title: `${m.home.name} — ${m.away.name} · ${s.channel}` });
  window.open(`player.html?${q}`, '_blank', 'popup,width=800,height=450');
  closePlayer(); // в двух местах сразу один эфир не нужен
}

// Клик по уведомлению: день матча, строка матча и плеер, если трансляция уже идёт
async function openMatchFromNotification(date, id) {
  await (date !== state.date ? setDate(date) : load());
  const m = findMatch(id);
  if (!m) return;
  const rowKey = document.querySelector(`[data-key="live:${id}"]`) ? `live:${id}` : `m:${id}`;
  const i = m.streams.findIndex((s) => s.status === 'started');
  if (i >= 0 && (state.player?.rowKey !== rowKey || state.player.i !== i)) openPlayer(rowKey, i);
  const row = document.querySelector(`[data-key="${rowKey}"]`);
  row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row?.classList.add('flash');
  setTimeout(() => row?.classList.remove('flash'), 1700);
}
window.mc?.onOpenMatch(({ date, id }) => openMatchFromNotification(date, id));

// ---------- настройки ----------
function openSettings() {
  if (!state.settings) return;
  togglePopover(false);
  openSettingsDialog($('#settings'), {
    settings: state.settings,
    isApp: !!window.mc,
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
  state.dayDate = null;
  state.error = null;
  clearTimeout(state.details?.timer);
  state.details = null;
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
    const m = findMatch(Number(e.target.closest('[data-key]').dataset.key.split(':')[1]));
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
  // «Подробнее» или клик по названиям команд — события и составы
  if (e.target.closest('[data-details], .match .teams')) {
    toggleDetails(e.target.closest('[data-key]').dataset.key);
    return;
  }
  const a = e.target.closest('[data-play]');
  // Ctrl/Shift/средняя кнопка — как обычная ссылка, в браузере
  if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  if (openPlayer(a.closest('[data-key]').dataset.key, Number(a.dataset.play))) e.preventDefault();
});

// «Запасные» раскрываются у обеих команд сразу и остаются раскрытыми при обновлении событий.
// Событие toggle не всплывает — ловим на погружении.
$('#list').addEventListener('toggle', (e) => {
  if (!e.target.matches?.('.lu details')) return;
  const open = e.target.open;
  if (state.details) state.details.subsOpen = open;
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
    state.updateDismissed = state.update?.version; // до следующего запуска приложения
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
    else if (state.player) closePlayer();
  } else if (e.key === '/') {
    e.preventDefault();
    $('#q').focus();
  } else if (e.code === 'KeyR') {
    load();
  } else if (e.key === ',') {
    openSettings();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const next = addDays(state.date, e.key === 'ArrowLeft' ? -1 : 1);
    const offset = Math.round((parseYmd(next) - parseYmd(state.today)) / 864e5);
    if (offset >= DAYS.from && offset <= DAYS.to) setDate(next);
  }
});

// Смена дня: если смотрели «сегодня», в полночь переходим на новый день сами
setInterval(() => {
  const today = ymd(new Date());
  if (today === state.today) return;
  const wasToday = state.date === state.today;
  state.today = today;
  if (wasToday) setDate(today);
  else renderDates();
}, 30e3);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
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
  // обновления приложения: состояние на момент загрузки страницы и дальнейшие изменения
  const onUpdate = (u) => {
    state.update = u?.state && u.state !== 'none' ? u : null;
    renderNotices();
  };
  window.mc?.getUpdate().then(onUpdate);
  window.mc?.onUpdate(onUpdate);
}
boot();
