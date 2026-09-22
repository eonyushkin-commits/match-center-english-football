// Главный процесс: поднимает ядро матч-центра, показывает окно, уведомляет о трансляциях
// избранных команд и сам обновляется из GitHub Releases.
const { app, BrowserWindow, Menu, Notification, dialog, nativeTheme, net, screen, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_ID = 'ru.sportcenter.matchcenter';
const TITLE = 'Матч-центр | Английский футбол';
const load = (file) => import(pathToFileURL(path.join(__dirname, '..', file)).href);

// во внешний браузер отдаём только обычные веб-ссылки
function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

function fail(e) {
  dialog.showErrorBox('Матч-центр не запустился', String(e?.stack || e));
  app.exit(1);
}

// окно открывается там, где его закрыли, если этот монитор всё ещё подключён
function restoreBounds(saved) {
  const def = { width: 1180, height: 900 };
  if (!saved?.width || !saved?.height) return def;
  const visible = screen.getAllDisplays().some(({ workArea: a }) =>
    saved.x < a.x + a.width - 100 && saved.x + saved.width > a.x + 100 && saved.y >= a.y - 10 && saved.y < a.y + a.height - 100);
  return visible ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : { width: saved.width, height: saved.height };
}

// запуск из исходников не должен делить профиль с установленным приложением (и мешать ему)
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'Матч-центр (разработка)'));

let win = null;
let mc = null;
const notifications = new Set(); // держим ссылки, иначе на Windows клик по уведомлению теряется

async function start() {
  const [{ createMatchCenter }, { pageReader }] = await Promise.all([
    load('core/app.mjs'), load('electron/page-reader.mjs'),
  ]);
  mc = await createMatchCenter({
    dataDir: app.getPath('userData'),
    fetchImpl: net.fetch, // сетевой стек Chromium: системный прокси и сертификаты как в браузере
    pageReader,
    host: '127.0.0.1',
    port: 0,
    version: app.getVersion(),
  });

  const s = mc.settings.get();
  win = new BrowserWindow({
    ...restoreBounds(s.ui.window),
    minWidth: 380,
    minHeight: 480,
    show: false,
    title: TITLE,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e1116' : '#f3f5f8',
    autoHideMenuBar: true,
    // Сессия только в памяти: вход в VK внутри плеера не сохранится между запусками —
    // залогиненному пользователю VK отвечает на встроенные трансляции «Видео недоступно».
    // Тема, фильтры и избранное хранятся в настройках приложения, а не в браузере.
    webPreferences: { partition: 'matchcenter', spellcheck: false },
  });
  if (s.ui.window?.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(mc.url)) {
      e.preventDefault();
      openExternal(url);
    }
  });

  // размер и положение окна сохраняем перед закрытием, дождавшись записи на диск
  let saved = false;
  win.on('close', (e) => {
    if (saved) return;
    e.preventDefault();
    saved = true;
    const window = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    mc.settings.update({ ui: { window } }).catch(() => {}).finally(() => win.destroy());
  });
  win.on('closed', () => {
    win = null;
    app.quit();
  });

  mc.onStreamStart(({ date, match, stream }) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: `${match.home.name} — ${match.away.name}`,
      body: `Началась трансляция · ${stream.channel}`,
    });
    notifications.add(n);
    n.on('close', () => notifications.delete(n));
    n.on('click', () => {
      notifications.delete(n);
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.executeJavaScript(`window.mcOpenMatch?.(${JSON.stringify(date)}, ${Number(match.id)})`).catch(() => {});
    });
    n.show();
  });

  await win.loadURL(mc.url);
  setupUpdates();
}

// ---------- автообновление ----------
let updater = null;
function setupUpdates() {
  if (!app.isPackaged) return; // в разработке обновляться не из чего
  ({ autoUpdater: updater } = require('electron-updater'));
  updater.logger = null;
  const check = () => updater.checkForUpdatesAndNotify().catch(() => {});
  check();
  setInterval(check, 6 * 3600e3);
}

async function checkUpdatesNow() {
  if (!updater) {
    dialog.showMessageBox(win, { message: 'Обновления проверяются только в установленном приложении.' });
    return;
  }
  try {
    const r = await updater.checkForUpdates();
    const latest = r?.updateInfo?.version;
    const message = latest && latest !== app.getVersion()
      ? `Загружается версия ${latest}. Она установится при следующем закрытии приложения.`
      : `У вас последняя версия (${app.getVersion()}).`;
    dialog.showMessageBox(win, { message });
  } catch (e) {
    dialog.showMessageBox(win, { type: 'warning', message: 'Не удалось проверить обновления', detail: e.message });
  }
}

// ---------- меню ----------
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{
    label: 'Матч-центр',
    submenu: [
      { role: 'reload', label: 'Обновить страницу' },
      { label: 'Папка с настройками', click: () => shell.openPath(app.getPath('userData')) },
      { label: 'Проверить обновления', click: checkUpdatesNow },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Обычный масштаб' },
      { role: 'zoomIn', label: 'Крупнее' },
      { role: 'zoomOut', label: 'Мельче' },
      { type: 'separator' },
      { role: 'toggleDevTools', label: 'Инструменты разработчика' },
      { role: 'quit', label: 'Выход' },
    ],
  }]));
}

// ---------- запуск ----------
if (!app.requestSingleInstanceLock()) {
  app.quit(); // приложение уже открыто — второе окно не нужно, первое покажется само
} else {
  app.setAppUserModelId(APP_ID); // без этого Windows не показывает уведомления с названием приложения
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.on('window-all-closed', () => {}); // выходим по закрытию главного окна, скрытые окна чтения не в счёт
  app.on('before-quit', () => mc?.close());
  buildMenu();
  app.whenReady().then(start).catch(fail);
}
