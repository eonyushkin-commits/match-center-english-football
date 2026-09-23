// Уведомления о матчах избранных команд и отмеченных колокольчиком матчах:
//   soon    — за 15 минут до начала (если приложение открыли позже — сразу, с точным временем);
//   kickoff — в начале матча (в первые 10 минут, если приложение открыли позже).
import { buildDay, localYmd } from './day.mjs';

const SOON = 15 * 60e3;
const LATE = 10 * 60e3;

export function watchFavorites({ poller, settings, fotmob, onEvent, now = () => Date.now(), intervalMs = 30e3, log = console }) {
  const seen = new Set();
  let checking = null;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function check() {
    const s = settings.get();
    if (!s.notifications || (!s.favorites.length && !s.favoriteMatches.length)) return;
    const t = now();
    // матч после полуночи лежит в расписании завтрашнего дня
    const dates = [localYmd(new Date(t)), localYmd(new Date(t + SOON))].filter((d, i, a) => a.indexOf(d) === i);
    const snapshot = poller.snapshot();
    const ru = await fotmob.names();
    for (const date of dates) {
      const day = buildDay({ fm: await fotmob.day(date, tz), ru, settings: s, snapshot });
      for (const lg of day.leagues) {
        for (const m of lg.matches) {
          if (!m.favorite || m.cancelled) continue;
          const emit = (kind) => {
            if (seen.has(`${kind}:${m.id}`)) return;
            seen.add(`${kind}:${m.id}`);
            onEvent({ kind, date, match: m });
          };
          const kickoff = Date.parse(m.utcTime);
          if (!m.started && kickoff > t && kickoff - t <= SOON) emit('soon');
          if (t >= kickoff && t - kickoff <= LATE && !m.finished) emit('kickoff');
        }
      }
    }
  }

  // проверка и по часам, и когда пришли свежие эфиры (для «смотреть: канал»); одновременно — одна
  const run = () => {
    checking ??= check().catch((e) => log.warn?.(`Уведомления: ${e.message}`)).finally(() => { checking = null; });
    return checking;
  };
  poller.on('update', run);
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return { check: run, stop: () => clearInterval(timer) };
}
