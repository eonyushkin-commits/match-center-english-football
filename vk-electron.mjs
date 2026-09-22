// Чтение эфиров VK средствами самого Electron: страница канала открывается в невидимом окне,
// а preload-скрипт складывает ответы, которыми сайт наполняет карточки, в window.__mcCatalog.
// Playwright для этого не нужен.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, net } from 'electron';
import { withApi } from './vk-api.mjs';
import { CARDS_JS, fromCards, startPoller, toItems } from './vk-parse.mjs';

const PRELOAD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'electron', 'preload-vk.cjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIMEOUT = 60e3;

async function scrapeChannel(ch) {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 1400,
    webPreferences: {
      partition: 'persist:vkread',
      backgroundThrottling: false,
      contextIsolation: false, // иначе preload не сможет подменить fetch на странице
      preload: PRELOAD,
    },
  });
  // зависшая страница не должна останавливать опрос всех каналов
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`страница канала не ответила за ${TIMEOUT / 1000} с`)), TIMEOUT);
  });
  try {
    return await Promise.race([readChannel(win, ch), timeout]);
  } finally {
    clearTimeout(timer);
    win.destroy();
  }
}

async function readChannel(win, ch) {
  await win.loadURL(`https://vkvideo.ru/@${ch.screenName}/lives`);

  // ждём, пока список перестанет пополняться (обычно хватает пары секунд)
  let videos = [];
  for (let i = 0, same = 0; i < 12 && same < 2; i++) {
    await sleep(1000);
    const next = await win.webContents.executeJavaScript('window.__mcCatalog || []');
    same = next.length && next.length === videos.length ? same + 1 : 0;
    videos = next;
  }

  const items = toItems(videos, ch);
  if (items.length) return items;

  const cards = fromCards(await win.webContents.executeJavaScript(CARDS_JS), ch);
  // страница не отдала ни одного эфира — чаще всего гео-ограничение (доступ не из России)
  if (!cards.length) throw new Error('канал не вернул ни одного эфира (гео-ограничение?)');
  return cards;
}

// основной путь — API VK через сетевой стек Chromium (учитывает системный прокси), окно — запасной
export function startVkPoller(channels, intervalMs = 60e3) {
  return startPoller(channels, intervalMs, withApi(scrapeChannel, net.fetch));
}
