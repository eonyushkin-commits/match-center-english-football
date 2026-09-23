// Готовит иконки из build/icon-source.png (скруглённый квадрат на белом фоне):
//   build/icon.png        1024 — для установщика и .exe (electron-builder делает из неё .ico)
//   src/electron/icon.png  256 — окно, трей, уведомления
//   src/web/icon.png       128 — вкладка и логотип в шапке
// Всё вне фигуры становится прозрачным. Контур меряем по самой картинке — по каждой строке и
// столбцу — и берём его выпуклую оболочку: у сглаженного квадрата («сквиркла») углы не круглые,
// а светлые места рисунка у края (флаг) не должны превращаться в выемки. Запуск: npm run icon
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../build/icon-source.png', import.meta.url)).toString('base64');
const outputs = [['../build/icon.png', 1024], ['../src/electron/icon.png', 256], ['../src/web/icon.png', 128]];
const INSET = 3; // срезать сглаженный край исходника, в нём примешан белый фон

// Выполняется в странице: границы и радиус скругления → маска → PNG нужных размеров в base64
const PROCESS = (dataUrl, sizes, inset) => new Promise((resolve) => {
  const img = new Image();
  img.onload = async () => {
    const w = img.width, h = img.height;
    const c = new OffscreenCanvas(w, h);
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, w, h).data;
    const dark = (px, py) => { const i = (py * w + px) * 4; return Math.min(d[i], d[i + 1], d[i + 2]) < 225; };
    const scanX = (py, from, step) => { for (let px = from; px >= 0 && px < w; px += step) if (dark(px, py)) return px; return -1; };
    const scanY = (px, from, step) => { for (let py = from; py >= 0 && py < h; py += step) if (dark(px, py)) return py; return -1; };

    // 1. точки края: первый не белый пиксель с каждой стороны каждой строки и столбца
    const pts = [];
    for (let py = 0; py < h; py++) {
      const l = scanX(py, 0, 1);
      if (l >= 0) pts.push([l, py + 0.5], [scanX(py, w - 1, -1) + 1, py + 0.5]);
    }
    for (let px = 0; px < w; px++) {
      const t = scanY(px, 0, 1);
      if (t >= 0) pts.push([px + 0.5, t], [px + 0.5, scanY(px, h - 1, -1) + 1]);
    }
    // 2. выпуклая оболочка (монотонная цепь)
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = (list) => {
      const hull = [];
      for (const p of list) {
        while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) hull.pop();
        hull.push(p);
      }
      hull.pop();
      return hull;
    };
    const hull = [...half(pts), ...half([...pts].reverse())];
    // 3. сдвиг внутрь на inset: край исходника сглажен с белым фоном
    const xs = hull.map((p) => p[0]), ys = hull.map((p) => p[1]);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    const shape = hull.map(([px, py]) => {
      const dx = px - cx, dy = py - cy, dist = Math.hypot(dx, dy) || 1;
      return [cx + dx * (1 - inset / dist), cy + dy * (1 - inset / dist)];
    });
    const radius = scanX(Math.ceil(top), 0, 1) - left; // для отчёта: где начинается прямой верхний край

    const side = Math.max(right - left, bottom - top) - 2 * inset;
    const ox = cx - side / 2, oy = cy - side / 2;

    // 4. сначала вырезаем фигуру в полном размере — снаружи прозрачно. Если резать уже уменьшенную
    // картинку, при сжатии в краевые пиксели подмешивается белый фон и появляется светлая кайма.
    const full = new OffscreenCanvas(Math.round(side), Math.round(side));
    const f = full.getContext('2d');
    f.beginPath();
    shape.forEach(([px, py], i) => f[i ? 'lineTo' : 'moveTo'](px - ox, py - oy));
    f.closePath();
    f.clip();
    f.drawImage(img, -ox, -oy);

    // 5. уменьшаем вдвое за шаг — мелкие размеры получаются чётче, чем одним сжатием
    const shrink = (canvas, size) => {
      let cur = canvas;
      while (cur.width / 2 > size) {
        const next = new OffscreenCanvas(Math.round(cur.width / 2), Math.round(cur.height / 2));
        const n = next.getContext('2d');
        n.imageSmoothingQuality = 'high';
        n.drawImage(cur, 0, 0, next.width, next.height);
        cur = next;
      }
      const out = new OffscreenCanvas(size, size);
      const o = out.getContext('2d');
      o.imageSmoothingQuality = 'high';
      o.drawImage(cur, 0, 0, size, size);
      return out;
    };

    const list = [];
    for (const size of sizes) {
      const out = shrink(full, size);
      const buf = new Uint8Array(await (await out.convertToBlob({ type: 'image/png' })).arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      list.push(btoa(s));
    }
    resolve({ list, shape: { left, top, right, bottom, radius, hullPoints: hull.length } });
  };
  img.src = dataUrl;
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<body></body>');
  const { list, shape } = await win.webContents.executeJavaScript(
    `(${PROCESS})(${JSON.stringify(`data:image/png;base64,${src}`)}, ${JSON.stringify(outputs.map(([, s]) => s))}, ${INSET})`);
  outputs.forEach(([file, size], i) => {
    writeFileSync(new URL(file, import.meta.url), Buffer.from(list[i], 'base64'));
    console.log(`${file.replace('../', '')} ${size}×${size}`);
  });
  console.log('форма исходника:', JSON.stringify(shape));
  app.exit(0);
});
