// Запуск без Electron: сервер + чтение каналов через Playwright. Открывать http://localhost:3777
import { config, startServer } from './server.mjs';
import { startVkPoller } from './vk.mjs';

const vk = startVkPoller(config.channels, (config.vkRefreshSeconds || 60) * 1000,
  process.env.VK_PROXY || config.vkProxy || null);
await startServer(vk);
