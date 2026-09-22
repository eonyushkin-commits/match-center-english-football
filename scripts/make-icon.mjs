// Рисует build/icon.png (512×512) из src/web/icon.svg — electron-builder делает из него .ico.
// Запуск: npm run icon
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync(new URL('../src/web/icon.svg', import.meta.url), 'utf8');
const SIZE = 512;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: SIZE, height: SIZE, transparent: true, frame: false, useContentSize: true });
  const html = `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${SIZE}" height="${SIZE}" `)}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 500));
  const image = await win.webContents.capturePage();
  writeFileSync(new URL('../build/icon.png', import.meta.url), image.resize({ width: SIZE, height: SIZE, quality: 'best' }).toPNG());
  console.log('build/icon.png готов');
  app.exit(0);
});
