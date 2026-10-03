// Подставная сеть для проверок в приложении: FotMob и VK отвечают заранее известным днём,
// привязанным к текущему времени. Три матча Премьер-лиги:
//   101 — идёт, два эфира на разных каналах;
//   102 — завершён, запись началась за 10 минут до первого свистка;
//   103 — начнётся через два часа, эфиров нет.
const details = require('../fixtures/fotmob-match-5795461.json');

const MIN = 60e3;
const TEAMS = { 1: ['Arsenal', 'Арсенал'], 2: ['Chelsea', 'Челси'], 3: ['Liverpool', 'Ливерпуль'], 4: ['Everton', 'Эвертон'], 5: ['Fulham', 'Фулхэм'], 6: ['Brentford', 'Брентфорд'] };
const VK_TOKEN_DELAY_MS = 3000; // первое чтение каналов тянется: эфиры должны прийти на страницу сами, после расписания

function create(now = Date.now()) {
  const kickoff = { 101: now - 30 * MIN, 102: now - 180 * MIN, 103: now + 120 * MIN };
  const team = (id, score) => ({ id, name: TEAMS[id][0], score });
  const match = (id, home, away, status) => ({ id, home, away, status: { utcTime: new Date(kickoff[id]).toISOString(), ...status } });
  const day = { leagues: [{ id: 47, name: 'Premier League', ccode: 'ENG', matches: [
    match(101, team(1, 1), team(2, 0), { started: true, finished: false, liveTime: { short: '31’' } }),
    match(102, team(3, 2), team(4, 1), { started: true, finished: true, reason: { short: 'FT' } }),
    match(103, team(5), team(6), { started: false, finished: false }),
  ] }] };
  const names = {
    Participants: Object.fromEntries(Object.entries(TEAMS).map(([id, n]) => [id, n[1]])),
    TournamentTemplates: { 47: 'Премьер-лига' },
    CountryCodes: { ENG: 'Англия' },
  };
  const leagues = { international: [], countries: [{ ccode: 'RUS', localizedName: 'Россия', leagues: [{ id: 338, localizedName: 'ФНЛ' }] }] };

  // время начала таймов FotMob пишет по времени Осло
  const oslo = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Oslo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const osloTime = (ms) => oslo.format(ms).replace(',', '');
  const matchDetails = (id) => {
    const st = day.leagues[0].matches.find((m) => m.id === id)?.status;
    return { ...details, header: { status: { utcTime: st?.utcTime, started: !!st?.started, finished: !!st?.finished, halfs: st?.started ? { firstHalfStarted: osloTime(kickoff[id]) } : {} } } };
  };

  const sec = (ms) => Math.floor(ms / 1000);
  const video = (owner, id, title, o) => ({ owner_id: -owner, id, title, date: sec(now - 60 * MIN), player: `https://vkvideo.ru/video_ext.php?oid=-${owner}&id=${id}&hash=smoke`, ...o });
  const videos = {
    englishaccent: [
      video(1, 1, 'Арсенал — Челси | АПЛ', { live_status: 'started', date: sec(kickoff[101] - 20 * MIN), spectators: 1200 }),
      video(1, 2, 'Ливерпуль — Эвертон | АПЛ', { live_status: 'postlive', date: sec(kickoff[102] - 10 * MIN), duration: 9000 }),
    ],
    pl_forever: [video(2, 1, 'Арсенал — Челси | Премьер-лига', { live_status: 'started', date: sec(kickoff[101] - 5 * MIN), spectators: 300 })],
  };
  const other = [video(9, 9, 'Обзор тура', { live_status: 'postlive' })]; // без команд — в эфиры не попадёт

  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  let tokenAsked = false;

  return async function fetch(url, init = {}) {
    const u = new URL(String(url));
    if (u.hostname === 'www.fotmob.com') {
      if (u.pathname === '/api/translationmapping') return json(names);
      if (u.pathname === '/api/data/matches') return json(day);
      if (u.pathname === '/api/data/allLeagues') return json(leagues);
      if (u.pathname === '/api/data/matchDetails') return json(matchDetails(Number(u.searchParams.get('matchId'))));
    }
    if (u.hostname === 'login.vk.ru') {
      if (!tokenAsked) await new Promise((r) => setTimeout(r, VK_TOKEN_DELAY_MS));
      tokenAsked = true;
      return json({ data: { access_token: 'smoke', expired_at: sec(Date.now()) + 3600 } });
    }
    if (u.hostname === 'api.vkvideo.ru' && u.pathname.endsWith('/catalog.getVideo')) {
      const channel = /@([\w.-]+)\/lives/.exec(new URLSearchParams(init.body).get('url'))?.[1];
      return json({ response: { videos: videos[channel] || other } });
    }
    return new Response('{}', { status: 404 });
  };
}

module.exports = { create };
