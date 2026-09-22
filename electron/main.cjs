// Главный процесс приложения: поднимает локальный сервер, читает эфиры VK своим же окном
// и показывает матч-центр. Настройки копируются в папку пользователя, чтобы их можно было править.
const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const userConfig = path.join(app.getPath('userData'), 'config.json');
if (!fs.existsSync(userConfig)) fs.copyFileSync(path.join(ROOT, 'config.json'), userConfig);
process.env.MC_CONFIG = userConfig;

const load = (file) => import(pathToFileURL(path.join(ROOT, file)).href);

// Плеер VK встроен в окно приложения и делит с ним сессию. Если войти в VK внутри плеера,
// VK начинает отвечать «Видео недоступно» на встроенные трансляции. Поэтому при запуске
// забываем всё, что сохранил VK, — плеер снова открывается как у анонимного зрителя.
const VK_DOMAIN = /(^|\.)(vk\.com|vk\.ru|vkvideo\.ru|vkuser\.net|okcdn\.ru|vk-portal\.net|mail\.ru)$/;
const VK_ORIGINS = ['https://vkvideo.ru', 'https://vk.com', 'https://vk.ru', 'https://login.vk.com',
  'https://login.vk.ru', 'https://id.vk.com', 'https://id.vk.ru'];

async function forgetVk(ses) {
  const cookies = (await ses.cookies.get({})).filter((c) => VK_DOMAIN.test(c.domain.replace(/^\./, '')));
  await Promise.all(cookies.map((c) =>
    ses.cookies.remove(`https://${c.domain.replace(/^\./, '')}${c.path}`, c.name)));
  await Promise.all(VK_ORIGINS.map((origin) => ses.clearStorageData({ origin })));
}

async function start() {
  await forgetVk(session.fromPartition('persist:app'));
  const [{ config, startServer }, { startVkPoller }] = await Promise.all([
    load('server.mjs'), load('vk-electron.mjs'),
  ]);
  const vk = startVkPoller(config.channels, (config.vkRefreshSeconds || 120) * 1000);
  // 0 — свободный порт, чтобы не конфликтовать с `npm start`; только локально — сеть не нужна,
  // и Windows не спрашивает разрешение брандмауэра
  const server = await startServer(vk, 0, '127.0.0.1');
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

// без окна приложение осталось бы висеть невидимым процессом (например, при опечатке в config.json)
app.whenReady().then(start).catch((e) => {
  dialog.showErrorBox('Матч-центр не запустился', `${e.message}\n\nНастройки: ${userConfig}`);
  app.quit();
});
