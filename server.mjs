// Матч-центр: расписание FotMob + трансляции из VK-каналов.
// Запуск: node server.mjs  →  http://localhost:3777
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { teamNames, matchStreams } from './match.mjs';
import { startVkPoller } from './vk.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(ROOT, 'config.json'), 'utf8'));
const PORT = Number(process.env.PORT || config.port || 3777);

// ---------- простой кэш ----------
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

async function getJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// ---------- FotMob ----------
const ruNames = () =>
  cached('fotmob-ru', 24 * 3600e3, () =>
    getJson('https://www.fotmob.com/api/translationmapping?locale=ru'));

async function fotmobMatches(date, tz) {
  const url = `https://www.fotmob.com/api/data/matches?date=${date}&timezone=${encodeURIComponent(tz)}`;
  return cached(`fm-${date}-${tz}`, 45e3, () => getJson(url));
}

// ---------- VK ----------
const vk = startVkPoller(config.channels, (config.vkRefreshSeconds || 120) * 1000,
  process.env.VK_PROXY || config.vkProxy || null);

// ---------- API ----------
async function buildDay(date, tz) {
  const [fm, ru] = await Promise.all([fotmobMatches(date, tz), ruNames()]);
  // показываем только лиги из config.leagues, в том же порядке
  const order = config.leagues || [];
  const leagues = (fm.leagues || [])
    .filter((lg) => !order.length || order.includes(lg.primaryId ?? lg.id))
    .sort((a, b) => order.indexOf(a.primaryId ?? a.id) - order.indexOf(b.primaryId ?? b.id))
    .map((lg) => {
      const pid = lg.primaryId ?? lg.id;
      return {
        id: pid, // у сезонных этапов lg.id свой (напр. 938218 у Чемпионшипа), логотип лежит под основным ID
        name: ru.TournamentTemplates?.[pid] || ru.TournamentTemplates?.[lg.id] || lg.name,
        country: ru.CountryCodes?.[lg.ccode] || lg.ccode,
        ccode: lg.ccode,
        matches: lg.matches.map((m) => {
          const homeNames = teamNames(m.home, ru, config.teamAliases);
          const awayNames = teamNames(m.away, ru, config.teamAliases);
          return {
            id: m.id,
            utcTime: m.status.utcTime,
            home: { id: m.home.id, name: ru.Participants?.[m.home.id] || m.home.name, score: m.home.score },
            away: { id: m.away.id, name: ru.Participants?.[m.away.id] || m.away.name, score: m.away.score },
            started: m.status.started, finished: m.status.finished, cancelled: m.status.cancelled,
            liveTime: m.status.liveTime?.short || null,
            reason: m.status.reason?.short || null,
            streams: matchStreams(m, homeNames, awayNames, vk.streams),
          };
        }),
      };
    });
  return {
    leagues,
    vk: { ready: vk.updatedAt !== null, updatedAt: vk.updatedAt, errors: vk.errors, channels: config.channels, streamCount: vk.streams.length },
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/api/day') {
      const date = /^\d{8}$/.test(u.searchParams.get('date') || '') ? u.searchParams.get('date') : null;
      if (!date) throw Object.assign(new Error('date=YYYYMMDD'), { code: 400 });
      const tz = u.searchParams.get('tz') || 'Europe/Moscow';
      const data = await buildDay(date, tz);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(data));
    }
    if (u.pathname === '/api/streams') { // для отладки: все прочитанные эфиры
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(vk, null, 1));
    }
    if (u.pathname === '/' || u.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(await readFile(path.join(ROOT, 'public', 'index.html')));
    }
    res.writeHead(404).end('not found');
  } catch (e) {
    console.error(e);
    res.writeHead(e.code || 500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

// На сервере за nginx: HOST=127.0.0.1, чтобы приложение не было доступно снаружи в обход basic auth
const HOST = process.env.HOST || undefined;
server.listen(PORT, HOST, () => {
  console.log(`Матч-центр: http://${HOST || 'localhost'}:${PORT}`);
});
