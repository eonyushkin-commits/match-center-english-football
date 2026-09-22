// Всё ядро вместе: настройки, опрос каналов, FotMob, сервер и уведомления.
// Приложение Electron и `npm start` отличаются только способом запасного чтения страницы и fetch.
import { createFotmob } from './fotmob.mjs';
import { createHandler, startServer } from './server.mjs';
import { openSettings } from './settings.mjs';
import { createStreamPoller } from './streams.mjs';
import { createVkApi } from './vk-api.mjs';
import { watchFavorites } from './watch.mjs';

export async function createMatchCenter({ dataDir, fetchImpl = fetch, pageReader = null, apiEnabled = true, host, port, version }) {
  const settings = await openSettings(dataDir);
  const readers = [apiEnabled && createVkApi(fetchImpl), pageReader].filter(Boolean);
  const poller = createStreamPoller({
    channels: () => settings.get().channels.filter((c) => c.enabled),
    intervalMs: () => settings.get().refreshSeconds * 1000,
    readers,
  });
  const fotmob = createFotmob(fetchImpl);

  // поменялись каналы — перечитываем сразу, не дожидаясь следующего круга
  settings.on('change', (next, prev) => {
    const key = (s) => JSON.stringify(s.channels.filter((c) => c.enabled).map((c) => [c.screenName, c.label]));
    if (key(next) !== key(prev)) poller.refresh();
  });

  const listeners = new Set();
  watchFavorites({ poller, settings, fotmob, onStart: (event) => listeners.forEach((fn) => fn(event)) });

  const { server, url } = await startServer(createHandler({ settings, poller, fotmob, version }), { host, port });
  poller.refresh();

  return {
    settings,
    poller,
    server,
    url,
    onStreamStart: (fn) => listeners.add(fn),
    close() {
      poller.stop();
      server.close();
    },
  };
}
