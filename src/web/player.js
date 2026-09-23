'use strict';
// Плеер в отдельном окне: player.html?src=<ссылка встраивания VK>&title=<матч · канал>&url=<страница эфира>
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
  let src = null;
  try {
    const u = new URL(p.get('src') || '');
    if (u.protocol === 'https:' && /(^|\.)(vkvideo\.ru|vk\.com|vk\.ru)$/.test(u.hostname)) src = u.href;
  } catch {}
  if (!src) {
    document.body.insertAdjacentHTML('beforeend', '<div class="error">Нет ссылки на трансляцию</div>');
    return;
  }
  const frame = document.createElement('iframe');
  frame.src = src;
  frame.title = title;
  frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
  frame.allowFullscreen = true;
  document.body.prepend(frame);

  // «Поверх окон» есть только в приложении; в браузере окно обычное
  const pin = document.getElementById('pin');
  if (window.mc?.setOnTop) {
    pin.hidden = false;
    const set = async (value) => pin.setAttribute('aria-pressed', String(await window.mc.setOnTop(value)));
    set(true);
    pin.addEventListener('click', () => set(pin.getAttribute('aria-pressed') !== 'true'));
  }
})();
