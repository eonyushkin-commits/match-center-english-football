import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { dataDir } = createRequire(import.meta.url)('../src/electron/data-dir.cjs');

function appData(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mc-data-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const put = (dir, file, text) => {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), text);
};

test('dataDir: папка на латинице, у запуска из исходников — своя', (t) => {
  const root = appData(t);
  assert.equal(dataDir(root, true), path.join(root, 'MatchCenter'));
  assert.equal(dataDir(root, false), path.join(root, 'MatchCenter-dev'));
});

test('dataDir: прежняя папка «Матч-центр» переезжает целиком', (t) => {
  const root = appData(t);
  put(root, 'Матч-центр/settings.json', '{"tray":false}');
  put(root, 'Матч-центр/Partitions/matchcenter/Cookies', 'vk');
  const dir = dataDir(root, true);
  assert.equal(readFileSync(path.join(dir, 'settings.json'), 'utf8'), '{"tray":false}');
  assert.equal(readFileSync(path.join(dir, 'Partitions/matchcenter/Cookies'), 'utf8'), 'vk');
  assert.equal(existsSync(path.join(root, 'Матч-центр')), false);
});

test('dataDir: уже переехавшую папку прежняя не затирает', (t) => {
  const root = appData(t);
  put(root, 'MatchCenter/settings.json', 'new');
  put(root, 'Матч-центр/settings.json', 'old');
  assert.equal(readFileSync(path.join(dataDir(root, true), 'settings.json'), 'utf8'), 'new');
  assert.equal(existsSync(path.join(root, 'Матч-центр')), true);
});

test('dataDir: папка разработки переезжает отдельно от установленной', (t) => {
  const root = appData(t);
  put(root, 'Матч-центр (разработка)/settings.json', 'dev');
  put(root, 'Матч-центр/settings.json', 'app');
  assert.equal(readFileSync(path.join(dataDir(root, false), 'settings.json'), 'utf8'), 'dev');
  assert.equal(existsSync(path.join(root, 'Матч-центр')), true);
});
