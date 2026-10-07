// Папка данных приложения — на латинице: %APPDATA%\MatchCenter. Раньше она называлась
// «Матч-центр»: при первом запуске прежняя папка переименовывается целиком, так что настройки,
// избранное и вход в VK сохраняются. У запуска из исходников папка своя (см. main.cjs).
const fs = require('node:fs');
const path = require('node:path');

const NAMES = {
  packaged: ['MatchCenter', 'Матч-центр'],
  dev: ['MatchCenter-dev', 'Матч-центр (разработка)'],
};

function dataDir(appData, packaged) {
  const [name, oldName] = packaged ? NAMES.packaged : NAMES.dev;
  const dir = path.join(appData, name);
  const old = path.join(appData, oldName);
  if (!fs.existsSync(dir) && fs.existsSync(old)) {
    try {
      fs.renameSync(old, dir);
    } catch {
      // прежняя папка занята — забираем хотя бы настройки
      fs.mkdirSync(dir, { recursive: true });
      try {
        fs.copyFileSync(path.join(old, 'settings.json'), path.join(dir, 'settings.json'));
      } catch {}
    }
  }
  return dir;
}

module.exports = { dataDir };
