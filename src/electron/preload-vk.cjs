// Выполняется в скрытом окне со страницей канала VK до её скриптов (запасной способ чтения).
// Перехватывает ответы, которыми сайт наполняет карточки, и складывает их в window.__mcCatalog.
(() => {
  const CATALOG = /api\.vkvideo\.ru\/method\/catalog\./;
  const store = [];
  Object.defineProperty(window, '__mcCatalog', { get: () => store });

  const keep = (data) => {
    try {
      const videos = (typeof data === 'string' ? JSON.parse(data) : data)?.response?.videos;
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
      // responseText недоступен при responseType 'json' — тогда берём уже разобранный response
      this.addEventListener('load', () => keep(this.responseType === 'json' ? this.response : this.responseText));
    }
    return open0.call(this, method, url, ...rest);
  };
})();
