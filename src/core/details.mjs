// Подробности матча из FotMob: события (голы, карточки, замены, перерыв) и составы.
// Для идущего матча отдаём состояние минутной давности: трансляция в VK отстаёт от реального
// времени, и свежие события раскрывали бы голы раньше, чем их покажут в эфире.

export const DELAY_MS = 60e3;
const LIVE_FETCH_MS = 20e3; // как часто спрашивать FotMob про идущий матч
const DONE_TTL_MS = 10 * 60e3; // завершённый или не начавшийся матч меняется редко
const MAX_MATCHES = 30;

// «45+4»: timeStr у FotMob уже содержит добавленное время («45 + 4»), поэтому собираем из чисел
const minute = (e) => (e.time != null ? `${e.time}${e.overloadTime ? `+${e.overloadTime}` : ''}` : String(e.timeStr ?? ''));
const side = (e) => (e.isHome ? 'home' : 'away');
const assist = (s) => (s ? String(s).replace(/^assist by\s+/i, '') : null);

export function parseEvents(raw) {
  const out = [];
  for (const e of raw?.content?.matchFacts?.events?.events || []) {
    if (e.isPenaltyShootoutEvent) continue;
    if (e.type === 'Goal') {
      const [h, a] = Array.isArray(e.newScore) ? e.newScore : [e.homeScore, e.awayScore];
      out.push({
        kind: 'goal', minute: minute(e), side: side(e), player: e.player?.name || e.nameStr || '',
        assist: assist(e.assistStr), own: !!e.ownGoal, penalty: /penalty/i.test(e.goalDescriptionKey || ''), score: [h, a],
      });
    } else if (e.type === 'Card') {
      out.push({ kind: 'card', minute: minute(e), side: side(e), player: e.player?.name || e.nameStr || '', card: String(e.card || '').toLowerCase() });
    } else if (e.type === 'Substitution') {
      const [inn, out_] = e.swap || [];
      out.push({ kind: 'sub', minute: minute(e), side: side(e), in: inn?.name || '', out: out_?.name || '' });
    } else if (e.type === 'Half') {
      out.push({ kind: 'half', minute: minute(e), label: e.halfStrShort || '', score: [e.homeScore, e.awayScore] });
    }
  }
  return out;
}

export function parseLineups(raw) {
  const lu = raw?.content?.lineup;
  if (!lu?.homeTeam?.starters?.length) return null;
  const team = (t) => ({
    name: t.name,
    formation: t.formation || null,
    coach: t.coach?.name || null,
    starters: (t.starters || []).map((p) => ({ number: p.shirtNumber ?? '', name: p.name })),
    subs: (t.subs || []).map((p) => ({ number: p.shirtNumber ?? '', name: p.name })),
  });
  return { home: team(lu.homeTeam), away: team(lu.awayTeam) };
}

function summarize(raw) {
  const st = raw?.header?.status || {};
  const state = st.finished ? 'finished' : st.started ? 'live' : 'upcoming';
  return { state, events: parseEvents(raw), lineups: parseLineups(raw) };
}

export function createDetails({ fotmob, now = () => Date.now() }) {
  // id → { snapshots: [{ t, data }], fetchedAt, pending }
  const cache = new Map();

  async function refresh(id, entry) {
    entry.pending ??= fotmob.match(id).then((raw) => {
      const data = summarize(raw);
      entry.fetchedAt = now();
      entry.snapshots.push({ t: entry.fetchedAt, data });
      // храним только то, что может понадобиться: последний снимок старше задержки и всё новее
      const cutoff = entry.fetchedAt - DELAY_MS;
      const older = entry.snapshots.filter((s) => s.t <= cutoff);
      entry.snapshots = [...older.slice(-1), ...entry.snapshots.filter((s) => s.t > cutoff)];
    }).finally(() => { entry.pending = null; });
    return entry.pending;
  }

  return async function get(id) {
    let entry = cache.get(id);
    if (!entry) {
      entry = { snapshots: [], fetchedAt: 0, pending: null };
      cache.set(id, entry);
      while (cache.size > MAX_MATCHES) cache.delete(cache.keys().next().value);
    }
    const last = entry.snapshots.at(-1)?.data;
    const ttl = last?.state === 'live' ? LIVE_FETCH_MS : DONE_TTL_MS;
    if (!last || now() - entry.fetchedAt >= ttl) await refresh(id, entry);

    const latest = entry.snapshots.at(-1).data;
    if (latest.state !== 'live') return { ...latest, delayed: false };
    // идущий матч: самый свежий снимок, которому уже есть минута
    const ripe = entry.snapshots.filter((s) => now() - s.t >= DELAY_MS).at(-1);
    if (!ripe) return { state: 'live', pending: true, delayed: true, readyIn: Math.ceil((DELAY_MS - (now() - entry.snapshots[0].t)) / 1000), lineups: latest.lineups, events: [] };
    return { ...ripe.data, state: 'live', delayed: true, lineups: latest.lineups };
  };
}
