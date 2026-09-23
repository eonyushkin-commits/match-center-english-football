// Расписание дня: турниры из настроек в заданном порядке, русские названия, привязанные эфиры.
import { createNamer, matchStreams } from './match.mjs';

export function buildDay({ fm, ru, settings, snapshot }) {
  const order = settings.leagues;
  const favorites = new Set(settings.favorites.map((f) => f.id));
  const namesOf = createNamer(ru, settings.teamAliases);
  const leagueId = (lg) => lg.primaryId ?? lg.id;

  const leagues = (fm.leagues || [])
    .filter((lg) => order.includes(leagueId(lg)))
    .sort((a, b) => order.indexOf(leagueId(a)) - order.indexOf(leagueId(b)))
    .map((lg) => {
      const id = leagueId(lg); // у сезонных этапов lg.id свой (напр. 938218 у Чемпионшипа), логотип — под основным
      return {
        id,
        name: ru.TournamentTemplates?.[id] || ru.TournamentTemplates?.[lg.id] || lg.name,
        country: ru.CountryCodes?.[lg.ccode] || lg.ccode || '',
        matches: (lg.matches || []).map((m) => ({
          id: m.id,
          utcTime: m.status.utcTime,
          home: team(m.home, ru),
          away: team(m.away, ru),
          started: !!m.status.started,
          finished: !!m.status.finished,
          cancelled: !!m.status.cancelled,
          liveTime: m.status.liveTime?.short || null, // как отдаёт FotMob: «67’», «HT»
          reason: m.status.reason?.short || null, // «FT», «AET», «Pen»…
          favorite: favorites.has(m.home.id) || favorites.has(m.away.id),
          streams: matchStreams(m, namesOf(m.home), namesOf(m.away), snapshot.streams),
        })),
      };
    });

  return { leagues, stale: fm.stale || ru.stale || null };
}

const team = (t, ru) => ({ id: t.id, name: ru.Participants?.[t.id] || t.name, score: t.score ?? null });

// Дата «сегодня» в часовом поясе компьютера, в формате FotMob (ГГГГММДД)
export function localYmd(d = new Date()) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
