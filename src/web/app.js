'use strict';
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const parseYmd = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const hhmm = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const isLive = (m) => m.started && !m.finished && !m.cancelled;
  const DAYS = { from: -3, to: 4 }; // полоса дат: три дня назад — четыре вперёд
  const STATUS = { started: 'LIVE', upcoming: 'скоро', finished: 'запись', failed: 'сбой' };
  const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }); // 18,5 тыс.
  const full = new Intl.NumberFormat('ru-RU'); // 18 557

  // «· 1,2 тыс. смотрят» — только у идущего эфира; у записей счётчик не показываем
  function audience(s) {
    if (s.status === 'started' && s.spectators > 0)
      return { text: ` · ${compact.format(s.spectators)} смотрят`, title: `Смотрят сейчас: ${full.format(s.spectators)}` };
    return null;
  }

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
  const scoresHidden = (m) => !!state.settings?.ui.hideScores && !state.revealed.has(m.id) && (m.started || m.finished);

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
    const ids = favoriteIds();
    for (const lg of state.day?.leagues || [])
      for (const m of lg.matches) m.favorite = ids.has(m.home.id) || ids.has(m.away.id);
    render();
    request('PUT', '/api/settings', { body: { favorites: state.settings.favorites } }).then(() => { state.saveError = null; }, (e) => {
      state.saveError = e.message;
      renderNotices();
    });
  }

  // ---------- точечное обновление DOM ----------
  // Узлы с тем же ключом остаются на месте, меняется только их содержимое. Поэтому iframe плеера
  // никогда не переносится по DOM (перенос перезапускает видео), что бы ни пришло с сервера.
  const setHtml = (node, html) => { if (node._html !== html) { node.innerHTML = html; node._html = html; } };
  function reconcile(parent, items) {
    const want = new Set(items.map((i) => i.key));
    for (const n of [...parent.children]) if (!want.has(n.dataset.key) && n.dataset.key !== 'closing') n.remove();
    const have = new Map([...parent.children].map((n) => [n.dataset.key, n]));
    const skipClosing = (n) => { while (n && n.dataset.key === 'closing') n = n.nextElementSibling; return n; };
    let cur = skipClosing(parent.firstElementChild);
    for (const it of items) {
      let n = have.get(it.key);
      if (!n) {
        n = it.node || (it.create ? it.create() : document.createElement(it.tag || 'div'));
        n.dataset.key = it.key;
      }
      if (it.cls !== undefined && n.className !== it.cls) n.className = it.cls;
      if (it.html !== undefined) setHtml(n, it.html);
      if (n === cur) cur = skipClosing(cur.nextElementSibling);
      else parent.insertBefore(n, cur);
    }
  }

  // ---------- что показывать ----------
  function sections() {
    const d = state.day;
    const f = state.settings.ui.filters;
    const q = state.q.trim().toLowerCase();
    // матч с открытым плеером или подробностями не прячем никакими фильтрами
    const pinned = new Set([state.player?.rowKey, state.details?.rowKey]);
    const hit =(m, lg) => (!f.streams || m.streams.length) && (!f.live || isLive(m)) && (!f.favorites || m.favorite)
      && (!q || `${lg.name} ${lg.country}`.toLowerCase().includes(q) || `${m.home.name} ${m.away.name}`.toLowerCase().includes(q));
    const out = [];

    if (state.dayDate === state.today && !f.live) {
      const rows = [];
      for (const lg of d.leagues) for (const m of lg.matches) {
        const key = `live:${m.id}`;
        if (pinned.has(key) || (isLive(m) && m.streams.some((s) => s.status === 'started') && hit(m, lg))) rows.push({ key, m, lg, showLeague: true });
      }
      if (rows.length) out.push({ key: 'live', live: true, rows });
    }
    for (const lg of d.leagues) {
      const rows = lg.matches.filter((m) => pinned.has(`m:${m.id}`) || hit(m, lg)).map((m) => ({ key: `m:${m.id}`, m, lg }));
      if (rows.length) out.push({ key: `lg:${lg.id}`, lg, rows });
    }
    return out;
  }

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
    let cls = 'wait';
    let text = 'VK…';
    if (vk?.ready) {
      const bad = vk.channels.filter((c) => c.ok === false).length;
      cls = !vk.channels.length ? '' : !bad ? 'ok' : bad === vk.channels.length ? 'bad' : 'warn';
      text = `${vk.streamCount} эфиров · ${hhmm(vk.updatedAt)}`;
    }
    $('#status .dot').className = `dot ${cls}`;
    $('#status-text').textContent = text;
    $('#status').title = vk?.ready ? 'Каналы VK: нажмите, чтобы увидеть подробности' : 'Каналы VK читаются…';
    if (!$('#status-pop').hidden) renderPopover();
    if (state.status?.version) $('#foot').innerHTML = `Матч-центр ${esc(state.status.version)} · <kbd>←</kbd> <kbd>→</kbd> дни · <kbd>/</kbd> поиск · <kbd>R</kbd> обновить · <kbd>Esc</kbd> закрыть плеер`;
  }

  function renderNotices() {
    const out = [];
    if (state.error && state.day) out.push(['bad', `<b>Не удалось обновить расписание:</b> ${esc(state.error)}. Показаны последние данные.`]);
    if (state.day?.stale) out.push(['', '<b>FotMob сейчас недоступен</b> — показано расписание, полученное ранее.']);
    for (const w of state.status?.warnings || []) out.push(['bad', esc(w)]);
    const vk = state.status?.vk;
    if (vk?.ready && vk.channels.length && vk.channels.every((c) => c.ok === false))
      out.push(['bad', '<b>Не удалось прочитать ни один канал VK.</b> Каналы читаются только с российского адреса. <button type="button" data-action="status">Подробнее</button>']);
    if (state.saveError) out.push(['bad', `<b>Не удалось сохранить настройки:</b> ${esc(state.saveError)}`]);
    const u = state.update;
    const update = u && !(u.state === 'available' && state.updateDismissed === u.version) && updateHtml(u);
    if (update) out.unshift(['update', update]);
    $('#notices').innerHTML = out.map(([cls, html]) => `<div class="notice ${cls}">${html}</div>`).join('');
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
      reconcile(list, [{ key: 'empty', cls: 'empty', html: emptyHtml() }]);
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
    const nodes = new Map([...list.children].map((n) => [n.dataset.key, n]));
    for (const s of secs) {
      const node = nodes.get(s.key);
      setHtml(node.firstElementChild, s.live
        ? `Сейчас в эфире<span class="count">${s.rows.length}</span>`
        : `<img loading="lazy" src="https://images.fotmob.com/image_resources/logo/leaguelogo/${s.lg.id}.png" alt=""> ${esc(s.lg.name)} <small>${esc(s.lg.country)}</small><span class="count">${s.rows.length}</span>`);
      const items = [];
      for (const r of s.rows) {
        items.push({ key: r.key, cls: `match${r.m.favorite ? ' fav' : ''}`, html: rowHtml(r) });
        if (state.player?.rowKey === r.key && playerEl) items.push({ key: 'player', node: playerEl });
        if (state.details?.rowKey === r.key) items.push({ key: 'details', cls: 'details', html: detailsHtml(r.m) });
      }
      reconcile(node.lastElementChild, items);
    }
  }

  function emptyHtml() {
    const f = state.settings.ui.filters;
    if (state.q || f.streams || f.live || f.favorites)
      return '<b>Нет матчей по выбранным фильтрам</b><button type="button" class="btn" data-action="reset-filters">Сбросить фильтры</button>';
    return '<b>В этот день матчей нет</b>Турниры выбираются в настройках.';
  }

  function rowHtml({ key, m, lg, showLeague }) {
    const live = isLive(m);
    // статус — как его отдаёт FotMob (FT, HT, AET, Pen…)
    const when = esc(m.cancelled ? (m.reason || 'Canc.') : live ? (m.liveTime || 'LIVE') : m.finished ? (m.reason || 'FT') : hhmm(m.utcTime));
    const showScore = m.started || m.finished;
    const hidden = scoresHidden(m);
    const favs = favoriteIds();
    const team = (t, other) => {
      const fav = favs.has(t.id);
      const score = hidden
        ? `<button type="button" class="score masked" data-reveal="${m.id}" title="Показать счёт">?</button>`
        : `<span class="score">${esc(t.score)}</span>`;
      return `<div class="team${!hidden && m.finished && t.score > other.score ? ' win' : ''}">
        <img loading="lazy" src="https://images.fotmob.com/image_resources/logo/teamlogo/${t.id}_small.png" alt="">
        <span class="name">${esc(t.name)}</span>
        <button type="button" class="star${fav ? ' on' : ''}" data-fav="${t.id}" data-name="${esc(t.name)}" aria-pressed="${fav}"
          title="${fav ? 'Убрать из избранного' : 'В избранное — уведомлю о начале трансляции'}">★</button>
        ${showScore ? score : ''}</div>`;
    };

    // у канала бывает несколько эфиров на матч (перезапуск) — нумеруем: «Sportcast», «Sportcast 2»
    const seen = {};
    const label = (s) => ((seen[s.channel] = (seen[s.channel] || 0) + 1) > 1 ? `${s.channel} ${seen[s.channel]}` : s.channel);
    const p = state.player;
    let chips = m.streams.map((s, i) => {
      const aud = audience(s);
      return `<a class="stream ${s.status}${p?.rowKey === key && p.i === i ? ' active' : ''}"
        href="${esc(s.url)}" target="_blank" rel="noopener" title="${esc(aud ? `${s.title}\n${aud.title}` : s.title)}" data-play="${i}">
        <span class="tag">${STATUS[s.status] || ''}</span>${esc(label(s))}${aud ? `<span class="aud">${esc(aud.text)}</span>` : ''}</a>`;
    }).join('');
    if (!chips && !m.finished && !m.cancelled) {
      const q = encodeURIComponent(`${m.home.name} ${m.away.name}`);
      chips = `<a class="stream search" href="https://vkvideo.ru/search?q=${q}" target="_blank" rel="noopener">Искать в VK</a>`;
    }
    return `<div class="when${live ? ' live' : ''}">${when}</div>
      <div class="teams">${team(m.home, m.away)}${team(m.away, m.home)}</div>
      <div class="side">${showLeague ? `<span class="lg-tag">${esc(lg.name)}</span>` : ''}
        <a class="fm" href="https://www.fotmob.com/match/${m.id}" target="_blank" rel="noopener" title="Открыть в FotMob">FotMob ↗</a>
        <button type="button" class="more${state.details?.rowKey === key ? ' on' : ''}" data-details aria-expanded="${state.details?.rowKey === key}">Подробнее</button></div>
      ${chips ? `<div class="streams">${chips}</div>` : ''}`;
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

  const CARD = { yellow: '🟨', red: '🟥', yellowred: '🟨🟥' };

  function eventHtml(e) {
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
      <div class="mid"><span class="min">${esc(e.minute)}’</span><span class="icon">${icon}</span>${e.kind === 'goal' ? `<b class="evscore">${esc(e.score.join(':'))}</b>` : ''}</div>
      <div class="a">${e.side === 'away' ? body : ''}</div></li>`;
  }

  function lineupsHtml(l, m) {
    const players = (list) => `<ol>${list.map((p) => `<li><span class="num">${esc(p.number)}</span>${esc(p.name)}</li>`).join('')}</ol>`;
    const team = (t, name) => `<div class="lu"><div class="luhead"><b>${esc(name)}</b>${t.formation ? `<span>${esc(t.formation)}</span>` : ''}</div>
      ${players(t.starters)}${t.coach ? `<div class="coach">Тренер: ${esc(t.coach)}</div>` : ''}
      ${t.subs.length ? `<details${state.details?.subsOpen ? ' open' : ''}><summary>Запасные · ${t.subs.length}</summary>${players(t.subs)}</details>` : ''}</div>`;
    return `<div class="lineups">${team(l.home, m.home.name)}${team(l.away, m.away.name)}</div>`;
  }

  function detailsHtml(m) {
    const d = state.details;
    if (d.error) return `<div class="dnote">Не удалось загрузить: ${esc(d.error)}</div>`;
    if (!d.data) return '<div class="dnote">Загрузка…</div>';
    const x = d.data;
    let events;
    if (scoresHidden(m)) events = `<div class="dnote">События скрыты, чтобы не выдать счёт. <button type="button" class="btn" data-reveal="${m.id}">Показать счёт и события</button></div>`;
    else if (x.pending) events = `<div class="dnote">События появятся через ${x.readyIn} с — они идут с задержкой в минуту, чтобы не обгонять трансляцию.</div>`;
    else if (!x.events.length) events = `<div class="dnote">${x.state === 'upcoming' ? 'Матч ещё не начался.' : 'Событий пока нет.'}</div>`;
    else events = `<ol class="timeline">${x.events.map(eventHtml).join('')}</ol>${x.delayed ? '<div class="dnote small">С задержкой в минуту, чтобы не обгонять трансляцию.</div>' : ''}`;
    const lineups = x.lineups ? lineupsHtml(x.lineups, m) : x.state === 'upcoming' ? '<div class="dnote">Составы появятся примерно за час до начала.</div>' : '';
    return `<div class="dinner"><h4>События</h4>${events}${lineups ? `<h4>Составы</h4>${lineups}` : ''}</div>`;
  }

  // ---------- обновление приложения: «Скачать» → «Установить» ----------
  function updateHtml(u) {
    const v = esc(u.version);
    const notes = u.notes ? ` <a href="${esc(u.notes)}" target="_blank" rel="noopener">Что нового ↗</a>` : '';
    if (u.state === 'available') return `<span><b>Доступна версия ${v}.</b>${notes}</span>
      <span class="actions"><button type="button" class="btn primary" data-action="update-download">Скачать</button>
      <button type="button" class="icon-btn" data-action="update-dismiss" aria-label="Напомнить позже" title="Напомнить позже">✕</button></span>`;
    if (u.state === 'downloading') return `<span><b>Загружается версия ${v}…</b> ${u.percent || 0}%</span><progress max="100" value="${u.percent || 0}"></progress>`;
    if (u.state === 'ready') return `<span><b>Версия ${v} загружена.</b> Приложение перезапустится — открытая трансляция прервётся.${notes}</span>
      <span class="actions"><button type="button" class="btn primary" data-action="update-install">Установить</button></span>`;
    if (u.state === 'error') return `<span><b>Не удалось загрузить обновление:</b> ${esc(u.error)}</span>
      <span class="actions"><button type="button" class="btn" data-action="update-download">Повторить</button></span>`;
    return null;
  }

  // ---------- панель каналов ----------
  function renderPopover() {
    const vk = state.status?.vk;
    const rows = (vk?.channels || []).map((c) => {
      const cls = c.ok === null ? 'wait' : c.ok ? 'ok' : 'bad';
      const how = c.ok === null ? 'читается…' : c.ok ? (c.via === 'api' ? 'через API' : 'через страницу канала') : esc(c.error);
      const when = c.okAt ? ` · данные от ${hhmm(c.okAt)}` : '';
      return `<div class="chan"><span class="dot ${cls}"></span><b>${esc(c.label)}</b><span class="n">${c.count} эфиров</span><small>${how}${c.ok === null ? '' : when}</small></div>`;
    }).join('');
    $('#status-pop').innerHTML = `<h4>Каналы VK</h4>${rows || '<div class="empty">Каналов нет — добавьте их в настройках</div>'}
      <div class="actions"><span>Обновляются раз в ${state.settings?.refreshSeconds ?? 60} с</span>
      <button type="button" class="btn" data-action="refresh-vk">Обновить сейчас</button></div>`;
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
  // Ссылка для встраивания — ровно как в официальном коде VK: oid, id, hash, без hd/autoplay
  function embedUrl(s) {
    if (!s.embed) return null;
    try {
      const u = new URL(s.embed);
      if (u.protocol !== 'https:' || !/(^|\.)(vkvideo\.ru|vk\.com|vk\.ru)$/.test(u.hostname)) return null;
      u.searchParams.delete('__ref');
      return u.href;
    } catch {
      return null;
    }
  }

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
      <div class="frame"><iframe src="${esc(src)}" title="Плеер VK" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe></div>
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
  function parseChannel(text) {
    const s = text.trim().replace(/^https?:\/\//i, '').replace(/^(www\.)?(vkvideo\.ru|vk\.com|vk\.ru)\//i, '')
      .replace(/^video\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
    return /^[\w.-]{2,64}$/.test(s) ? s : null;
  }

  function openSettings() {
    const s = state.settings;
    if (!s) return;
    togglePopover(false);
    const draft = s.channels.map((c) => ({ ...c }));
    const extra = s.leagues.filter((id) => !s.knownLeagues.some((k) => k.id === id));
    const leagues = [...s.knownLeagues, ...extra.map((id) => ({ id, name: `Турнир ${id}` }))];
    const refreshOptions = [...new Set([30, 60, 120, 300, s.refreshSeconds])].sort((a, b) => a - b);
    const aliasText = Object.entries(s.userAliases).map(([t, n]) => `${t} = ${n.join(', ')}`).join('\n');
    const dlg = $('#settings');
    dlg.innerHTML = `<form class="sheet" novalidate>
      <header><h2>Настройки</h2><button type="button" class="icon-btn" data-close aria-label="Закрыть"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></header>
      <div class="body">
        <section><h3>Каналы VK</h3><ul class="chan-list" id="chan-list"></ul>
          <div class="add-row"><input class="field" id="chan-url" placeholder="Ссылка на канал: vkvideo.ru/@pl_forever">
            <input class="field" id="chan-label" placeholder="Название (необязательно)"><button type="button" class="btn" id="chan-add">Добавить</button></div>
          <p class="hint" id="chan-hint">Встроенные каналы можно выключить, добавленные — удалить.</p></section>
        <section><h3>Турниры</h3><div class="checks" id="leagues">${leagues.map((l) => `<label class="check">
            <input type="checkbox" name="league" value="${l.id}" ${s.leagues.includes(l.id) ? 'checked' : ''}> ${esc(l.name)}</label>`).join('')}</div>
          <div class="add-row"><input class="field" id="league-id" inputmode="numeric" placeholder="Другой турнир: число из ссылки fotmob.com/leagues/…">
            <button type="button" class="btn" id="league-add">Добавить</button></div></section>
        <section><h3>Обновление и уведомления</h3>
          <label class="row">Перечитывать каналы VK каждые <select class="field" id="refresh">${refreshOptions.map((v) =>
            `<option value="${v}" ${v === s.refreshSeconds ? 'selected' : ''}>${v < 60 ? `${v} с` : `${+(v / 60).toFixed(1)} мин`}</option>`).join('')}</select></label>
          <label class="row"><input type="checkbox" class="switch" id="notify" ${s.notifications ? 'checked' : ''}> Уведомлять о матчах избранных команд</label>
          <p class="hint">За 15 минут до начала, в начале матча и когда канал запускает трансляцию.
            Избранные: ${s.favorites.length ? s.favorites.map((f) => esc(f.name)).join(', ') : 'пока нет — нажмите ★ рядом с командой'}.${window.mc ? '' : ' Уведомления работают в приложении для Windows.'}</p>
          ${window.mc ? `<label class="row"><input type="checkbox" class="switch" id="tray" ${s.tray ? 'checked' : ''}> Сворачивать в трей при закрытии окна</label>
          <p class="hint">Так уведомления приходят и при закрытом окне. Выйти — правой кнопкой по значку в трее.</p>
          <label class="row"><input type="checkbox" class="switch" id="autostart" ${s.autostart ? 'checked' : ''}> Запускать вместе с Windows</label>
          <p class="hint">С включённым треем приложение стартует свёрнутым.</p>` : ''}</section>
        <section><h3>Написание команд</h3>
          <textarea class="field" id="aliases" rows="4" placeholder="Манчестер Юнайтед = МЮ, Ман Юнайтед">${esc(aliasText)}</textarea>
          <p class="hint">Если канал пишет команду не так, как FotMob: по строке на команду, слева — название из расписания.</p></section>
      </div>
      <footer><span class="err" id="save-err" role="alert"></span><button type="button" class="btn" data-close>Отмена</button><button type="submit" class="btn primary">Сохранить</button></footer>
    </form>`;

    const renderChannels = () => {
      $('#chan-list', dlg).innerHTML = draft.map((c, i) => `<li class="${c.enabled ? '' : 'off'}" data-i="${i}">
        <input type="checkbox" class="switch" data-toggle ${c.enabled ? 'checked' : ''} aria-label="Читать канал">
        <input class="field" data-label value="${esc(c.label)}" aria-label="Название канала">
        <a href="https://vkvideo.ru/@${esc(c.screenName)}/lives" target="_blank" rel="noopener">@${esc(c.screenName)}</a>
        ${c.builtIn ? '' : '<button type="button" class="remove" data-remove aria-label="Удалить канал">✕</button>'}</li>`).join('');
    };
    renderChannels();

    const list = $('#chan-list', dlg);
    list.addEventListener('input', (e) => {
      const li = e.target.closest('li');
      if (e.target.matches('[data-label]')) draft[li.dataset.i].label = e.target.value;
    });
    list.addEventListener('change', (e) => {
      if (!e.target.matches('[data-toggle]')) return;
      const li = e.target.closest('li');
      draft[li.dataset.i].enabled = e.target.checked;
      li.classList.toggle('off', !e.target.checked);
    });
    list.addEventListener('click', (e) => {
      if (!e.target.closest('[data-remove]')) return;
      draft.splice(Number(e.target.closest('li').dataset.i), 1);
      renderChannels();
    });

    const hint = $('#chan-hint', dlg);
    const addChannel = () => {
      const screenName = parseChannel($('#chan-url', dlg).value);
      if (!screenName) { hint.textContent = 'Не похоже на ссылку канала VK Видео: нужно что-то вроде vkvideo.ru/@pl_forever'; return; }
      if (draft.some((c) => c.screenName === screenName)) { hint.textContent = `Канал @${screenName} уже есть в списке`; return; }
      draft.push({ screenName, label: $('#chan-label', dlg).value.trim() || screenName, enabled: true, builtIn: false });
      $('#chan-url', dlg).value = '';
      $('#chan-label', dlg).value = '';
      hint.textContent = `Канал @${screenName} добавлен — сохраните настройки.`;
      renderChannels();
    };
    $('#chan-add', dlg).addEventListener('click', addChannel);
    $('#chan-url', dlg).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addChannel(); } });

    $('#league-add', dlg).addEventListener('click', () => {
      const id = Number(($('#league-id', dlg).value.match(/\d+/) || [])[0]);
      if (!id) return;
      if (!$(`input[name="league"][value="${id}"]`, dlg))
        $('#leagues', dlg).insertAdjacentHTML('beforeend', `<label class="check"><input type="checkbox" name="league" value="${id}" checked> Турнир ${id}</label>`);
      else $(`input[name="league"][value="${id}"]`, dlg).checked = true;
      $('#league-id', dlg).value = '';
    });

    dlg.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) dlg.close(); });
    $('form', dlg).addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#save-err', dlg);
      const userAliases = {};
      for (const line of $('#aliases', dlg).value.split('\n').map((l) => l.trim()).filter(Boolean)) {
        const [team, names] = line.split('=');
        if (!team?.trim() || !names?.trim()) { err.textContent = `Не понял строку «${line}»: нужно «Команда = вариант, вариант»`; return; }
        userAliases[team.trim()] = names.split(',').map((n) => n.trim()).filter(Boolean);
      }
      const submit = $('button[type="submit"]', dlg);
      submit.disabled = true;
      try {
        state.settings = await request('PUT', '/api/settings', {
          body: {
            channels: draft.map(({ screenName, label, enabled }) => ({ screenName, label, enabled })),
            leagues: $$('input[name="league"]:checked', dlg).map((i) => Number(i.value)),
            refreshSeconds: Number($('#refresh', dlg).value),
            notifications: $('#notify', dlg).checked,
            userAliases,
            ...(window.mc ? { tray: $('#tray', dlg).checked, autostart: $('#autostart', dlg).checked } : {}),
          },
        });
        dlg.close();
        load();
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        submit.disabled = false;
      }
    });
    dlg.showModal();
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
})();
