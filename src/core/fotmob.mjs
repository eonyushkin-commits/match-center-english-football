// Расписание FotMob. Одинаковые запросы, пришедшие одновременно, объединяются; при сбое сети
// отдаются последние полученные данные с пометкой stale, а не ошибка.
const MAX_ENTRIES = 40;

export function createFotmob(fetchImpl = fetch) {
  const cache = new Map(); // key → { t, v } | { pending }

  async function getJson(url) {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(15e3) });
    if (!r.ok) throw new Error(`FotMob ответил ${r.status}`);
    return r.json();
  }

  function cached(key, ttlMs, load) {
    const hit = cache.get(key);
    if (hit?.pending) return hit.pending;
    if (hit && Date.now() - hit.t < ttlMs) return Promise.resolve(hit.v);
    const pending = load().then(
      (v) => {
        cache.delete(key); // переставляем в конец — самые старые записи удаляются первыми
        cache.set(key, { t: Date.now(), v });
        while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
        return v;
      },
      (e) => {
        if (hit) {
          cache.set(key, hit);
          return { ...hit.v, stale: e.message };
        }
        cache.delete(key);
        throw e;
      },
    );
    cache.set(key, { ...hit, pending });
    return pending;
  }

  return {
    names: () => cached('ru', 24 * 3600e3, () => getJson('https://www.fotmob.com/api/translationmapping?locale=ru')),
    day: (date, tz) => cached(`day:${date}:${tz}`, 45e3, () =>
      getJson(`https://www.fotmob.com/api/data/matches?date=${date}&timezone=${encodeURIComponent(tz)}`)),
    // все турниры с русскими названиями — для турниров, добавленных в настройках по номеру
    leagues: () => cached('leagues', 24 * 3600e3, () => getJson('https://www.fotmob.com/api/data/allLeagues?locale=ru')),
    // подробности матча кэширует и задерживает details.mjs
    match: (id) => getJson(`https://www.fotmob.com/api/data/matchDetails?matchId=${encodeURIComponent(id)}`),
  };
}
