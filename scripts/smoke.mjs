// Проверки в настоящем приложении (npm run smoke): запускает Electron со сценариями
// test/smoke/app.cjs во временном профиле и с подставной сетью, печатает итог.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TIMEOUT_MS = 120e3;
const electron = createRequire(import.meta.url)('electron'); // из Node это путь к electron.exe
const dir = mkdtempSync(path.join(os.tmpdir(), 'mc-smoke-'));
const out = path.join(dir, 'result.json');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // с ней Electron работает как обычный Node (см. scripts/electron.mjs)

const entry = fileURLToPath(new URL('../test/smoke/app.cjs', import.meta.url));
// --hidden — запуск сразу в трей, как при автозапуске с Windows
const child = spawn(electron, [entry, '--hidden', `--user-data-dir=${path.join(dir, 'profile')}`, `--smoke-out=${out}`], { stdio: 'inherit', env });
const timer = setTimeout(() => child.kill(), TIMEOUT_MS);

child.on('exit', () => {
  clearTimeout(timer);
  let report = { results: [] };
  try {
    report = JSON.parse(readFileSync(out, 'utf8'));
  } catch {}
  const checks = [...report.results, { name: '«Выход» завершает приложение', ok: report.quit === true }];
  for (const c of checks) console.log(`${c.ok ? '✔' : '✖'} ${c.name}${c.error ? `\n    ${c.error}` : ''}`);
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n${checks.length - failed} из ${checks.length} проверок прошли`);
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  process.exit(failed || report.results.length === 0 ? 1 : 0);
});
