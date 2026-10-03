// Лента для страницы. Страница не опрашивает сервер: она подписывается на день (и на раскрытый
// матч), а ядро само присылает расписание, состояние каналов и события матча — сразу и потом
// каждый раз, когда они меняются. Счёт и события у FotMob приходится спрашивать по часам,
// эфиры и настройки сообщают о себе сами.
import { buildDay } from './day.mjs';

// dayMs — как часто спрашиваем счёт: реже, чем живёт кэш расписания (45 с), иначе круг впустую
export function createFeed({ settings, poller, fotmob, details, version, dayMs = 60e3, detailsMs = 30e3, retryMs = 15e3 }) {
  const stops = new Set();

  // send(event, json): status | day | day-error | details | details-error. Возвращает отписку.
  function subscribe({ date, tz, matchId }, send) {
    // канал (status, day, details) → что отправили последним: то же самое повторно не шлём.
    // Успех и ошибка — два события одного канала, поэтому успех после сбоя уходит заново.
    const sent = {};
    const timers = new Set();
    let stopped = false;

    const push = (channel, event, data) => {
      if (stopped) return;
      const body = JSON.stringify(data);
      if (sent[channel] === event + body) return;
      sent[channel] = event + body;
      send(event, body);
    };
    const report = async (channel, load) => {
      try {
        push(channel, channel, await load());
        return true;
      } catch (e) {
        push(channel, `${channel}-error`, { message: e.message });
        return false;
      }
    };

    const status = () => {
      const { streams, ...vk } = poller.snapshot();
      push('status', 'status', { version, vk: { ...vk, streamCount: streams.length }, warnings: settings.warnings });
    };
    const day = () => {
      status();
      return report('day', async () => {
        const [fm, ru] = await Promise.all([fotmob.day(date, tz), fotmob.names()]);
        return buildDay({ fm, ru, settings: settings.get(), snapshot: poller.snapshot() });
      });
    };
    const match = () => report('details', () => details(matchId));

    // сразу и дальше по часам; после сбоя — повтор через retryMs
    async function every(ms, run) {
      const ok = await run();
      if (stopped) return;
      const timer = setTimeout(() => {
        timers.delete(timer);
        every(ms, run);
      }, ok ? ms : retryMs);
      timers.add(timer);
    }
    every(dayMs, day);
    if (matchId) every(detailsMs, match);
    // прочитаны каналы или сохранены настройки — расписание сразу, не дожидаясь круга
    poller.on('update', day);
    settings.on('change', day);

    const stop = () => {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      poller.off('update', day);
      settings.off('change', day);
      stops.delete(stop);
    };
    stops.add(stop);
    return stop;
  }

  return {
    subscribe,
    close() {
      for (const stop of [...stops]) stop();
    },
  };
}
