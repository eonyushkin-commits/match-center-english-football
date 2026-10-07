// Локальный сервер: страница матч-центра и её API.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { defaults } from './settings.mjs';

const WEB = new URL('../web/', import.meta.url);
// Отдаём только перечисленные файлы страницы
const FILES = ['index.html', 'app.js', 'dom.mjs', 'filter.mjs', 'format.mjs', 'opened.mjs', 'settings-ui.mjs', 'view.mjs', 'styles.css', 'icon.png', 'player.html', 'player.js'];
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', png: 'image/png' };
const STATIC = Object.fromEntries(FILES.map((file) => [`/${file}`, [file, TYPES[file.split('.').pop()]]]));
STATIC['/'] = STATIC['/index.html'];
// Страница может показывать только картинки FotMob и плеер VK — всё остальное браузер заблокирует
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: https://images.fotmob.com",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  'frame-src https://vkvideo.ru https://*.vkvideo.ru https://vk.com https://*.vk.com https://vk.ru https://*.vk.ru',
].join('; ');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, type, extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}

async function readJson(req) {
  // только JSON: форма с чужого сайта так не отправится, а fetch с чужого сайта требует разрешения CORS
  if (!String(req.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'Нужен application/json');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new HttpError(413, 'Слишком большой запрос');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Неверный JSON');
  }
}

function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function createHandler({ settings, poller, fotmob, feed }) {
  const withLeagues = (s) => ({ ...s, knownLeagues: defaults.knownLeagues });

  // Лента (Server-Sent Events): расписание дня date, состояние каналов и, если задан match,
  // события этого матча — сразу и при каждом изменении. Подписка живёт, пока открыто соединение.
  function events(u, res) {
    const date = u.searchParams.get('date') || '';
    const tz = u.searchParams.get('tz') || 'Europe/Moscow';
    const matchId = u.searchParams.get('match');
    if (!/^\d{8}$/.test(date)) throw new HttpError(400, 'date: нужен формат ГГГГММДД');
    if (!validTimeZone(tz)) throw new HttpError(400, 'tz: неизвестный часовой пояс');
    if (matchId !== null && !/^\d{1,12}$/.test(matchId)) throw new HttpError(400, 'match: нужен номер матча FotMob');
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.on('close', feed.subscribe({ date, tz, matchId }, (event, json) => res.write(`event: ${event}\ndata: ${json}\n\n`)));
  }

  const routes = {
    'GET /api/settings': () => withLeagues(settings.get()),
    // русские названия всех турниров FotMob: { id: «Россия · ФНЛ» }, у международных — без страны
    'GET /api/leagues': async () => {
      const j = await fotmob.leagues();
      const names = {};
      for (const g of [...(j.international || []), ...(j.countries || [])]) {
        for (const l of g.leagues || []) {
          const name = l.localizedName || l.name;
          names[l.id] = g.ccode === 'INT' ? name : `${g.localizedName || g.name} · ${name}`;
        }
      }
      return names;
    },
    'PUT /api/settings': async (u, req) => withLeagues(await settings.update(await readJson(req))),
    'POST /api/refresh': () => {
      // по кнопке: расписание и каналы перечитываются сразу (каналы — без пауз запасного чтения);
      // когда каналы прочитаны, лента присылает странице новое расписание
      fotmob.refresh();
      poller.retry();
      return { ok: true };
    },
  };

  return async (req, res) => {
    try {
      const u = URL.parse(req.url, 'http://localhost');
      if (!u) throw new HttpError(400, 'Неверный адрес');
      if (req.method === 'GET' && u.pathname === '/api/events') return events(u, res);
      const route = routes[`${req.method} ${u.pathname}`];
      if (route) return send(res, 200, JSON.stringify(await route(u, req)), 'application/json; charset=utf-8');
      const file = req.method === 'GET' ? STATIC[u.pathname] : null;
      if (file) {
        const csp = file[1].startsWith('text/html') ? { 'Content-Security-Policy': CSP } : {};
        return send(res, 200, await readFile(new URL(file[0], WEB)), file[1], csp);
      }
      throw new HttpError(404, 'Не найдено');
    } catch (e) {
      const status = Number.isInteger(e.status) ? e.status : 500;
      if (status >= 500) console.error(e);
      send(res, status, JSON.stringify({ error: e.message }), 'application/json; charset=utf-8');
    }
  };
}

// Любой свободный порт на 127.0.0.1. Принимаем только запросы с Host этого же адреса:
// так чужая страница не достучится до API даже через подмену DNS.
export function startServer(handler) {
  return new Promise((resolve, reject) => {
    let allowed = new Set();
    const server = http.createServer((req, res) => {
      if (!allowed.has(req.headers.host)) return send(res, 403, 'Forbidden', 'text/plain');
      handler(req, res);
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}
