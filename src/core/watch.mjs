// Уведомления о матчах избранных команд и отмеченных колокольчиком матчах:
//   soon    — за 15 минут до начала (если приложение открыли позже — сразу, с точным временем);
//   kickoff — в начале матча (в первые 10 минут, если приложение открыли позже).
// Проверка назначается на ближайший из этих моментов, но не реже раза в idleMs: расписание
// могут поменять.
import { buildDay, localYmd } from './day.mjs';

const SOON = 15 * 60e3;
const LATE = 10 * 60e3;

export function watchFavorites({ poller, settings, fotmob, onEvent, now = () => Date.now(), idleMs = 10 * 60e3, log = console }) {
  const seen = new Set();
  let checking = null;
  let timer = null;
  let stopped = false;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // возвращает время ближайшего момента, к которому нужна следующая проверка
  async function check() {
    const s = settings.get();
    let next = Infinity;
    if (!s.notifications || (!s.favorites.length && !s.favoriteMatches.length)) return next;
    const t = now();
    // матч после полуночи лежит в расписании завтрашнего дня; смотрим вперёд до следующей проверки
    const dates = new Set([localYmd(new Date(t)), localYmd(new Date(t + SOON + idleMs))]);
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
          for (const at of [kickoff - SOON, kickoff]) if (at > t) next = Math.min(next, at);
        }
      }
    }
    return next;
  }

  function schedule(next) {
    clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(run, Math.min(Math.max(next - now(), 1000), idleMs));
    timer.unref?.();
  }

  // одновременно — одна проверка; после неё назначается следующая
  const run = () => {
    checking ??= check()
      .catch((e) => { log.warn?.(`Уведомления: ${e.message}`); return now() + 60e3; }) // сбой — через минуту ещё раз
      .then((next) => { schedule(next); return next; })
      .finally(() => { checking = null; });
    return checking;
  };

  // первая проверка — когда прочитаны каналы (для «смотреть: канал»), но не позже чем через полминуты
  poller.once('update', run);
  schedule(now() + 30e3);
  // отметили матч или команду — проверяем сразу: до начала может оставаться меньше 15 минут
  const wanted = (s) => JSON.stringify([s.notifications, s.favorites, s.favoriteMatches]);
  settings.on('change', (s, prev) => {
    if (wanted(s) !== wanted(prev)) (checking || Promise.resolve()).then(run);
  });

  return {
    check: run,
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
