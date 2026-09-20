// Главный процесс приложения: поднимает локальный сервер, читает эфиры VK своим же окном
// и показывает матч-центр. Настройки копируются в папку пользователя, чтобы их можно было править.
const { app, BrowserWindow, Menu, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const userConfig = path.join(app.getPath('userData'), 'config.json');
if (!fs.existsSync(userConfig)) fs.copyFileSync(path.join(ROOT, 'config.json'), userConfig);
process.env.MC_CONFIG = userConfig;

const load = (file) => import(pathToFileURL(path.join(ROOT, file)).href);

async function start() {
  const [{ config, startServer }, { startVkPoller }] = await Promise.all([
    load('server.mjs'), load('vk-electron.mjs'),
  ]);
  const vk = startVkPoller(config.channels, (config.vkRefreshSeconds || 120) * 1000);
  const server = await startServer(vk, 0); // 0 — свободный порт, чтобы не конфликтовать с `npm start`
  const { port } = server.address();

  const win = new BrowserWindow({
    width: 1100,
    height: 900,
    minWidth: 380,
    title: 'Матч-центр | Английский футбол',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: { partition: 'persist:app' },
  });
  // ссылки «Открыть в VK» и FotMob уходят в системный браузер, а не в новое окно приложения
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  // окна, в которых читаются каналы, скрыты, поэтому ориентируемся на главное
  win.on('closed', () => app.quit());
  await win.loadURL(`http://127.0.0.1:${port}`);
  return win;
}

// меню оставляем только с тем, что осмысленно: перезагрузка, масштаб, настройки
Menu.setApplicationMenu(Menu.buildFromTemplate([
  {
    label: 'Матч-центр',
    submenu: [
      { role: 'reload', label: 'Обновить' },
      { role: 'toggleDevTools', label: 'Инструменты разработчика' },
      { type: 'separator' },
      { label: 'Открыть настройки', click: () => shell.showItemInFolder(userConfig) },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Обычный масштаб' },
      { role: 'zoomIn', label: 'Крупнее' },
      { role: 'zoomOut', label: 'Мельче' },
      { type: 'separator' },
      { role: 'quit', label: 'Выход' },
    ],
  },
]));

app.whenReady().then(start);
