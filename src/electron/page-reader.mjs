// Запасное чтение канала: страница vkvideo.ru/@канал/lives в скрытом окне, как у обычного
// посетителя. Сессия не сохраняется на диск, картинки, шрифты и видео не загружаются.
import { BrowserWindow, session } from 'electron';
import { fileURLToPath } from 'node:url';
import { CARDS_JS, fromCards, toItems } from '../core/vk-items.mjs';

const PRELOAD = fileURLToPath(new URL('./preload-vk.cjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let vkSession = null;
function getSession() {
  if (!vkSession) {
    vkSession = session.fromPartition('vkread'); // без persist: — только в памяти
    const skip = new Set(['image', 'font', 'media']);
    vkSession.webRequest.onBeforeRequest((d, cb) => cb({ cancel: skip.has(d.resourceType) }));
  }
  return vkSession;
}

async function readChannel(ch) {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 1400,
    webPreferences: {
      session: getSession(),
      backgroundThrottling: false,
      contextIsolation: false, // иначе preload не сможет подменить fetch на странице
      preload: PRELOAD,
    },
  });
  win.webContents.setAudioMuted(true);
  try {
    win.loadURL(`https://vkvideo.ru/@${ch.screenName}/lives`).catch(() => {}); // ждём данные, а не всю страницу

    // каталог приходит порциями (3, 23, 43 видео…) — ждём, пока список не перестанет расти 2 с
    let count = 0;
    let changed = Date.now();
    const started = Date.now();
    while (Date.now() - started < 25e3) {
      await sleep(250);
      const n = await win.webContents.executeJavaScript('(window.__mcCatalog || []).length').catch(() => 0);
      if (n !== count) {
        count = n;
        changed = Date.now();
      }
      if (count && Date.now() - changed > 2000) break;
    }

    const videos = await win.webContents.executeJavaScript('window.__mcCatalog || []');
    if (videos.length) return toItems(videos, ch);

    const cards = fromCards(await win.webContents.executeJavaScript(CARDS_JS), ch);
    if (!cards.length) throw new Error('страница не показала ни одного эфира (доступ не из России?)');
    return cards;
  } finally {
    win.destroy();
  }
}

export const pageReader = { name: 'страница', read: readChannel };
