// Что показывать в списке: фильтры, поиск, избранное, скрытый счёт. Без DOM.
import { isLive } from './format.mjs';

// режим без спойлеров: счёт скрыт, пока его не попросят показать
export const scoresHidden = (m, { hideScores, revealed }) => !!hideScores && !revealed.has(m.id) && (m.started || m.finished);

// ★ и 🔔 прямо в данных дня — чтобы не ждать ответа сервера после клика
export function markFavorites(day, settings) {
  const teams = new Set(settings.favorites.map((f) => f.id));
  const matches = new Set(settings.favoriteMatches.map((f) => f.id));
  for (const lg of day?.leagues || [])
    for (const m of lg.matches) {
      m.remind = matches.has(m.id);
      m.favorite = teams.has(m.home.id) || teams.has(m.away.id) || m.remind;
    }
}

// Раздел со строкой rowKey получает ключ hostKey — ключ раздела, в котором эта строка уже стоит
// на странице. Так раздел с плеером не создаётся заново, как бы ни перестроились блоки (перенос
// iframe перезапускает видео). Раздел, уже занявший этот ключ, берёт взамен ключ первого.
export function keepSection(secs, rowKey, hostKey) {
  const mine = hostKey && secs.find((s) => s.rows.some((r) => r.key === rowKey));
  if (!mine || mine.key === hostKey) return secs;
  const other = secs.find((s) => s.key === hostKey);
  if (other) other.key = mine.key;
  mine.key = hostKey;
  return secs;
}

// Разделы списка: «Сейчас в эфире» (только сегодня) и турниры.
// pinned — ключи строк с открытым плеером или подробностями: их не прячет никакой фильтр.
// byTime — матчи идут по времени начала, а не турнир за турниром в порядке из настроек.
export function sections({ day, isToday, filters: f, q, pinned, byTime }) {
  q = q.trim().toLowerCase();
  const hit = (m, lg) => (!f.streams || m.streams.length) && (!f.live || isLive(m)) && (!f.favorites || m.favorite)
    && (!q || `${lg.name} ${lg.country}`.toLowerCase().includes(q) || `${m.home.name} ${m.away.name}`.toLowerCase().includes(q));
  const out = [];

  // без блока (не сегодня или фильтр «Идут сейчас») остаются только закреплённые строки
  const liveBlock = isToday && !f.live;
  const live = [];
  for (const lg of day.leagues) for (const m of lg.matches) {
    const key = `live:${m.id}`;
    if (pinned.has(key) || (liveBlock && isLive(m) && m.streams.some((s) => s.status === 'started') && hit(m, lg))) live.push({ key, m, lg, showLeague: true });
  }
  if (live.length) out.push({ key: 'live', live: true, rows: live });
  const leagues = [];
  for (const lg of day.leagues) {
    const rows = lg.matches.filter((m) => pinned.has(`m:${m.id}`) || hit(m, lg)).map((m) => ({ key: `m:${m.id}`, m, lg }));
    if (rows.length) leagues.push({ key: `lg:${lg.id}`, lg, rows });
  }
  if (!byTime) return [...out, ...leagues];

  // Матчи идут по времени начала; начинающиеся одновременно стоят блоком своего турнира,
  // блоки одного времени — в порядке из настроек. Соседние блоки одного турнира — один раздел.
  const slots = leagues.flatMap((s, order) => s.rows.map((r) => ({ r, lg: s.lg, order, at: Date.parse(r.m.utcTime) })));
  slots.sort((a, b) => a.at - b.at || a.order - b.order);
  for (const { r, lg } of slots) {
    const last = out.at(-1);
    if (last?.lg === lg) last.rows.push(r);
    else out.push({ key: `lg:${lg.id}:${r.m.id}`, lg, rows: [r] }); // турнир может встретиться в списке не раз
  }
  return out;
}
