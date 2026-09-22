import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNamer, matchStreams, nameScore, norm, parseTeams } from '../src/core/match.mjs';

// Заголовки — настоящие, с каналов в сентябре 2026
test('parseTeams: команды в любой части заголовка', () => {
  assert.deepEqual(parseTeams('Фулхэм — Манчестер Юнайтед | АПЛ 5 тур | ПРЯМОЙ ЭФИР'), ['фулхэм', 'манчестер юнайтед']);
  assert.deepEqual(parseTeams('Смотреть онлайн Английскую Премьер-Лигу | 5 тур | Борнмут – Ливерпуль'), ['борнмут', 'ливерпуль']);
  assert.deepEqual(parseTeams('Смотреть онлайн Чемпионшип Рексем – Саутгемптон'), ['смотреть онлайн чемпионшип рексем', 'саутгемптон']);
  assert.deepEqual(parseTeams('РЕЗЕРВ. Фулхэм – Манчестер Юнайтед | ПРЯМАЯ ТРАНСЛЯЦИЯ | АПЛ'), ['резерв фулхэм', 'манчестер юнайтед']);
  assert.deepEqual(parseTeams('Арсенал vs Челси (повтор) 2:1'), ['арсенал', 'челси']);
  assert.equal(parseTeams('Обзор тура | АПЛ'), null);
});

test('norm: ё, регистр и знаки', () => {
  assert.equal(norm('  Ноттингем Форест!  '), 'ноттингем форест');
  assert.equal(norm('Вулверхэмптон «Уондерерс»'), 'вулверхэмптон уондерерс');
  assert.equal(norm('Лёвен'), 'левен');
});

test('nameScore: лишние слова в заголовке не мешают', () => {
  assert.ok(nameScore('рексем', 'смотреть онлайн чемпионшип рексем') >= 0.85);
  assert.ok(nameScore('фулхэм', 'резерв фулхэм') >= 0.85);
  assert.ok(nameScore('миллуолл', 'миллуол') > 0.72, 'опечатка');
  assert.ok(nameScore('вулверхэмптон уондерерс', 'вулверхэмптон') >= 0.9, 'сокращение');
});

test('nameScore: общие слова — не совпадение', () => {
  assert.equal(nameScore('ньюкасл юнайтед', 'юнайтед'), 0);
  assert.equal(nameScore('ковентри сити', 'сити'), 0);
  assert.equal(nameScore('манчестер сити', 'манчестер'), 0);
  assert.equal(nameScore('манчестер сити', 'манчестер юнайтед'), 0);
  assert.ok(nameScore('манчестер сити', 'смотреть манчестер сити') >= 0.9);
});

const ru = { Participants: { 1: 'Фулхэм', 2: 'Манчестер Юнайтед', 3: 'Ньюкасл', 4: 'Ковентри' } };
const namer = createNamer(ru, { 'Манчестер Юнайтед': ['МЮ'] });
const match = (home, away, utcTime, finished = false) => ({
  home: { id: home, name: 'x' }, away: { id: away, name: 'y' }, status: { utcTime, finished },
});
const stream = (title, extra = {}) => ({
  title, teams: parseTeams(title), status: 'finished', time: Date.parse('2026-09-20T15:00:00Z'), channel: 'X', url: title, ...extra,
});

test('matchStreams: находит эфир, в том числе по алиасу и с переставленными командами', () => {
  const m = match(1, 2, '2026-09-20T15:30:00Z');
  const found = matchStreams(m, namer(m.home), namer(m.away), [
    stream('Фулхэм — Манчестер Юнайтед | АПЛ 5 тур'),
    stream('МЮ – Фулхэм | повтор'),
    stream('Ньюкасл — Ковентри | АПЛ'),
    stream('Юнайтед — Сити | дерби'),
  ]);
  assert.deepEqual(found.map((s) => s.title), ['Фулхэм — Манчестер Юнайтед | АПЛ 5 тур', 'МЮ – Фулхэм | повтор']);
});

test('matchStreams: резерв у завершённого матча и эфиры не того времени отбрасываются', () => {
  const m = match(1, 2, '2026-09-20T15:30:00Z', true);
  const found = matchStreams(m, namer(m.home), namer(m.away), [
    stream('РЕЗЕРВ. Фулхэм – Манчестер Юнайтед', { status: 'upcoming' }),
    stream('Фулхэм – Манчестер Юнайтед | прошлый сезон', { time: Date.parse('2026-03-01T15:00:00Z') }),
    stream('Фулхэм – Манчестер Юнайтед | без даты', { time: null }),
  ]);
  assert.deepEqual(found.map((s) => s.title), ['Фулхэм – Манчестер Юнайтед | без даты']);
});

test('matchStreams: сначала идущие, потом запланированные, потом записи', () => {
  const m = match(1, 2, '2026-09-20T15:30:00Z');
  const found = matchStreams(m, namer(m.home), namer(m.away), [
    stream('Фулхэм — Манчестер Юнайтед | запись', { status: 'finished' }),
    stream('Фулхэм — Манчестер Юнайтед | скоро', { status: 'upcoming' }),
    stream('Фулхэм — Манчестер Юнайтед | идёт', { status: 'started' }),
  ]);
  assert.deepEqual(found.map((s) => s.status), ['started', 'upcoming', 'finished']);
  assert.equal('teams' in found[0], false, 'служебные поля не уходят в ответ');
});
