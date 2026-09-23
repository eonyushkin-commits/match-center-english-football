// Настройки = встроенные значения (defaults.json) + отличия пользователя (settings.json).
// У пользователя хранятся только отличия, поэтому каналы и алиасы из новых версий доходят
// до всех сами. Правятся настройки из приложения; сломанный файл не мешает запуску.
import { EventEmitter } from 'node:events';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const defaults = JSON.parse(await readFile(new URL('./defaults.json', import.meta.url), 'utf8'));

const SCREEN_NAME = /^[\w.-]{2,64}$/;
const THEMES = ['system', 'light', 'dark'];
const FILTERS = ['streams', 'live', 'favorites'];

function clamp(n, lo, hi, fallback) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
}

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 });
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// Итоговые настройки, с которыми работает приложение
export function resolve(user = {}) {
  const channels = new Map(defaults.channels.map((c) =>
    [c.screenName, { screenName: c.screenName, label: c.label, enabled: true, builtIn: true }]));
  for (const c of Array.isArray(user.channels) ? user.channels : []) {
    if (!SCREEN_NAME.test(c?.screenName || '')) continue;
    const base = channels.get(c.screenName);
    channels.set(c.screenName, {
      screenName: c.screenName,
      label: c.label || base?.label || c.screenName,
      enabled: !c.disabled,
      builtIn: !!base,
    });
  }

  const userAliases = isAliasMap(user.teamAliases) ? user.teamAliases : {};
  const teamAliases = {};
  for (const src of [defaults.teamAliases, userAliases])
    for (const [team, names] of Object.entries(src))
      teamAliases[team] = [...new Set([...(teamAliases[team] || []), ...names])];

  const ui = user.ui && typeof user.ui === 'object' ? user.ui : {};
  return {
    channels: [...channels.values()],
    leagues: Array.isArray(user.leagues) && user.leagues.length ? user.leagues : defaults.leagues,
    teamAliases,
    userAliases,
    favorites: Array.isArray(user.favorites) ? user.favorites : [],
    favoriteMatches: freshMatches(user.favoriteMatches), // отдельные матчи с напоминанием
    refreshSeconds: clamp(user.refreshSeconds, 30, 600, defaults.refreshSeconds),
    notifications: typeof user.notifications === 'boolean' ? user.notifications : defaults.notifications,
    tray: typeof user.tray === 'boolean' ? user.tray : defaults.tray, // закрытие окна сворачивает в трей
    autostart: typeof user.autostart === 'boolean' ? user.autostart : defaults.autostart, // запуск вместе с Windows
    ui: {
      theme: THEMES.includes(ui.theme) ? ui.theme : 'system',
      filters: Object.fromEntries(FILTERS.map((f) => [f, !!ui.filters?.[f]])),
      hideScores: !!ui.hideScores, // режим без спойлеров
      trayHintShown: !!ui.trayHintShown,
      window: ui.window && typeof ui.window === 'object' ? ui.window : null,
    },
  };
}

// Отмеченные матчи нужны только до начала: через сутки после него запись больше не нужна
function freshMatches(list, now = Date.now()) {
  return (Array.isArray(list) ? list : [])
    .filter((m) => Number.isInteger(m?.id) && !(Date.parse(m.utcTime) < now - 24 * 3600e3))
    .map((m) => ({ id: m.id, name: String(m.name || '').slice(0, 120), utcTime: String(m.utcTime || '') }));
}

function isAliasMap(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
    && Object.values(v).every((names) => Array.isArray(names) && names.every((n) => typeof n === 'string'));
}

// Изменения из приложения (в виде итоговых настроек) → новые отличия пользователя
export function applyPatch(user, patch) {
  if (!patch || typeof patch !== 'object') throw invalid('Ожидался объект настроек');
  const next = { ...user };

  if (patch.channels !== undefined) {
    if (!Array.isArray(patch.channels)) throw invalid('channels: ожидался список');
    const builtIn = new Map(defaults.channels.map((c) => [c.screenName, c]));
    const seen = new Set();
    const list = [];
    for (const c of patch.channels) {
      const screenName = String(c?.screenName || '').trim();
      if (!SCREEN_NAME.test(screenName)) throw invalid(`Неверное имя канала: «${screenName}»`);
      if (seen.has(screenName)) continue;
      seen.add(screenName);
      const label = String(c.label || '').trim().slice(0, 60);
      const base = builtIn.get(screenName);
      const entry = { screenName };
      if (!base) entry.label = label || screenName;
      else if (label && label !== base.label) entry.label = label;
      if (c.enabled === false) entry.disabled = true;
      if (!base || entry.label || entry.disabled) list.push(entry);
    }
    // встроенный канал, которого нет в списке, пользователь убрал — запоминаем как выключенный
    for (const screenName of builtIn.keys())
      if (!seen.has(screenName)) list.push({ screenName, disabled: true });
    next.channels = list.length ? list : undefined;
  }

  if (patch.leagues !== undefined) {
    if (!Array.isArray(patch.leagues)) throw invalid('leagues: ожидался список');
    const ids = [...new Set(patch.leagues.map(Number))].filter((n) => Number.isInteger(n) && n > 0);
    if (!ids.length) throw invalid('Выберите хотя бы один турнир');
    next.leagues = sameList(ids, defaults.leagues) ? undefined : ids;
  }

  if (patch.userAliases !== undefined) {
    if (!isAliasMap(patch.userAliases)) throw invalid('Написания команд: ожидались списки строк');
    const clean = Object.fromEntries(Object.entries(patch.userAliases)
      .map(([team, names]) => [team.trim(), names.map((n) => n.trim()).filter(Boolean)])
      .filter(([team, names]) => team && names.length));
    next.teamAliases = Object.keys(clean).length ? clean : undefined;
  }

  if (patch.favorites !== undefined) {
    if (!Array.isArray(patch.favorites)) throw invalid('favorites: ожидался список');
    next.favorites = patch.favorites
      .filter((f) => Number.isInteger(f?.id))
      .map((f) => ({ id: f.id, name: String(f.name || '').slice(0, 80) }));
  }

  if (patch.favoriteMatches !== undefined) {
    if (!Array.isArray(patch.favoriteMatches)) throw invalid('favoriteMatches: ожидался список');
    const list = freshMatches(patch.favoriteMatches);
    next.favoriteMatches = list.length ? list : undefined;
  }

  if (patch.refreshSeconds !== undefined) {
    const v = clamp(patch.refreshSeconds, 30, 600, defaults.refreshSeconds);
    next.refreshSeconds = v === defaults.refreshSeconds ? undefined : v;
  }

  for (const key of ['notifications', 'tray', 'autostart'])
    if (patch[key] !== undefined) next[key] = !!patch[key];

  if (patch.ui !== undefined) {
    const ui = { ...(user.ui || {}) };
    if (THEMES.includes(patch.ui.theme)) ui.theme = patch.ui.theme;
    if (patch.ui.filters) ui.filters = Object.fromEntries(FILTERS.map((f) => [f, !!patch.ui.filters[f]]));
    for (const key of ['hideScores', 'trayHintShown'])
      if (patch.ui[key] !== undefined) ui[key] = !!patch.ui[key];
    if (patch.ui.window && typeof patch.ui.window === 'object') {
      const { x, y, width, height, maximized } = patch.ui.window;
      ui.window = { x, y, width, height, maximized: !!maximized };
    }
    next.ui = ui;
  }

  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  return next;
}

// Перенос config.json первой версии: забираем только то, что пользователь действительно менял.
// Каналов, добавленных в новых версиях, в старой копии нет — это не значит, что их выключили.
export async function migrateV1(file) {
  let old;
  try {
    old = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
  const out = {};
  const builtIn = new Set(defaults.channels.map((c) => c.screenName));
  const channels = (Array.isArray(old.channels) ? old.channels : [])
    .filter((c) => SCREEN_NAME.test(c?.screenName || '') && (!builtIn.has(c.screenName) || c.disabled))
    .map((c) => ({
      screenName: c.screenName,
      ...(builtIn.has(c.screenName) ? {} : { label: c.label || c.screenName }),
      ...(c.disabled ? { disabled: true } : {}),
    }));
  if (channels.length) out.channels = channels;
  if (Array.isArray(old.leagues) && old.leagues.length && !sameList(old.leagues, defaults.leagues)) out.leagues = old.leagues;
  if (isAliasMap(old.teamAliases)) {
    const extra = {};
    for (const [team, names] of Object.entries(old.teamAliases)) {
      const known = new Set(defaults.teamAliases[team] || []);
      const added = names.filter((n) => !known.has(n));
      if (added.length) extra[team] = added;
    }
    if (Object.keys(extra).length) out.teamAliases = extra;
  }
  const refresh = Number(old.vkRefreshSeconds);
  // 120 — старое значение по умолчанию, его не переносим
  if (refresh && refresh !== 120 && refresh !== defaults.refreshSeconds) out.refreshSeconds = refresh;
  return out;
}

export async function openSettings(dir) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'settings.json');
  const warnings = [];
  let user;
  let queue = Promise.resolve();

  async function write(data) {
    const tmp = `${file}.tmp`;
    await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
    await rename(tmp, file); // целиком или никак — файл не останется наполовину записанным
  }

  try {
    user = JSON.parse(await readFile(file, 'utf8'));
    if (!user || typeof user !== 'object' || Array.isArray(user)) throw new Error('ожидался объект');
  } catch (e) {
    if (e.code === 'ENOENT') {
      user = (await migrateV1(path.join(dir, 'config.json'))) || {};
      await write(user);
    } else {
      const backup = file.replace(/\.json$/, `.broken-${Date.now()}.json`);
      await copyFile(file, backup).catch(() => {});
      warnings.push(`Файл настроек повреждён (${e.message}), используются настройки по умолчанию. Копия: ${backup}`);
      user = {};
    }
  }

  let resolved = resolve(user);
  const events = new EventEmitter();
  return Object.assign(events, {
    file,
    warnings,
    get: () => resolved,
    async update(patch) {
      const next = applyPatch(user, patch);
      const prev = resolved;
      user = next;
      resolved = resolve(user);
      queue = queue.catch(() => {}).then(() => write(user));
      await queue;
      warnings.length = 0; // файл перезаписан целым — предупреждение о поломке больше не актуально
      events.emit('change', resolved, prev);
      return resolved;
    },
  });
}
