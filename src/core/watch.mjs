// Следит за трансляциями матчей избранных команд и сообщает, когда эфир начался.
// Эфиры, которые уже шли при запуске, считаются известными — уведомлений пачкой не будет.
import { buildDay, localYmd } from './day.mjs';

export function watchFavorites({ poller, settings, fotmob, onStart, log = console }) {
  const seen = new Set();
  let seeded = false;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  poller.on('update', async (snapshot) => {
    const s = settings.get();
    if (!s.favorites.length) {
      seeded = true;
      return;
    }
    const date = localYmd();
    try {
      const [fm, ru] = await Promise.all([fotmob.day(date, tz), fotmob.names()]);
      const day = buildDay({ fm, ru, settings: s, snapshot });
      for (const lg of day.leagues) {
        for (const m of lg.matches) {
          if (!m.favorite) continue;
          for (const stream of m.streams) {
            if (stream.status !== 'started' || seen.has(stream.url)) continue;
            seen.add(stream.url);
            if (seeded && s.notifications) onStart({ date, match: m, stream });
          }
        }
      }
      seeded = true;
    } catch (e) {
      log.warn?.(`Уведомления: ${e.message}`);
    }
  });
}
