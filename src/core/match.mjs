// Сопоставление заголовков VK-эфиров с матчами FotMob.
export const norm = (s) => String(s ?? '')
  .toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Команды ищем в любой части заголовка между «|»: у каналов бывает и
// «Брайтон — Арсенал | АПЛ 5 тур», и «Смотреть онлайн АПЛ | 5 тур | Брайтон – Арсенал».
// Лишние слова перед командами («Смотреть онлайн Чемпионшип …») отсекает nameScore.
export function parseTeams(title) {
  for (const seg of String(title ?? '').split('|')) {
    const parts = seg.split(/\s+(?:—|–|-|vs\.?|против)\s+/i);
    if (parts.length !== 2) continue;
    const teams = parts.map((p) => norm(p.replace(/\(.*?\)|\d+\s*:\s*\d+/g, '')));
    if (teams.every(Boolean)) return teams;
  }
  return null;
}

// Слова, которые есть в названиях нескольких клубов. Совпадение только по ним ничего не значит:
// «Юнайтед — Сити» — это и МЮ, и Ньюкасл, и Лидс, и половина Чемпионшипа.
const GENERIC = new Set([
  'фк', 'fc', 'юнайтед', 'united', 'сити', 'city', 'таун', 'town', 'альбион', 'albion',
  'уондерерс', 'wanderers', 'рейнджерс', 'rangers', 'каунти', 'county', 'роверс', 'rovers',
  'атлетик', 'athletic', 'вест', 'west', 'манчестер', 'manchester', 'шеффилд', 'sheffield',
  'бристоль', 'bristol', 'ман', 'man',
]);
const specific = (words) => words.some((w) => !GENERIC.has(w));

function bigrams(s) {
  const out = new Set();
  const t = s.replace(/ /g, '');
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

// Нечёткое сравнение (опечатки, «Миллуол»/«Миллуолл»). Ниже 0.72 считаем разными командами,
// иначе «Манчестер Сити» ≈ «Манчестер Юнайтед».
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const d = (2 * inter) / (A.size + B.size || 1);
  return d >= 0.72 ? d : 0;
}

// a — название из FotMob, b — половина заголовка эфира (может содержать лишние слова)
export function nameScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = a.split(' '), tb = b.split(' ');
  // всё название команды есть в заголовке — «смотреть манчестер сити» ⊃ «манчестер сити»
  if (ta.every((x) => tb.includes(x))) return 0.9;
  // из одних общих слов («Манчестер», «Юнайтед») команду не узнать — даже нечётко
  if (!specific(tb)) return 0;
  // заголовок — сокращение названия («Вулверхэмптон» из «Вулверхэмптон Уондерерс»)
  if (tb.every((x) => ta.includes(x))) return 0.9;
  let score = dice(a, b);
  // сравниваем название с каждым отрезком заголовка той же длины в словах
  for (let i = 0; i + ta.length <= tb.length; i++)
    score = Math.max(score, 0.85 * dice(a, tb.slice(i, i + ta.length).join(' ')));
  return score;
}

// Все варианты названия команды: русское из FotMob, английские и алиасы из настроек
export function createNamer(ru, aliases = {}) {
  const aliasIndex = new Map(Object.entries(aliases).map(([k, v]) => [norm(k), v.map(norm)]));
  return (team) => {
    const names = [ru?.Participants?.[team.id], team.name, team.shortName, team.longName].filter(Boolean).map(norm);
    for (const n of [...names]) names.push(...(aliasIndex.get(n) || []));
    return [...new Set(names)].filter(Boolean);
  };
}

const best = (names, s) => Math.max(0, ...names.map((n) => nameScore(n, s)));
const RANK = { started: 0, upcoming: 1, finished: 2, failed: 3 };
const DAY = 24 * 3600e3;
// Внутри статуса: идущие — по зрителям (популярный первым), записи — по дате создания видео,
// запланированные — по времени начала
function withinStatus(x, y) {
  if (x.status === 'started') return (y.spectators ?? -1) - (x.spectators ?? -1) || (x.time ?? 0) - (y.time ?? 0);
  if (x.status === 'finished') return (x.created ?? x.time ?? 0) - (y.created ?? y.time ?? 0);
  return (x.time ?? 0) - (y.time ?? 0);
}

export function matchStreams(match, homeNames, awayNames, streams) {
  const kickoff = Date.parse(match.status.utcTime);
  return streams
    // time — дата создания эфира: некоторые каналы создают его за несколько дней до матча.
    // time === null — эфир взят из карточки без даты, проверяем только названия.
    .filter((s) => s.teams && (s.time === null || (s.time > kickoff - 5 * DAY && s.time < kickoff + 6 * 3600e3)))
    .map((s) => {
      const [a, b] = s.teams;
      const straight = Math.min(best(homeNames, a), best(awayNames, b));
      const swapped = Math.min(best(homeNames, b), best(awayNames, a));
      return { ...s, score: Math.max(straight, swapped) };
    })
    .filter((s) => s.score > 0)
    // Запланированный эфир у завершённого матча — резервный, который так и не запустили
    // («РЕЗЕРВ. Фулхэм – Манчестер Юнайтед»): смотреть там нечего.
    .filter((s) => !(match.status.finished && s.status === 'upcoming'))
    // Порядок: идущие (всегда впереди), затем запланированные, затем записи
    .sort((x, y) => RANK[x.status] - RANK[y.status] || withinStatus(x, y) || y.score - x.score)
    .map(({ teams, score, ...s }) => s);
}
