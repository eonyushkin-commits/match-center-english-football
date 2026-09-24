import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createHandler, startServer } from '../src/core/server.mjs';
import { openSettings } from '../src/core/settings.mjs';

let srv;
let base;

const fm = {
  leagues: [
    { id: 47, name: 'Premier League', ccode: 'ENG', matches: [{
      id: 100, home: { id: 1, name: 'Fulham', score: 1 }, away: { id: 2, name: 'Man United', score: 1 },
      status: { utcTime: '2026-09-20T15:30:00Z', started: true, finished: false, liveTime: { short: '67’' } },
    }] },
    { id: 55, name: 'Serie A', ccode: 'ITA', matches: [] },
  ],
};
const ru = { Participants: { 1: 'Фулхэм', 2: 'Манчестер Юнайтед' }, TournamentTemplates: { 47: 'Премьер-Лига' }, CountryCodes: { ENG: 'Англия' } };
const snapshot = {
  ready: true, updatedAt: 1, channels: [],
  streams: [{ title: 'Фулхэм — Манчестер Юнайтед', teams: ['фулхэм', 'манчестер юнайтед'], status: 'started', time: null, url: 'u', embed: 'e', channel: 'X' }],
};

before(async () => {
  const settings = await openSettings(await mkdtemp(path.join(os.tmpdir(), 'mc-server-')));
  const handler = createHandler({
    settings,
    poller: { snapshot: () => snapshot, refresh() {} },
    fotmob: { day: async () => fm, names: async () => ru },
    version: 'test',
  });
  ({ server: srv, url: base } = await startServer(handler, { host: '127.0.0.1', port: 0 }));
});
after(() => srv.close());

test('/api/day: только турниры из настроек, русские названия, привязанный эфир', async () => {
  const j = await (await fetch(`${base}/api/day?date=20260920&tz=Europe/Moscow`)).json();
  assert.equal(j.leagues.length, 1);
  assert.equal(j.leagues[0].name, 'Премьер-Лига');
  const m = j.leagues[0].matches[0];
  assert.equal(m.home.name, 'Фулхэм');
  assert.equal(m.liveTime, '67’');
  assert.deepEqual(m.streams.map((s) => s.url), ['u']);
});

test('/api/day: неверные параметры — 400, а не падение', async () => {
  assert.equal((await fetch(`${base}/api/day?date=2026-09-20`)).status, 400);
  assert.equal((await fetch(`${base}/api/day?date=20260920&tz=Mars/Olympus`)).status, 400);
});

test('/api/settings: сохранение и проверка входных данных', async () => {
  const put = (body, type = 'application/json') => fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'Content-Type': type }, body });
  const ok = await put(JSON.stringify({ favorites: [{ id: 1, name: 'Фулхэм' }] }));
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).favorites, [{ id: 1, name: 'Фулхэм' }]);
  assert.equal((await put('{"leagues": []}')).status, 400);
  assert.equal((await put('not json')).status, 400);
  assert.equal((await put('{}', 'text/plain')).status, 415, 'форма с чужой страницы не пройдёт');
  const day = await (await fetch(`${base}/api/day?date=20260920&tz=UTC`)).json();
  assert.equal(day.leagues[0].matches[0].favorite, true);
});

test('чужой Host отклоняется (защита от подмены DNS)', async () => {
  const { port } = new URL(base);
  const r = await new Promise((resolve, reject) => {
    import('node:http').then(({ request }) => {
      request({ host: '127.0.0.1', port, path: '/api/settings', headers: { Host: 'evil.example' } }, resolve).on('error', reject).end();
    });
  });
  assert.equal(r.statusCode, 403);
});

test('страница отдаётся с CSP, лишние пути — 404', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-src https:\/\/vkvideo\.ru/);
  assert.equal((await fetch(`${base}/../package.json`)).status, 404);
  assert.equal((await fetch(`${base}/src/core/settings.mjs`)).status, 404);
});

test('отдаются все модули, которые импортирует страница', async () => {
  const web = new URL('../src/web/', import.meta.url);
  const files = (await readdir(web)).filter((f) => /\.m?js$/.test(f));
  const wanted = new Set(['app.js']);
  for (const f of files)
    for (const [, dep] of (await readFile(new URL(f, web), 'utf8')).matchAll(/from '\.\/([\w-]+\.mjs)'/g)) wanted.add(dep);
  for (const f of wanted) {
    const r = await fetch(`${base}/${f}`);
    assert.equal(r.status, 200, f);
    assert.match(r.headers.get('content-type'), /^text\/javascript/, f);
  }
});
