// Общее для обоих способов чтения каналов VK (Playwright и окно Electron):
// разбор данных, которые страница канала загружает для своих карточек, и фоновый опрос.
import { parseTeams } from './match.mjs';

// live_status из ответов vkvideo.ru → наши статусы
export function status(s) {
  if (s === 'started') return 'started';
  if (s === 'upcoming' || s === 'waiting') return 'upcoming';
  if (s === 'failed') return 'failed';
  return 'finished'; // postlive, finished
}

export function collectVideos(json, out) {
  const arr = json?.response?.videos;
  if (Array.isArray(arr)) for (const v of arr) out.set(`${v.owner_id}_${v.id}`, v);
}

const withChannel = (ch) => (s) => ({
  ...s,
  channel: ch.label || ch.screenName,
  teams: parseTeams(s.title),
});

export function toItems(videos, ch) {
  // страница может запросить каталог несколько раз — одно видео оставляем один раз, в последней версии
  const unique = new Map(videos.map((v) => [`${v.owner_id}_${v.id}`, v]));
  return [...unique.values()]
    .filter((v) => v.live_status)
    .map((v) => ({
      title: v.title,
      url: `https://vkvideo.ru/live${v.owner_id}_${v.id}`,
      // официальная ссылка для встраивания, с hash
      embed: v.player || null,
      status: status(v.live_status),
      time: (v.live_start_time || v.date) * 1000,
    }))
    .map(withChannel(ch))
    .filter((s) => s.teams);
}

// Запасной путь: если формат ответов поменялся, читаем карточки со страницы (без точного времени).
// Выполняется внутри страницы, поэтому это строка.
export const CARDS_JS = `[...document.querySelectorAll('[data-testid="catalog_item_video"]')].map((c) => {
  const a = c.querySelector('[data-testid="video_card_title"] a');
  return a && { title: a.textContent.trim(), url: new URL(a.getAttribute('href'), location.href).href,
    status: c.querySelector('[data-testid="video_card_duration"]') ? 'finished' : 'started', time: null };
}).filter(Boolean)`;

export const fromCards = (cards, ch) => cards.map(withChannel(ch)).filter((s) => s.teams);

// Фоновое обновление: все каналы по очереди раз в intervalMs, снимок отдаётся сразу.
export function startPoller(channels, intervalMs, scrapeChannel) {
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
