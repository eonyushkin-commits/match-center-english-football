// Выполняется в невидимом окне со страницей канала VK до её скриптов.
// Перехватывает ответы, которыми сайт наполняет свои карточки, и складывает их в window.__mcCatalog.
// Встроенный отладчик Electron (Network.enable) для этого не годится — команда не отвечает.
(() => {
  const CATALOG = /api\.vkvideo\.ru\/method\/catalog\./;
  const store = [];
  Object.defineProperty(window, '__mcCatalog', { get: () => store });

  const keep = (text) => {
    try {
      const videos = JSON.parse(text)?.response?.videos;
      if (Array.isArray(videos)) store.push(...videos);
    } catch {}
  };

  const fetch0 = window.fetch;
  window.fetch = function (...args) {
    const p = fetch0.apply(this, args);
    const url = String(args[0]?.url || args[0] || '');
    if (CATALOG.test(url)) p.then((r) => r.clone().text().then(keep).catch(() => {}), () => {});
    return p;
  };

  const open0 = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (CATALOG.test(String(url))) {
      this.addEventListener('load', () => { if (typeof this.responseText === 'string') keep(this.responseText); });
    }
    return open0.call(this, method, url, ...rest);
  };
})();
