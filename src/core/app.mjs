// Всё ядро вместе: настройки, опрос каналов, FotMob, сервер и уведомления.
import { createDetails } from './details.mjs';
import { createFotmob } from './fotmob.mjs';
import { createHandler, startServer } from './server.mjs';
import { openSettings } from './settings.mjs';
import { createStreamPoller } from './streams.mjs';
import { createVkApi } from './vk-api.mjs';
import { watchFavorites } from './watch.mjs';

export async function createMatchCenter({ dataDir, fetchImpl = fetch, pageReader = null, version }) {
  const settings = await openSettings(dataDir);
  const readers = [createVkApi(fetchImpl), pageReader].filter(Boolean);
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
  const watcher = watchFavorites({ poller, settings, fotmob, onEvent: (event) => listeners.forEach((fn) => fn(event)) });
  const details = createDetails({ fotmob });

  const { server, url } = await startServer(createHandler({ settings, poller, fotmob, details, version }));
  poller.refresh();

  return {
    settings,
    poller,
    server,
    url,
    // уведомления о матчах избранных: { kind: soon | kickoff, date, match }
    onNotify: (fn) => listeners.add(fn),
    close() {
      poller.stop();
      watcher.stop();
      server.close();
    },
  };
}
