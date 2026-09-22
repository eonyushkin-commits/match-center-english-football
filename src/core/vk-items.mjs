// Разбор видео VK в эфиры матч-центра — общий для API и для чтения страницы канала.
import { parseTeams } from './match.mjs';

// live_status из ответов vkvideo.ru → наши статусы
export function status(s) {
  if (s === 'started') return 'started';
  if (s === 'upcoming' || s === 'waiting') return 'upcoming';
  if (s === 'failed') return 'failed';
  return 'finished'; // postlive, finished
}

const withChannel = (ch) => (s) => ({ ...s, channel: ch.label || ch.screenName, teams: parseTeams(s.title) });

export function toItems(videos, ch) {
  // одно видео может прийти несколько раз (повторные запросы страницы) — берём последнюю версию
  const unique = new Map(videos.map((v) => [`${v.owner_id}_${v.id}`, v]));
  return [...unique.values()]
    .filter((v) => v.live_status && v.title)
    .map((v) => {
      const t = v.live_start_time || v.date;
      return {
        title: v.title,
        url: `https://vkvideo.ru/live${v.owner_id}_${v.id}`,
        embed: v.player || null, // официальная ссылка для встраивания, с hash
        status: status(v.live_status),
        time: t ? t * 1000 : null,
      };
    })
    .map(withChannel(ch))
    .filter((s) => s.teams);
}

// Запасной путь для страницы: если формат ответов поменялся, читаем карточки (без точного времени).
// Выполняется внутри страницы, поэтому это строка.
export const CARDS_JS = `[...document.querySelectorAll('[data-testid="catalog_item_video"]')].map((c) => {
  const a = c.querySelector('[data-testid="video_card_title"] a');
  return a && { title: a.textContent.trim(), url: new URL(a.getAttribute('href'), location.href).href,
    embed: null, status: c.querySelector('[data-testid="video_card_duration"]') ? 'finished' : 'started', time: null };
}).filter(Boolean)`;

export const fromCards = (cards, ch) => cards.map(withChannel(ch)).filter((s) => s.teams);
