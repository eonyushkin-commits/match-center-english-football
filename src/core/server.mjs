// Локальный сервер: страница матч-центра и её API.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { buildDay } from './day.mjs';
import { defaults } from './settings.mjs';

const WEB = new URL('../web/', import.meta.url);
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/dom.mjs': ['dom.mjs', 'text/javascript; charset=utf-8'],
  '/filter.mjs': ['filter.mjs', 'text/javascript; charset=utf-8'],
  '/format.mjs': ['format.mjs', 'text/javascript; charset=utf-8'],
  '/settings-ui.mjs': ['settings-ui.mjs', 'text/javascript; charset=utf-8'],
  '/view.mjs': ['view.mjs', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/icon.png': ['icon.png', 'image/png'],
  '/player.html': ['player.html', 'text/html; charset=utf-8'],
  '/player.js': ['player.js', 'text/javascript; charset=utf-8'],
};
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

export function createHandler({ settings, poller, fotmob, details, version }) {
  const withLeagues = (s) => ({ ...s, knownLeagues: defaults.knownLeagues });
  const routes = {
    'GET /api/day': async (u) => {
      const date = u.searchParams.get('date') || '';
      const tz = u.searchParams.get('tz') || 'Europe/Moscow';
      if (!/^\d{8}$/.test(date)) throw new HttpError(400, 'date: нужен формат ГГГГММДД');
      if (!validTimeZone(tz)) throw new HttpError(400, 'tz: неизвестный часовой пояс');
      const [fm, ru] = await Promise.all([fotmob.day(date, tz), fotmob.names()]);
      return buildDay({ fm, ru, settings: settings.get(), snapshot: poller.snapshot() });
    },
    'GET /api/status': () => {
      const { streams, ...vk } = poller.snapshot();
      return { version, vk: { ...vk, streamCount: streams.length }, warnings: settings.warnings };
    },
    'GET /api/match': (u) => {
      const id = u.searchParams.get('id') || '';
      if (!/^\d{1,12}$/.test(id)) throw new HttpError(400, 'id: нужен номер матча FotMob');
      return details(id);
    },
    'GET /api/settings': () => withLeagues(settings.get()),
    'PUT /api/settings': async (u, req) => withLeagues(await settings.update(await readJson(req))),
    'POST /api/refresh': () => {
      poller.refresh();
      return { ok: true };
    },
  };

  return async (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    try {
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
