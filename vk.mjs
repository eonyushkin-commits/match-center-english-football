// Чтение эфиров VK через Playwright — способ для запуска без Electron (`npm start`).
// Открываем vkvideo.ru/@канал/lives как обычный посетитель и читаем данные,
// которые страница сама получает для отрисовки карточек.
import { chromium } from 'playwright';
import { CARDS_JS, collectVideos, fromCards, startPoller, toItems } from './vk-parse.mjs';
import { withApi } from './vk-api.mjs';

let browserPromise = null;
let proxy; // { server: 'socks5://host:port' } — задаётся в config.json как vkProxy
function browser() {
  if (!browserPromise) {
    browserPromise = chromium.launch(proxy ? { proxy } : {}).then((b) => {
      b.on('disconnected', () => { browserPromise = null; });
      return b;
    });
  }
  return browserPromise;
}

async function scrapeChannel(ch) {
  const b = await browser();
  const ctx = await b.newContext({ locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
  const page = await ctx.newPage();
  // картинки и шрифты не нужны — так страница грузится быстрее
  await page.route('**/*', (r) =>
    ['image', 'font', 'media'].includes(r.request().resourceType()) ? r.abort() : r.continue());
  const videos = new Map();
  const pending = [];
  page.on('response', (r) => {
    if (!/api\.vkvideo\.ru\/method\/catalog\./.test(r.url())) return;
    pending.push(r.json().then((j) => collectVideos(j, videos)).catch(() => {}));
  });
  try {
    await page.goto(`https://vkvideo.ru/@${ch.screenName}/lives`, { waitUntil: 'networkidle', timeout: 45e3 });
    await Promise.all(pending);

    const items = toItems([...videos.values()], ch);
    if (items.length) return items;

    const cards = fromCards(await page.evaluate(CARDS_JS), ch);
    // страница не отдала ни одного эфира — чаще всего гео-ограничение (доступ не из России)
    if (!cards.length) throw new Error('канал не вернул ни одного эфира (гео-ограничение? нужен vkProxy)');
    return cards;
  } finally {
    await ctx.close();
  }
}

export function startVkPoller(channels, intervalMs = 60e3, proxyServer = null) {
  if (proxyServer) proxy = { server: proxyServer };
  // прокси (vkProxy) умеет только браузер — с ним читаем страницы, без него сначала API
  return startPoller(channels, intervalMs, proxyServer ? scrapeChannel : withApi(scrapeChannel));
}
