// Запуск Electron из npm-скриптов. Терминал VS Code задаёт ELECTRON_RUN_AS_NODE=1, и с ним
// Electron молча работает как обычный Node (app === undefined) — поэтому убираем переменную.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const electron = createRequire(import.meta.url)('electron'); // из Node это путь к electron.exe
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, process.argv.slice(2), { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
