// Эфиры VK-каналов: открываем vkvideo.ru/@канал/lives в безголовом Chromium как обычный посетитель
// и читаем данные, которые страница сама получает для отрисовки карточек.
import { chromium } from 'playwright';
import { parseTeams } from './match.mjs';

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

// live_status из ответов vkvideo.ru → наши статусы
function status(s) {
  if (s === 'started') return 'started';
  if (s === 'upcoming' || s === 'waiting') return 'upcoming';
  if (s === 'failed') return 'failed';
  return 'finished'; // postlive, finished
}

function collectVideos(json, out) {
  const arr = json?.response?.videos;
  if (Array.isArray(arr)) for (const v of arr) out.set(`${v.owner_id}_${v.id}`, v);
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

    let items = [...videos.values()]
      .filter((v) => v.live_status)
      .map((v) => ({
        title: v.title,
        url: `https://vkvideo.ru/live${v.owner_id}_${v.id}`,
        // официальная ссылка для встраивания, с hash — без него часть каналов в iframe «недоступна»
        embed: v.player || null,
        status: status(v.live_status),
        time: (v.live_start_time || v.date) * 1000,
      }));

    // запасной путь: если формат ответов поменялся, берём карточки со страницы (без точного времени)
    if (!items.length) {
      items = await page.$$eval('[data-testid="catalog_item_video"]', (cards) => cards.map((c) => {
        const a = c.querySelector('[data-testid="video_card_title"] a');
        return a && { title: a.textContent.trim(), url: new URL(a.getAttribute('href'), location.href).href,
          status: c.querySelector('[data-testid="video_card_duration"]') ? 'finished' : 'started', time: null };
      }).filter(Boolean));
    }
    // страница не отдала ни одного эфира — чаще всего гео-ограничение (сервер не в России)
    if (!items.length) throw new Error('канал не вернул ни одного эфира (гео-ограничение? нужен vkProxy)');

    return items
      .map((s) => ({
        ...s,
        channel: ch.label || ch.screenName,
        // "embed": false в config.json — эфир открывается на vkvideo.ru, а не во встроенном плеере
        external: ch.embed === false,
        teams: parseTeams(s.title),
      }))
      .filter((s) => s.teams);
  } finally {
    await ctx.close();
  }
}

// Фоновое обновление: все каналы по очереди раз в intervalMs, снимок отдаётся сразу.
export function startVkPoller(channels, intervalMs = 120e3, proxyServer = null) {
  if (proxyServer) proxy = { server: proxyServer };
  const state = { streams: [], errors: [], updatedAt: null };
  const byChannel = new Map();

  async function tick() {
    const errors = [];
    for (const ch of channels) {
      try {
        byChannel.set(ch.screenName, await scrapeChannel(ch));
      } catch (e) {
        errors.push(`${ch.label || ch.screenName}: ${e.message.split('\n')[0]}`);
      }
    }
    state.streams = [...byChannel.values()].flat();
    state.errors = errors;
    state.updatedAt = Date.now();
    setTimeout(tick, intervalMs);
  }
  tick();
  return state;
}
