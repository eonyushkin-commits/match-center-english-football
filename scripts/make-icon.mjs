// Готовит иконки из build/icon-source.jpg или .png (скруглённый квадрат на белом фоне):
//   build/icon.png        1024 — для установщика и .exe (electron-builder делает из неё .ico)
//   src/electron/icon.png  256 — окно, трей, уведомления
//   src/web/icon.png       128 — вкладка и логотип в шапке
// Всё вне фигуры становится прозрачным. Край меряем по лучам из центра и подбираем по замерам
// гладкую фигуру — суперэллипс («сквиркл») или квадрат со скруглёнными углами. Маска строится по
// этой фигуре, а не по пикселям, поэтому она ровная и без выемок, а там, где белый рисунок
// сливается с белым фоном и край по цвету не найти, фигура просто продолжается. Запуск: npm run icon
import { app, BrowserWindow } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const source = ['jpg', 'png'].map((ext) => new URL(`../build/icon-source.${ext}`, import.meta.url)).find((u) => existsSync(u));
const mime = source.pathname.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
const src = readFileSync(source).toString('base64');
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
    // край — первые RUN не белых пикселей подряд: одиночные серые точки сжатия JPG у края не в счёт
    const RUN = 4;
    const scan = (len, isDark, from, step) => {
      for (let i = from, run = 0; i >= 0 && i < len; i += step) {
        run = isDark(i) ? run + 1 : 0;
        if (run === RUN) return i - step * (RUN - 1);
      }
      return -1;
    };
    const scanX = (py, from, step) => scan(w, (px) => dark(px, py), from, step);
    const scanY = (px, from, step) => scan(h, (py) => dark(px, py), from, step);

    // 1. край по лучам из центра: на каждом луче идём снаружи внутрь до первых RUN не белых пикселей
    const cx = w / 2, cy = h / 2;
    const N = 4096; // делится на 8 — у симметричных лучей целые номера
    const r = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = (2 * Math.PI * i) / N, dx = Math.cos(a), dy = Math.sin(a);
      const rmax = Math.min(Math.abs(dx) > 1e-9 ? cx / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? cy / Math.abs(dy) : Infinity) - 0.5;
      let run = 0;
      for (let rr = rmax; rr > 0; rr -= 0.5) {
        run = dark(Math.floor(cx + rr * dx), Math.floor(cy + rr * dy)) ? run + 1 : 0;
        if (run === RUN) { r[i] = rr + 0.5 * (RUN - 1) + 0.5; break; }
      }
    }
    // 2. по замерам подбираем гладкую фигуру: суперэллипс |x|^n + |y|^n = s^n или квадрат со
    // скруглёнными углами радиуса R. Где белый рисунок сливается с белым фоном, замер «проваливается»
    // внутрь — такие лучи в подбор не попадают: сначала подбор по медиане ошибок (устойчив, пока
    // провалов меньше половины), потом уточнение только по лучам, совпавшим с фигурой до 1,5 px.
    const angle = (i) => (2 * Math.PI * i) / N;
    const models = {
      superellipse: (n, sc) => (i) => { const a = angle(i); return sc * Math.pow(Math.pow(Math.abs(Math.cos(a)), n) + Math.pow(Math.abs(Math.sin(a)), n), -1 / n); },
      roundrect: (R, sc) => (i) => {
        const a = angle(i), c = Math.abs(Math.cos(a)), si = Math.abs(Math.sin(a)), k = sc - R;
        // луч из центра до скруглённого квадрата с половиной стороны sc
        const flat = Math.min(c > 1e-9 ? sc / c : Infinity, si > 1e-9 ? sc / si : Infinity);
        const px = flat * c, py = flat * si;
        if (px <= k || py <= k) return flat;
        const b = k * (c + si), disc = b * b - (2 * k * k - R * R);
        return b + Math.sqrt(Math.max(0, disc));
      },
    };
    const measured = [];
    for (let i = 0; i < N; i += 4) if (r[i] > 0) measured.push(i);
    const errorsOf = (fn, list) => list.map((i) => Math.abs(r[i] - fn(i)));
    const median = (arr) => { const a = [...arr].sort((p, q) => p - q); return a[a.length >> 1]; };
    let best = null;
    const half = Math.min(w, h) / 2;
    for (const [kind, make, lo, hi, step] of [['superellipse', models.superellipse, 2, 12, 0.05], ['roundrect', models.roundrect, 0, half, 1]]) {
      for (let p = lo; p <= hi; p += step) {
        for (let sc = half - 12; sc <= half + 2; sc += 0.5) {
          const e = median(errorsOf(make(p, sc), measured));
          if (!best || e < best.e) best = { kind, p, sc, e };
        }
      }
    }
    // уточнение по совпавшим лучам — мелким шагом вокруг найденного
    const make = models[best.kind];
    const inliers = [];
    for (let i = 0; i < N; i++) if (r[i] > 0 && Math.abs(r[i] - make(best.p, best.sc)(i)) < 1.5) inliers.push(i);
    const pStep = best.kind === 'superellipse' ? 0.005 : 0.1;
    let fine = null;
    for (let p = best.p - 20 * pStep; p <= best.p + 20 * pStep; p += pStep) {
      for (let sc = best.sc - 1; sc <= best.sc + 1; sc += 0.05) {
        const fn = make(p, sc);
        let sum = 0;
        for (const i of inliers) sum += (r[i] - fn(i)) ** 2;
        const rms = Math.sqrt(sum / inliers.length);
        if (!fine || rms < fine.rms) fine = { p, sc, rms };
      }
    }
    const model = make(fine.p, fine.sc);
    const edge = Float64Array.from({ length: N }, (_, i) => model(i));
    const fixed = N - inliers.length; // лучей, где край взят из подбора, а не из замера

    // 3. контур со сдвигом внутрь на inset: край исходника сглажен с белым фоном
    const shape = Array.from(edge, (ri, i) => {
      const a = (2 * Math.PI * i) / N, rr = Math.max(0, ri - inset);
      return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
    });
    const xs = shape.map((p) => p[0]), ys = shape.map((p) => p[1]);
    const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
    const radius = scanX(0, 0, 1); // для отчёта: где начинается прямой верхний край

    const side = Math.max(right - left, bottom - top);
    const ox = (left + right) / 2 - side / 2, oy = (top + bottom) / 2 - side / 2;

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
    resolve({ list, shape: { фигура: best.kind, параметр: +fine.p.toFixed(3), половина_стороны: +fine.sc.toFixed(2), rms_px: +fine.rms.toFixed(2), лучей_совпало: inliers.length, лучей_всего: N } });
  };
  img.src = dataUrl;
});

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<body></body>');
  const { list, shape } = await win.webContents.executeJavaScript(
    `(${PROCESS})(${JSON.stringify(`data:${mime};base64,${src}`)}, ${JSON.stringify(outputs.map(([, s]) => s))}, ${INSET})`);
  outputs.forEach(([file, size], i) => {
    writeFileSync(new URL(file, import.meta.url), Buffer.from(list[i], 'base64'));
    console.log(`${file.replace('../', '')} ${size}×${size}`);
  });
  console.log('форма исходника:', JSON.stringify(shape));
  app.exit(0);
});
