// Форматирование и разбор ввода. Без DOM — работает и в браузере, и в тестах под Node.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
export const parseYmd = (s) => new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const hhmm = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
export const isLive = (m) => m.started && !m.finished && !m.cancelled;
export const STATUS = { started: 'LIVE', upcoming: 'скоро', finished: 'запись', failed: 'сбой' };
const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }); // 18,5 тыс.
const full = new Intl.NumberFormat('ru-RU'); // 18 557

// «· 1,2 тыс. смотрят» — только у идущего эфира; у записей счётчик не показываем
export function audience(s) {
  if (s.status === 'started' && s.spectators > 0)
    return { text: ` · ${compact.format(s.spectators)} смотрят`, title: `Смотрят сейчас: ${full.format(s.spectators)}` };
  return null;
}

// Ссылка для встраивания — ровно как в официальном коде VK: oid, id, hash, без hd/autoplay
export function embedUrl(s) {
  if (!s.embed) return null;
  try {
    const u = new URL(s.embed);
    if (u.protocol !== 'https:' || !/(^|\.)(vkvideo\.ru|vk\.com|vk\.ru)$/.test(u.hostname)) return null;
    u.searchParams.delete('__ref');
    return u.href;
  } catch {
    return null;
  }
}

// «vkvideo.ru/@pl_forever», «https://vk.com/video/@x/lives», «@x» → screenName или null
export function parseChannel(text) {
  const s = text.trim().replace(/^https?:\/\//i, '').replace(/^(www\.)?(vkvideo\.ru|vk\.com|vk\.ru)\//i, '')
    .replace(/^video\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  return /^[\w.-]{2,64}$/.test(s) ? s : null;
}

// «Команда = вариант, вариант» по строке → { aliases } или { error } с непонятой строкой
export function parseAliases(text) {
  const aliases = {};
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const [team, names] = line.split('=');
    if (!team?.trim() || !names?.trim()) return { error: `Не понял строку «${line}»: нужно «Команда = вариант, вариант»` };
    aliases[team.trim()] = names.split(',').map((n) => n.trim()).filter(Boolean);
  }
  return { aliases };
}
