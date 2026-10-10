// Окно плеера держит пропорции по содержимому, а не вместе с рамкой и заголовком:
// win.setAspectRatio на Windows считает всё окно (поправку extraSize не учитывает), и по бокам
// видео остаются чёрные полосы.

// cur — нынешние границы окна, next — те, что просит пользователь, edge — за какой край тянут,
// frame — на сколько окно больше содержимого, min — наименьший размер окна
function fitRatio(cur, next, edge, frame, ratio, min = { width: 0, height: 0 }) {
  let w = Math.max(next.width, min.width) - frame.width;
  let h = Math.max(next.height, min.height) - frame.height;
  if (edge === 'top' || edge === 'bottom') w = Math.round(h * ratio);
  else h = Math.round(w / ratio);
  const width = w + frame.width;
  const height = h + frame.height;
  return {
    // тянут за левый или верхний край — на месте остаётся противоположный
    x: edge.includes('left') ? cur.x + cur.width - width : cur.x,
    y: edge.includes('top') ? cur.y + cur.height - height : cur.y,
    width,
    height,
  };
}

function keepContentRatio(win, ratio) {
  win.on('will-resize', (e, next, { edge }) => {
    e.preventDefault();
    const cur = win.getBounds();
    const [cw, ch] = win.getContentSize();
    const [minWidth, minHeight] = win.getMinimumSize();
    const frame = { width: cur.width - cw, height: cur.height - ch };
    win.setBounds(fitRatio(cur, next, edge, frame, ratio, { width: minWidth, height: minHeight }));
  });
}

module.exports = { fitRatio, keepContentRatio };
