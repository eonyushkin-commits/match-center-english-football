// Фоновый опрос каналов VK. Каждый канал читается параллельно и независимо: сначала первым
// способом из readers (API), при ошибке — следующим (страница). У каждого канала свой статус,
// а при сбое остаются его последние эфиры.
import { EventEmitter } from 'node:events';

// пауза запасного чтения после неудач подряд: 2, 4, 8, дальше по 10 минут
const PAUSE_MS = 60e3;
const MAX_PAUSE_MS = 10 * 60e3;

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const firstLine = (s) => String(s).split('\n')[0];
const hhmm = (t) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function createStreamPoller({ channels, intervalMs, readers, timeoutMs = 45e3, now = () => Date.now(), log = console }) {
  const events = new EventEmitter();
  const byChannel = new Map(); // screenName → { streams, ok, via, error, checkedAt, okAt }
  // Запасные способы тяжёлые (скрытое окно со страницей канала): читают по одному каналу за раз,
  // а после неудачи канал пропускает их на растущую паузу.
  const pauses = new Map(); // screenName → { fails, until }
  let spareQueue = Promise.resolve();
  let forced = false; // «Обновить» по кнопке: следующий круг забывает паузы
  let applied = null; // частота и каналы, с которыми назначен текущий круг
  let updatedAt = null;
  let timer = null;
  let running = null;
  let again = false;
  let stopped = false;

  const config = () => JSON.stringify([intervalMs(), channels()]);

  async function read(ch) {
    const errors = [];
    const attempt = async (reader) => {
      try {
        return { streams: await withTimeout(reader.read(ch), timeoutMs, `нет ответа за ${timeoutMs / 1000} с`), via: reader.name };
      } catch (e) {
        errors.push(`${reader.name}: ${firstLine(e.message)}`);
        return null;
      }
    };
    const [first, ...spare] = readers;
    let got = first ? await attempt(first) : null;
    const pause = pauses.get(ch.screenName);
    if (!got && spare.length) {
      if (pause && now() < pause.until) errors.push(`запасное чтение на паузе до ${hhmm(pause.until)}`);
      else {
        got = await (spareQueue = spareQueue.then(async () => {
          for (const reader of spare) {
            const result = await attempt(reader);
            if (result) return result;
          }
          return null;
        }));
        if (!got) {
          const fails = (pause?.fails ?? 0) + 1;
          pauses.set(ch.screenName, { fails, until: now() + Math.min(PAUSE_MS * 2 ** fails, MAX_PAUSE_MS) });
        }
      }
    }
    if (!got) throw new Error(errors.join('; ') || 'нет способов чтения');
    pauses.delete(ch.screenName);
    return got;
  }

  async function tick() {
    clearTimeout(timer);
    applied = config();
    if (forced) pauses.clear();
    forced = false;
    const list = channels();
    const wanted = new Set(list.map((c) => c.screenName));
    for (const key of byChannel.keys()) if (!wanted.has(key)) byChannel.delete(key);
    for (const key of pauses.keys()) if (!wanted.has(key)) pauses.delete(key);

    await Promise.all(list.map(async (ch) => {
      const prev = byChannel.get(ch.screenName);
      const at = Date.now();
      try {
        const { streams, via } = await read(ch);
        byChannel.set(ch.screenName, { streams, ok: true, via, error: null, checkedAt: at, okAt: at });
      } catch (e) {
        log.warn?.(`VK ${ch.label || ch.screenName}: ${e.message}`);
        byChannel.set(ch.screenName, {
          streams: prev?.streams || [], ok: false, via: null, error: e.message, checkedAt: at, okAt: prev?.okAt ?? null,
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

  // Настройки поменялись: если это каналы или частота — перечитываем сразу, не дожидаясь
  // следующего круга (он назначен ещё со старой частотой)
  function sync() {
    if (config() !== applied) refresh();
  }

  function retry() {
    forced = true;
    return refresh();
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

  return Object.assign(events, { refresh, retry, sync, snapshot, stop });
}
