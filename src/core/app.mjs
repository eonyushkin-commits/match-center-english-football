// Всё ядро вместе: настройки, опрос каналов, FotMob, сервер и уведомления.
import { createDetails } from './details.mjs';
import { createFeed } from './feed.mjs';
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

  settings.on('change', () => poller.sync());

  const listeners = new Set();
  const watcher = watchFavorites({ poller, settings, fotmob, onEvent: (event) => listeners.forEach((fn) => fn(event)) });
  const details = createDetails({ fotmob });

  const feed = createFeed({ settings, poller, fotmob, details, version });

  const { server, url } = await startServer(createHandler({ settings, poller, fotmob, feed }));
  poller.refresh();

  return {
    settings,
    url,
    // уведомления о матчах избранных: { kind: soon | kickoff, date, match }
    onNotify: (fn) => listeners.add(fn),
    close() {
      poller.stop();
      watcher.stop();
      feed.close();
      server.close();
      server.closeAllConnections(); // открытые ленты страницы
    },
  };
}
