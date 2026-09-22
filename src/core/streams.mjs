// Фоновый опрос каналов VK. Каждый канал читается параллельно и независимо: сначала первым
// способом из readers (API), при ошибке — следующим (страница). У каждого канала свой статус,
// а при сбое остаются его последние эфиры.
import { EventEmitter } from 'node:events';

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const firstLine = (s) => String(s).split('\n')[0];

export function createStreamPoller({ channels, intervalMs, readers, timeoutMs = 45e3, log = console }) {
  const events = new EventEmitter();
  const byChannel = new Map(); // screenName → { streams, ok, via, error, checkedAt, okAt }
  let updatedAt = null;
  let timer = null;
  let running = null;
  let again = false;
  let stopped = false;

  async function read(ch) {
    const errors = [];
    for (const reader of readers) {
      try {
        const streams = await withTimeout(reader.read(ch), timeoutMs, `нет ответа за ${timeoutMs / 1000} с`);
        return { streams, via: reader.name };
      } catch (e) {
        errors.push(`${reader.name}: ${firstLine(e.message)}`);
      }
    }
    throw new Error(errors.join('; ') || 'нет способов чтения');
  }

  async function tick() {
    clearTimeout(timer);
    const list = channels();
    const wanted = new Set(list.map((c) => c.screenName));
    for (const key of byChannel.keys()) if (!wanted.has(key)) byChannel.delete(key);

    await Promise.all(list.map(async (ch) => {
      const prev = byChannel.get(ch.screenName);
      const now = Date.now();
      try {
        const { streams, via } = await read(ch);
        byChannel.set(ch.screenName, { streams, ok: true, via, error: null, checkedAt: now, okAt: now });
      } catch (e) {
        log.warn?.(`VK ${ch.label || ch.screenName}: ${e.message}`);
        byChannel.set(ch.screenName, {
          streams: prev?.streams || [], ok: false, via: null, error: e.message, checkedAt: now, okAt: prev?.okAt ?? null,
        });
      }
    }));
    updatedAt = Date.now();
    events.emit('update', snapshot());
  }

  // Повторный вызов во время чтения не запускает второе: он дождётся текущего и прочитает ещё раз
  function refresh() {
    if (running) {
      again = true;
      return running;
    }
    running = tick()
      .catch((e) => log.error?.(e))
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          refresh();
        } else if (!stopped) {
          timer = setTimeout(refresh, intervalMs());
        }
      });
    return running;
  }

  function snapshot() {
    const list = channels();
    return {
      ready: updatedAt !== null,
      updatedAt,
      channels: list.map((ch) => {
        const s = byChannel.get(ch.screenName);
        return {
          screenName: ch.screenName, label: ch.label || ch.screenName,
          ok: s ? s.ok : null, via: s?.via ?? null, error: s?.error ?? null,
          count: s?.streams.length ?? 0, checkedAt: s?.checkedAt ?? null, okAt: s?.okAt ?? null,
        };
      }),
      streams: list.flatMap((ch) => byChannel.get(ch.screenName)?.streams || []),
    };
  }

  function stop() {
    stopped = true;
    clearTimeout(timer);
    timer = null;
  }

  return Object.assign(events, { refresh, snapshot, stop });
}
