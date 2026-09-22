// Матч-центр без Electron: сервер для браузера или для публикации за nginx.
//   npm start                    → http://127.0.0.1:3777
//   HOST=0.0.0.0 PORT=8080 …     → доступ из сети
//   MC_DATA=/var/lib/mc …        → где хранить настройки (по умолчанию ./data)
//   VK_PROXY=socks5://host:port  → читать VK через прокси (нужен Playwright)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createMatchCenter } from './core/app.mjs';
import { createPlaywrightReader } from './server/playwright-reader.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const proxy = process.env.VK_PROXY || null;
const pageReader = await createPlaywrightReader(proxy);
if (proxy && !pageReader) {
  console.error('VK_PROXY задан, но Playwright не установлен: npm install playwright && npx playwright install chromium');
  process.exit(1);
}

const mc = await createMatchCenter({
  dataDir: process.env.MC_DATA || fileURLToPath(new URL('../data', import.meta.url)),
  pageReader,
  apiEnabled: !proxy, // запросы API прокси не учитывают — с прокси читаем только страницу
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3777),
  version: pkg.version,
});
console.log(`Матч-центр ${pkg.version}: ${mc.url}${pageReader ? '' : ' (запасное чтение страниц выключено: Playwright не установлен)'}`);

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  mc.close();
  process.exit(0);
});
