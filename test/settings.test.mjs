import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { applyPatch, defaults, openSettings, resolve } from '../src/core/settings.mjs';

const tmp = () => mkdtemp(path.join(os.tmpdir(), 'mc-settings-'));

test('без файла — встроенные настройки', () => {
  const s = resolve({});
  assert.equal(s.channels.length, defaults.channels.length);
  assert.ok(s.channels.every((c) => c.enabled && c.builtIn));
  assert.deepEqual(s.leagues, defaults.leagues);
  assert.equal(s.ui.theme, 'system');
});

test('у пользователя хранятся только отличия', () => {
  const all = resolve({}).channels;
  const user = applyPatch({}, {
    channels: [
      ...all.filter((c) => c.screenName !== 'pl_forever'), // встроенный убран
      { screenName: 'my_channel', label: 'Мой канал', enabled: true },
    ].map((c) => (c.screenName === 'englishaccent' ? { ...c, enabled: false } : c)),
    leagues: defaults.leagues,
    refreshSeconds: defaults.refreshSeconds,
  });
  assert.deepEqual(user, {
    channels: [
      { screenName: 'englishaccent', disabled: true },
      { screenName: 'my_channel', label: 'Мой канал' },
      { screenName: 'pl_forever', disabled: true },
    ],
  });
  const s = resolve(user);
  assert.deepEqual(s.channels.filter((c) => c.enabled).map((c) => c.screenName), ['sportcast.online', 'vishli_football', 'my_channel']);
});

test('новый встроенный канал доходит до пользователя со старыми настройками', () => {
  const s = resolve({ channels: [{ screenName: 'my_channel', label: 'Мой' }] });
  assert.ok(s.channels.some((c) => c.screenName === 'vishli_football' && c.enabled));
});

test('алиасы пользователя добавляются к встроенным', () => {
  const s = resolve({ teamAliases: { 'Манчестер Сити': ['Горожане'], 'Рексем': ['Wrexham'] } });
  assert.deepEqual(s.teamAliases['Манчестер Сити'], ['Ман Сити', 'Горожане']);
  assert.deepEqual(s.teamAliases['Рексем'], ['Wrexham']);
});

test('неверные значения отклоняются с понятной ошибкой', () => {
  assert.throws(() => applyPatch({}, { channels: [{ screenName: 'bad name!' }] }), { status: 400, message: /Неверное имя канала/ });
  assert.throws(() => applyPatch({}, { leagues: [] }), { status: 400 });
  assert.equal(applyPatch({}, { refreshSeconds: 5 }).refreshSeconds, 30);
});

test('сломанный файл не мешает запуску, копия сохраняется', async () => {
  const dir = await tmp();
  await writeFile(path.join(dir, 'settings.json'), '{ "leagues": [47, }');
  const settings = await openSettings(dir);
  assert.deepEqual(settings.get().leagues, defaults.leagues);
  assert.equal(settings.warnings.length, 1);
  assert.ok((await readdir(dir)).some((f) => f.startsWith('settings.broken-')));
  await settings.update({ ui: { theme: 'dark' } });
  assert.equal(settings.warnings.length, 0);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'settings.json'), 'utf8')).ui.theme, 'dark');
});

test('update сохраняет на диск и сообщает об изменении', async () => {
  const dir = await tmp();
  const settings = await openSettings(dir);
  let changed = null;
  settings.on('change', (next) => { changed = next; });
  await settings.update({ favorites: [{ id: 10260, name: 'Манчестер Юнайтед' }], ui: { filters: { live: true } } });
  assert.deepEqual(changed.favorites, [{ id: 10260, name: 'Манчестер Юнайтед' }]);
  const reopened = await openSettings(dir);
  assert.equal(reopened.get().ui.filters.live, true);
  assert.equal(reopened.get().favorites[0].id, 10260);
});

test('трей, автозапуск и режим без спойлеров', () => {
  const s = resolve({});
  assert.deepEqual([s.tray, s.autostart, s.ui.hideScores], [true, false, false], 'по умолчанию: трей есть, автозапуска нет');
  const user = applyPatch({}, { tray: false, autostart: true, ui: { hideScores: true } });
  const r = resolve(user);
  assert.deepEqual([r.tray, r.autostart, r.ui.hideScores], [false, true, true]);
  assert.equal(resolve(applyPatch(user, { ui: { theme: 'dark' } })).ui.hideScores, true, 'другие правки интерфейса его не сбрасывают');
});

test('отмеченные матчи хранятся до суток после начала', () => {
  const soon = new Date(Date.now() + 3600e3).toISOString();
  const long = new Date(Date.now() - 3 * 24 * 3600e3).toISOString();
  const user = applyPatch({}, { favoriteMatches: [
    { id: 1, name: 'Фулхэм — Манчестер Юнайтед', utcTime: soon },
    { id: 2, name: 'Давно прошедший', utcTime: long },
    { id: 'x', name: 'без номера' },
  ] });
  assert.deepEqual(user.favoriteMatches.map((m) => m.id), [1]);
  assert.deepEqual(resolve({ favoriteMatches: [{ id: 2, name: 'старый', utcTime: long }] }).favoriteMatches, []);
  assert.equal(applyPatch(user, { favoriteMatches: [] }).favoriteMatches, undefined, 'пустой список не хранится');
});
