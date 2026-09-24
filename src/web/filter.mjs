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

// Разделы списка: «Сейчас в эфире» (только сегодня) и турниры.
// pinned — ключи строк с открытым плеером или подробностями: их не прячет никакой фильтр.
export function sections({ day, isToday, filters: f, q, pinned }) {
  q = q.trim().toLowerCase();
  const hit = (m, lg) => (!f.streams || m.streams.length) && (!f.live || isLive(m)) && (!f.favorites || m.favorite)
    && (!q || `${lg.name} ${lg.country}`.toLowerCase().includes(q) || `${m.home.name} ${m.away.name}`.toLowerCase().includes(q));
  const out = [];

  if (isToday && !f.live) {
    const rows = [];
    for (const lg of day.leagues) for (const m of lg.matches) {
      const key = `live:${m.id}`;
      if (pinned.has(key) || (isLive(m) && m.streams.some((s) => s.status === 'started') && hit(m, lg))) rows.push({ key, m, lg, showLeague: true });
    }
    if (rows.length) out.push({ key: 'live', live: true, rows });
  }
  for (const lg of day.leagues) {
    const rows = lg.matches.filter((m) => pinned.has(`m:${m.id}`) || hit(m, lg)).map((m) => ({ key: `m:${m.id}`, m, lg }));
    if (rows.length) out.push({ key: `lg:${lg.id}`, lg, rows });
  }
  return out;
}
