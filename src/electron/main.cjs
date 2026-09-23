// Главный процесс: поднимает ядро матч-центра, показывает окно, живёт в трее, уведомляет о матчах
// избранных команд, открывает плеер в отдельных окнах и обновляется из GitHub Releases.
const {
  app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, nativeTheme, net, screen, shell,
} = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_ID = 'ru.sportcenter.matchcenter';
const TITLE = 'Матч-центр | Английский футбол';
const PRELOAD = path.join(__dirname, 'preload.cjs');
const ICON = path.join(__dirname, 'icon.png');
const RELEASES = 'https://github.com/eonyushkin-commits/match-center-english-football/releases';
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
let tray = null;
let quitting = false; // true — выходим по-настоящему, а не прячемся в трей
const startHidden = process.argv.includes('--hidden'); // автозапуск с Windows — сразу в трей
const notifications = new Set(); // держим ссылки, иначе на Windows клик по уведомлению теряется

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// Открыть матч из уведомления: показать окно и попросить страницу раскрыть матч (с плеером, если идёт эфир)
function openMatch(date, id) {
  showWindow();
  win?.webContents.send('open-match', { date, id });
}

function notify({ title, body, onClick }) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON });
  notifications.add(n);
  n.on('close', () => notifications.delete(n));
  n.on('click', () => {
    notifications.delete(n);
    onClick?.();
  });
  n.show();
}

// ---------- окно ----------
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
    icon: ICON,
    title: `${TITLE} · v${app.getVersion()}`,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e1116' : '#f3f5f8',
    autoHideMenuBar: true,
    // Сессия только в памяти: вход в VK внутри плеера не сохранится между запусками —
    // залогиненному пользователю VK отвечает на встроенные трансляции «Видео недоступно».
    // Тема, фильтры и избранное хранятся в настройках приложения, а не в браузере.
    webPreferences: { partition: 'matchcenter', spellcheck: false, preload: PRELOAD },
  });
  if (s.ui.window?.maximized) win.maximize();
  win.on('page-title-updated', (e) => e.preventDefault()); // заголовок с версией, а не <title> страницы
  win.once('ready-to-show', () => { if (!(startHidden && s.tray)) win.show(); });

  // Своя страница плеера открывается отдельным окном приложения, всё остальное — во внешнем браузере
  const playerPage = `${mc.url}/player.html`;
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(playerPage)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 800, height: 450, minWidth: 320, minHeight: 180, alwaysOnTop: true,
          backgroundColor: '#000000', autoHideMenuBar: true, icon: ICON,
          // мост с приложением («Поверх окон») сам в новое окно не переходит
          webPreferences: { partition: 'matchcenter', preload: PRELOAD },
        },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', (child) => {
    child.setMenuBarVisibility(false);
    child.setAspectRatio(16 / 9);
    child.webContents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: 'deny' };
    });
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(mc.url)) {
      e.preventDefault();
      openExternal(url);
    }
  });

  // размер и положение сохраняем по ходу дела — закрытию окна ничего ждать не нужно
  let boundsTimer = null;
  const saveBounds = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      mc.settings.update({ ui: { window: { ...win.getNormalBounds(), maximized: win.isMaximized() } } }).catch(() => {});
    }, 800);
  };
  for (const event of ['resize', 'move', 'maximize', 'unmaximize']) win.on(event, saveBounds);

  // Закрытие окна при включённом трее прячет его: так продолжают приходить уведомления
  win.on('close', (e) => {
    if (quitting || !mc.settings.get().tray) return;
    e.preventDefault();
    win.hide();
    if (!mc.settings.get().ui.trayHintShown) {
      notify({ title: 'Матч-центр работает в трее', body: 'Уведомления о матчах избранных команд продолжат приходить. Выйти — правой кнопкой по значку в трее.', onClick: showWindow });
      mc.settings.update({ ui: { trayHintShown: true } }).catch(() => {});
    }
  });
  win.on('closed', () => {
    win = null;
    quitting = true;
    app.quit();
  });

  mc.onNotify(({ kind, date, match }) => {
    const title = `${match.home.name} — ${match.away.name}`;
    const minutes = Math.max(1, Math.round((Date.parse(match.utcTime) - Date.now()) / 60e3));
    const live = match.streams.find((x) => x.status === 'started');
    const body = kind === 'soon' ? `Начало через ${minutes} мин` : `Матч начался${live ? ` · смотреть: ${live.channel}` : ''}`;
    notify({ title, body, onClick: () => openMatch(date, match.id) });
  });

  mc.settings.on('change', applyAppSettings);
  applyAppSettings(mc.settings.get());

  await win.loadURL(mc.url);
  setupUpdates();
}

// ---------- трей и автозапуск ----------
function applyAppSettings(s) {
  if (s.tray && !tray) {
    const image = nativeImage.createFromPath(ICON);
    tray = new Tray(image.resize({ width: 16, height: 16, quality: 'best' }));
    tray.setToolTip('Матч-центр');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Открыть Матч-центр', click: showWindow },
      { type: 'separator' },
      { label: 'Выход', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', showWindow);
  } else if (!s.tray && tray) {
    tray.destroy();
    tray = null;
  }
  // автозапуск прописывается только у установленного приложения; скрыто — если есть трей, где жить
  const login = JSON.stringify([s.autostart, s.tray]);
  if (app.isPackaged && login !== appliedLogin) {
    appliedLogin = login;
    app.setLoginItemSettings({ openAtLogin: s.autostart, args: s.tray ? ['--hidden'] : [] });
  }
}
let appliedLogin = null;

// ---------- обновление в два шага: «Скачать» → «Установить» ----------
let updater = null;
let update = { state: 'none' }; // none | available | downloading | ready | error

function setUpdate(next) {
  update = next;
  win?.webContents.send('update', update);
}

function setupUpdates() {
  if (!app.isPackaged) return; // в разработке обновляться не из чего
  ({ autoUpdater: updater } = require('electron-updater'));
  updater.logger = null;
  updater.autoDownload = false; // качаем только по кнопке
  updater.autoInstallOnAppQuit = true; // скачали, но не нажали «Установить» — поставится при выходе
  updater.on('update-available', (info) => {
    if (update.state !== 'downloading' && update.state !== 'ready') setUpdate({ state: 'available', version: info.version, notes: `${RELEASES}/tag/v${info.version}` });
  });
  updater.on('download-progress', (p) => setUpdate({ ...update, state: 'downloading', percent: Math.floor(p.percent) }));
  updater.on('update-downloaded', (info) => setUpdate({ state: 'ready', version: info.version, notes: `${RELEASES}/tag/v${info.version}` }));
  updater.on('error', (e) => {
    if (update.state === 'downloading') setUpdate({ ...update, state: 'error', error: e.message });
  });
  const check = () => updater.checkForUpdates().catch(() => {}); // нет сети — проверим в следующий раз
  check();
  setInterval(check, 6 * 3600e3);
}

ipcMain.handle('update:get', () => update);
ipcMain.handle('update:download', () => {
  if (!updater || !['available', 'error'].includes(update.state)) return;
  setUpdate({ ...update, state: 'downloading', percent: 0 });
  updater.downloadUpdate().catch(() => {}); // ошибку сообщит событие 'error'
});
ipcMain.handle('update:install', () => {
  if (update.state !== 'ready') return;
  quitting = true;
  updater.quitAndInstall(true, true); // тихо поставить и сразу открыть новую версию
});
ipcMain.handle('player:on-top', (e, value) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && w !== win) w.setAlwaysOnTop(!!value);
  return w?.isAlwaysOnTop();
});

async function checkUpdatesNow() {
  if (!updater) {
    dialog.showMessageBox(win, { message: 'Обновления проверяются только в установленном приложении.' });
    return;
  }
  try {
    const r = await updater.checkForUpdates();
    const latest = r?.updateInfo?.version;
    if (!latest || latest === app.getVersion()) dialog.showMessageBox(win, { message: `У вас последняя версия (${app.getVersion()}).` });
    else showWindow(); // о новой версии скажет полоса в окне
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
      { label: 'Выход', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } },
    ],
  }]));
}

// ---------- запуск ----------
if (!app.requestSingleInstanceLock()) {
  app.quit(); // приложение уже открыто — второе окно не нужно, первое покажется само
} else {
  app.setAppUserModelId(APP_ID); // без этого Windows не показывает уведомления с названием приложения
  app.on('second-instance', showWindow);
  app.on('window-all-closed', () => {}); // выходим только по «Выход»: главное окно прячется в трей
  app.on('before-quit', () => {
    quitting = true;
    mc?.close();
  });
  buildMenu();
  app.whenReady().then(start).catch(fail);
}
