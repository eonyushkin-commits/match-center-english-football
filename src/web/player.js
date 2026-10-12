// Плеер в отдельном окне: player.html?src=<ссылка встраивания VK>&title=<матч · канал>&url=<страница эфира>
import { embedUrl } from './format.mjs';

(() => {
  const p = new URLSearchParams(location.search);
  const title = p.get('title') || 'Трансляция';
  document.title = title;
  document.getElementById('title').textContent = title;

  const ext = document.getElementById('ext');
  const url = p.get('url') || '';
  if (/^https:\/\/(\w+\.)?(vkvideo\.ru|vk\.com|vk\.ru)\//.test(url)) ext.href = url;
  else ext.hidden = true;

  // встраиваем только плеер VK — страница не должна открывать в себе что попало
  const src = embedUrl({ embed: p.get('src') });
  if (!src) {
    document.body.insertAdjacentHTML('beforeend', '<div class="error">Нет ссылки на трансляцию</div>');
    return;
  }
  const frame = document.createElement('iframe');
  frame.src = src;
  frame.title = title;
  frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock'; // wake-lock — экран не гаснет во время матча
  frame.allowFullscreen = true;
  document.body.prepend(frame);

  // Запись сообщает приложению, на какой она секунде (плеер VK шлёт это сам, если открыт с js_api=1
  // и получил init): закроют окно — приложение продолжит её с того же места.
  if (new URL(src).searchParams.has('js_api')) {
    frame.addEventListener('load', () => frame.contentWindow.postMessage({ method: 'init' }, new URL(src).origin));
    addEventListener('message', (e) => {
      if (e.source !== frame.contentWindow) return;
      const { state, time } = e.data || {};
      if (state && state !== 'unstarted' && Number.isFinite(time)) window.opener?.postMessage({ position: Math.floor(time) }, location.origin);
    });
  }

  // «Поверх окон» есть только в приложении; в браузере окно обычное
  const pin = document.getElementById('pin');
  if (window.mc?.setOnTop) {
    pin.hidden = false;
    const set = async (value) => pin.setAttribute('aria-pressed', String(await window.mc.setOnTop(value)));
    set(true);
    pin.addEventListener('click', () => set(pin.getAttribute('aria-pressed') !== 'true'));
  }
})();
