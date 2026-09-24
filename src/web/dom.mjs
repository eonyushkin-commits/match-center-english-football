// Точечное обновление DOM.
// Узлы с тем же ключом остаются на месте, меняется только их содержимое. Поэтому iframe плеера
// никогда не переносится по DOM (перенос перезапускает видео), что бы ни пришло с сервера.
export const setHtml = (node, html) => { if (node._html !== html) { node.innerHTML = html; node._html = html; } };

export function reconcile(parent, items) {
  const want = new Set(items.map((i) => i.key));
  for (const n of [...parent.children]) if (!want.has(n.dataset.key) && n.dataset.key !== 'closing') n.remove();
  const have = new Map([...parent.children].map((n) => [n.dataset.key, n]));
  const skipClosing = (n) => { while (n && n.dataset.key === 'closing') n = n.nextElementSibling; return n; };
  let cur = skipClosing(parent.firstElementChild);
  for (const it of items) {
    let n = have.get(it.key);
    if (!n) {
      n = it.node || (it.create ? it.create() : parent.ownerDocument.createElement('div'));
      n.dataset.key = it.key;
    }
    if (it.cls !== undefined && n.className !== it.cls) n.className = it.cls;
    if (it.html !== undefined) setHtml(n, it.html);
    if (n === cur) cur = skipClosing(cur.nextElementSibling);
    else parent.insertBefore(n, cur);
  }
}
