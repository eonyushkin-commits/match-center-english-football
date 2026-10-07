// Проверки в настоящем приложении: главный процесс как есть, сеть подставная, профиль временный.
// Запуск: npm run smoke (scripts/smoke.mjs передаёт --user-data-dir и --smoke-out).
const { app, BrowserWindow, net, session, shell } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { create: fakeNet } = require('./fake-net.cjs');

const OUT = app.commandLine.getSwitchValue('smoke-out');
const results = [];
const save = (extra = {}) => fs.writeFileSync(OUT, JSON.stringify({ results, ...extra }, null, 1));

const external = []; // что приложение хотело открыть в браузере
shell.openExternal = async (url) => { external.push(url); };
const fake = fakeNet();
net.fetch = fake;
// окно, закрытое другими окнами, Chromium считает скрытым — проверкам это мешает
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// турнир, добавленный по номеру; подсказку про трей не показываем — это настоящее уведомление Windows
fs.mkdirSync(app.getPath('userData'), { recursive: true });
fs.writeFileSync(path.join(app.getPath('userData'), 'settings.json'), JSON.stringify({ leagues: [47, 48, 338], ui: { trayHintShown: true } }));
require('../../src/electron/main.cjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (w, code) => w.webContents.executeJavaScript(`(async () => (${code}))()`);
async function until(what, check, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await check()) return;
  throw new Error(`не дождались: ${what}`);
}
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: e.message.split('\n')[0] });
  }
  save();
}

app.on('quit', () => save({ quit: true }));
app.whenReady().then(async () => {
  // сколько раз страница подписывалась на ленту
  let subscriptions = 0;
  session.fromPartition('matchcenter').webRequest.onBeforeRequest((d, cb) => {
    if (d.url.includes('/api/events')) subscriptions++;
    cb({});
  });
  let win;
  await until('главное окно', () => (win = BrowserWindow.getAllWindows()[0]) && !win.webContents.isLoading() && win.webContents.getURL().startsWith('http'));
  const page = (code) => js(win, code);
  const on = (code, what, ms) => until(what || code, () => page(code), ms);
  const click = (selector) => page(`document.querySelector(${JSON.stringify(selector)}).click(), true`);
  const players = () => BrowserWindow.getAllWindows().filter((w) => w !== win);
  const frame = (w = win) => js(w, `document.querySelector('iframe')?.src ?? null`);

  await step('запуск в трей: окно скрыто, страница не подписана на ленту', async () => {
    await sleep(1500);
    assert.equal(win.isVisible(), false);
    assert.equal(await page('document.hidden'), true);
    assert.equal(subscriptions, 0);
  });

  await step('показ окна: расписание загружено, идущий матч — в блоке «Идут сейчас»', async () => {
    win.showInactive();
    await on(`document.querySelectorAll('[data-key^="m:"]').length === 3`, 'три матча в списке');
    assert.equal(subscriptions, 1);
    // каналы дочитываются позже расписания: эфиры появляются сами, без запроса со страницы
    await on(`/эфиров/.test(document.querySelector('#status-text').textContent)`, 'статус каналов');
    await on(`!!document.querySelector('[data-key="m:101"] .stream[data-play]')`, 'эфиры у матча');
    assert.ok(await page(`!!document.querySelector('[data-key="live"] [data-key="live:101"]')`));
    assert.equal(await page(`document.querySelector('[data-key="m:101"] .name').textContent`), 'Арсенал');
  });

  // каналы перечитываются раз в минуту, так что за несколько секунд новый эфир покажет только кнопка
  const streamsOf103 = (n) => on(`document.querySelectorAll('[data-key="m:103"] .stream[data-play]').length === ${n}`, `эфиров у матча 103: ${n}`, 6000);

  await step('кнопка ↻: каналы перечитываются, новый эфир появляется сразу', async () => {
    fake.addStream('englishaccent', 1);
    fake.addStream('pl_forever', 2);
    await click('#refresh');
    await streamsOf103(2);
    await on(`!document.querySelector('#refresh').classList.contains('spin')`, 'значок перестал крутиться');
  });

  await step('идущий эфир: плеер в строке матча, события под ним', async () => {
    await click('[data-key="live:101"] .stream[data-play]');
    await on(`!!document.querySelector('.player iframe')`, 'плеер');
    assert.match(await frame(), /^https:\/\/vkvideo\.ru\/video_ext\.php\?oid=-1&id=1&/);
    await on(`document.querySelectorAll('.details .ev').length > 0`, 'события матча');
  });

  await step('другой канал того же матча: плеер переключается на месте', async () => {
    await click('[data-key="live:101"] .stream[data-play]:not(.active)');
    await until('эфир второго канала', async () => /oid=-2&id=1&/.test(await frame()));
    assert.equal(await page(`document.querySelectorAll('.player').length`), 1);
  });

  await step('«В окне»: эфир уходит в отдельное окно, кнопка «События и составы» остаётся в строке', async () => {
    await click('.player .popout');
    await until('окно плеера', () => players().length === 1 && !players()[0].webContents.isLoading());
    assert.match(await frame(players()[0]), /oid=-2&id=1&/);
    assert.match(players()[0].getTitle() + await js(players()[0], 'document.title'), /Арсенал — Челси · АПЛ Навсегда/);
    await on(`!document.querySelector('.player.open')`, 'плеер в строке закрыт');
    const toggle = '.popbar [data-details="live:101"]';
    assert.equal(await page(`document.querySelector(${JSON.stringify(toggle)}).getAttribute('aria-expanded')`), 'true');
    await click(toggle);
    await on(`!document.querySelector('.details')`, 'события свёрнуты');
    await click(toggle);
    await on(`!!document.querySelector('.details')`, 'события раскрыты');
  });

  await step('запись: открывается с начала', async () => {
    await click('[data-key="m:102"] .stream[data-play]');
    await until('плеер записи', async () => /oid=-1&id=2&/.test(await frame() || ''));
    assert.match(await frame(), /hash=smoke&js_api=1$/); // без t=; js_api — плеер сообщает позицию для «В окне»
  });

  await step('второе окно плеера открывается рядом с первым', async () => {
    await click('.player .popout');
    await until('два окна плеера', () => players().length === 2 && players().every((w) => !w.webContents.isLoading()));
    const frames = await Promise.all(players().map((w) => frame(w)));
    assert.deepEqual(frames.map((src) => /oid=-(\d)&id=(\d)/.exec(src).slice(1).join('_')).sort(), ['1_2', '2_1']);
  });

  await step('окна не уходят на чужой сайт: такая ссылка открывается в браузере', async () => {
    const child = players()[0];
    const before = child.webContents.getURL();
    await js(child, `location.href = 'https://vkvideo.ru/@pl_forever', true`);
    await js(win, `location.href = 'https://example.com/', true`);
    await until('ссылки ушли в браузер', () => external.includes('https://vkvideo.ru/@pl_forever') && external.includes('https://example.com/'));
    assert.equal(child.webContents.getURL(), before);
    assert.ok(win.webContents.getURL().startsWith('http://127.0.0.1:'));
  });

  await step('настройки открываются сразу; турнир, добавленный по номеру, — с названием', async () => {
    await click('#open-settings');
    assert.equal(await page(`document.querySelector('#settings').open`), true);
    const labels = await page(`[...document.querySelectorAll('#settings input[name="league"]')].map((i) => i.closest('label').textContent.trim())`);
    assert.ok(labels.includes('Россия · ФНЛ'), labels.join(', '));
    await page(`document.querySelector('#settings').close(), true`);
  });

  await step('клик по уведомлению: скрытое окно показывается и открывает идущий матч в плеере', async () => {
    win.hide();
    await sleep(300);
    const { localYmd } = await import('../../src/core/day.mjs');
    win.showInactive(); // как openMatch в main.cjs: показать окно и попросить страницу раскрыть матч
    win.webContents.send('open-match', { date: localYmd(new Date()), id: 101 });
    await until('плеер идущего матча', async () => /id=1&/.test(await page(`document.querySelector('.player.open iframe')?.src ?? ''`)));
    assert.equal(await page(`document.querySelector('.player').previousElementSibling.dataset.key`), 'live:101');
  });

  await step('крестик прячет окно в трей: приложение работает, лента закрыта и открывается при показе', async () => {
    for (const w of players()) w.destroy();
    win.close();
    await sleep(500);
    assert.equal(win.isDestroyed(), false);
    assert.equal(win.isVisible(), false);
    const before = subscriptions;
    win.showInactive();
    await until('новая подписка при показе', () => subscriptions === before + 1);
    win.close();
    await sleep(300);
  });

  setTimeout(() => app.exit(1), 5000).unref(); // «Выход» не сработал — runner увидит, что quit не записан
  app.quit();
}).catch((e) => {
  results.push({ name: 'запуск проверок', ok: false, error: String(e.message) });
  save();
  app.exit(1);
});
