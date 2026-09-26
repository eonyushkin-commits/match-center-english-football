// Разбор видео VK в эфиры матч-центра — общий для API и для чтения страницы канала.
import { parseTeams } from './match.mjs';

// live_status из ответов vkvideo.ru → наши статусы
function status(s) {
  if (s === 'started') return 'started';
  if (s === 'upcoming' || s === 'waiting') return 'upcoming';
  if (s === 'failed') return 'failed';
  return 'finished'; // postlive, finished
}

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
        created: v.date ? v.date * 1000 : null, // когда канал создал видео — по нему упорядочены записи
        spectators: Number.isFinite(v.spectators) ? v.spectators : null, // смотрят прямо сейчас — только у эфиров
        duration: v.duration > 0 ? v.duration : null, // длина записи, с
        channel: ch.label || ch.screenName,
        teams: parseTeams(v.title),
      };
    })
    .filter((s) => s.teams);
}
