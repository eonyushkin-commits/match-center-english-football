// Лента для страницы. Страница не опрашивает сервер: она подписывается на день (и на раскрытый
// матч), а ядро само присылает расписание, состояние каналов и события матча — сразу и потом
// каждый раз, когда они меняются. Счёт у FotMob приходится спрашивать по часам, эфиры и
// настройки сообщают о себе сами.
import { buildDay } from './day.mjs';

export function createFeed({ settings, poller, fotmob, details, version, intervalMs = 30e3, retryMs = 15e3 }) {
  const stops = new Set();

  // send(event, json): status | day | day-error | details | details-error. Возвращает отписку.
  function subscribe({ date, tz, matchId = null }, send) {
    const sent = {}; // событие → что отправили последним: то же самое повторно не шлём
    let timer = null;
    let stopped = false;

    const push = (event, data) => {
      const body = JSON.stringify(data);
      if (stopped || sent[event] === body) return;
      sent[event] = body;
      send(event, body);
    };
    // успех после сбоя шлём заново, даже если данные прежние: он снимает ошибку на странице
    const report = async (event, load) => {
      try {
        const data = await load();
        delete sent[`${event}-error`];
        push(event, data);
        return true;
      } catch (e) {
        delete sent[event];
        push(`${event}-error`, { message: e.message });
        return false;
      }
    };

    const status = () => {
      const { streams, ...vk } = poller.snapshot();
      push('status', { version, vk: { ...vk, streamCount: streams.length }, warnings: settings.warnings });
    };
    const day = () => report('day', async () => {
      const [fm, ru] = await Promise.all([fotmob.day(date, tz), fotmob.names()]);
      return buildDay({ fm, ru, settings: settings.get(), snapshot: poller.snapshot() });
    });
    const match = () => matchId && report('details', () => details(matchId));

    async function tick() {
      clearTimeout(timer);
      status();
      const [ok] = await Promise.all([day(), match()]);
      if (!stopped) timer = setTimeout(tick, ok ? intervalMs : retryMs);
    }
    // прочитаны каналы или сохранены настройки — сразу, не дожидаясь круга
    const changed = () => {
      status();
      day();
    };
    poller.on('update', changed);
    settings.on('change', changed);
    tick();

    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      poller.off('update', changed);
      settings.off('change', changed);
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
