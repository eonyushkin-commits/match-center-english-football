// Запасное чтение страницы канала для `npm start` — через Playwright, если он установлен
// (`npm install playwright && npx playwright install chromium`). Нужен также для vkProxy:
// прокси умеет только браузер.
import { CARDS_JS, fromCards, toItems } from '../core/vk-items.mjs';

export async function createPlaywrightReader(proxy) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    return null;
  }

  let browserPromise = null;
  const browser = () => {
    browserPromise ??= chromium.launch(proxy ? { proxy: { server: proxy } } : {}).then((b) => {
      b.on('disconnected', () => { browserPromise = null; });
      return b;
    }, (e) => {
      browserPromise = null;
      throw e;
    });
    return browserPromise;
  };

  async function readChannel(ch) {
    const ctx = await (await browser()).newContext({ locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
    const page = await ctx.newPage();
    await page.route('**/*', (r) =>
      ['image', 'font', 'media'].includes(r.request().resourceType()) ? r.abort() : r.continue());
    const videos = [];
    const pending = [];
    page.on('response', (r) => {
      if (!/api\.vkvideo\.ru\/method\/catalog\./.test(r.url())) return;
      pending.push(r.json().then((j) => videos.push(...(j?.response?.videos || []))).catch(() => {}));
    });
    try {
      await page.goto(`https://vkvideo.ru/@${ch.screenName}/lives`, { waitUntil: 'networkidle', timeout: 40e3 });
      await Promise.all(pending);
      if (videos.length) return toItems(videos, ch);
      const cards = fromCards(await page.evaluate(CARDS_JS), ch);
      if (!cards.length) throw new Error('страница не показала ни одного эфира (доступ не из России? нужен vkProxy)');
      return cards;
    } finally {
      await ctx.close();
    }
  }

  return { name: 'страница', read: readChannel };
}
