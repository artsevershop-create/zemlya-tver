// 3D-схема: рельеф с дорогами, реками и лесом, поверх него участки в виде приподнятых плит.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';

const EX = 9; // во сколько раз рельеф вытянут по высоте, иначе равнина выглядит плоской
const LIFT = { dim: 10, idle: 46, hover: 84, sel: 130 };
const COL = { sale: '#E2B93B', check: '#EDD88F', reserve: '#9FB0C0', resEdge: '#4F6276', hover: '#F3CF58', sel: '#FFE56B', red: '#C8281E' };
const MAX_EDGE = 80;

export function createMap(host, data, map, demBuf, cb = {}) {
  const { meta, parcels, places } = data;
  const D = meta.dem, W = meta.w, H = meta.h;
  const dem = new Int16Array(demBuf);
  const small = host.clientWidth < 720;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const elev = (i, j) => dem[j * D.nx + i] / 10;
  function hAt(x, y) { // высота сцены в точке с местными координатами (x на восток, y на север)
    const fx = Math.min(D.nx - 1.001, Math.max(0, (x - D.west) / D.cell)), fy = Math.min(D.ny - 1.001, Math.max(0, (D.north - y) / D.cell));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const h = elev(i, j) * (1 - u) * (1 - v) + elev(i + 1, j) * u * (1 - v) + elev(i, j + 1) * (1 - u) * v + elev(i + 1, j + 1) * u * v;
    return (h - D.min) * EX;
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const el = renderer.domElement;
  host.appendChild(el);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#D5DCCF');
  const camera = new THREE.PerspectiveCamera(32, 1, 200, 120000); // ближняя граница подальше: точнее глубина на общем виде
  const controls = new OrbitControls(camera, el);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.09, minPolarAngle: 0.05, maxPolarAngle: Math.PI * 0.44, minDistance: 1200, maxDistance: 46000, screenSpacePanning: false, enableZoom: false, zoomSpeed: 0.9 });
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9d2c2, 1.75));
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.3);
  sun.position.set(-1, 0.95, -0.7); // свет с северо-запада, как принято на картах
  scene.add(sun);

  // ---------- подложка: рисуем карту на холсте и натягиваем на рельеф
  function paint() {
    const tw = small ? 2048 : 3072, th = Math.round((tw * H) / W), s = tw / W, k = tw / 3072;
    const cv = document.createElement('canvas');
    cv.width = tw; cv.height = th;
    const g = cv.getContext('2d');
    const X = (x) => (x + W / 2) * s, Y = (y) => (H / 2 - y) * s;
    const line = (r) => { g.moveTo(X(r[0]), Y(r[1])); for (let i = 2; i < r.length; i += 2) g.lineTo(X(r[i]), Y(r[i + 1])); };
    const ring = (r) => { line(r); g.closePath(); };
    g.fillStyle = '#E8ECDF'; g.fillRect(0, 0, tw, th);
    g.fillStyle = '#B9CEAF';
    for (const poly of map.forest) { g.beginPath(); poly.forEach(ring); g.fill('evenodd'); }
    // горизонтали через 5 м, каждая пятая толще
    g.strokeStyle = 'rgba(134,98,60,.36)';
    const cs = D.cell * s, ox = X(D.west), oy = Y(D.north), cx = [0, 1, 1, 0], cy = [0, 0, 1, 1];
    for (const [lw, thick] of [[0.6 * k, false], [1.15 * k, true]]) {
      g.lineWidth = lw; g.beginPath();
      for (let j = 0; j < D.ny - 1; j++) for (let i = 0; i < D.nx - 1; i++) {
        const v = [elev(i, j), elev(i + 1, j), elev(i + 1, j + 1), elev(i, j + 1)];
        const lo = Math.min(v[0], v[1], v[2], v[3]), hi = Math.max(v[0], v[1], v[2], v[3]);
        for (let L = Math.ceil(lo / 5) * 5; L < hi; L += 5) {
          if ((L % 25 === 0) !== thick) continue;
          const q = [];
          for (let e = 0; e < 4; e++) {
            const a = v[e], c = v[(e + 1) % 4];
            if ((a < L) !== (c < L)) { const t = (L - a) / (c - a), n = (e + 1) % 4; q.push(ox + (i + cx[e] + (cx[n] - cx[e]) * t) * cs, oy + (j + cy[e] + (cy[n] - cy[e]) * t) * cs); }
          }
          if (q.length >= 4) { g.moveTo(q[0], q[1]); g.lineTo(q[2], q[3]); }
          if (q.length === 8) { g.moveTo(q[4], q[5]); g.lineTo(q[6], q[7]); }
        }
      }
      g.stroke();
    }
    g.fillStyle = '#A3C8E0';
    for (const poly of map.water) { g.beginPath(); poly.forEach(ring); g.fill('evenodd'); }
    g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#4C8DBB';
    for (const r of map.rivers) { g.lineWidth = (r.k === 'river' ? 3 : 1.4) * k; g.beginPath(); line(r.p); g.stroke(); }
    const road = (kind, width, color, dash) => {
      g.lineWidth = width * k; g.strokeStyle = color; g.setLineDash(dash ? dash.map((d) => d * k) : []);
      g.beginPath(); for (const r of map.roads) if (r.k === kind) line(r.p); g.stroke();
    };
    road('track', 0.9, 'rgba(70,58,44,.6)', [6, 4]);
    road('local', 2.8, '#6C6A5C'); road('local', 1.6, '#FCFCF7');
    road('regional', 4, '#5A5343'); road('regional', 2.6, '#FBF6E6');
    road('main', 5.6, '#5B2A1E'); road('main', 3.8, '#E58A4E');
    for (const l of map.lines || []) { // газопровод и ЛЭП
      g.beginPath(); line(l.p);
      if (l.k === 'gas') { g.lineWidth = 2.6 * k; g.strokeStyle = '#8A2D8F'; g.setLineDash([11 * k, 5 * k, 2 * k, 5 * k]); }
      else { g.lineWidth = 1.4 * k; g.strokeStyle = '#33383B'; g.setLineDash([15 * k, 5 * k]); }
      g.stroke();
    }
    g.setLineDash([]); g.strokeStyle = COL.red;
    for (const p of parcels) if (p.rings) {
      g.lineWidth = 1.7 * k; g.strokeStyle = p.group === 'reserve' ? COL.resEdge : COL.red;
      g.beginPath(); p.rings.forEach(ring); g.stroke();
    }
    return cv;
  }

  // ---------- рельеф
  const step = small ? 2 : 1, gx = Math.floor((D.nx - 1) / step) + 1, gy = Math.floor((D.ny - 1) / step) + 1;
  const pos = new Float32Array(gx * gy * 3), uv = new Float32Array(gx * gy * 2), idx = new Uint32Array((gx - 1) * (gy - 1) * 6);
  for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
    const n = j * gx + i, x = D.west + i * step * D.cell, y = D.north - j * step * D.cell;
    pos[n * 3] = x; pos[n * 3 + 1] = (elev(i * step, j * step) - D.min) * EX; pos[n * 3 + 2] = -y;
    uv[n * 2] = (x + W / 2) / W; uv[n * 2 + 1] = (y + H / 2) / H;
  }
  for (let j = 0, t = 0; j < gy - 1; j++) for (let i = 0; i < gx - 1; i++) {
    const a = j * gx + i, c = a + gx;
    idx[t++] = a; idx[t++] = c; idx[t++] = a + 1; idx[t++] = a + 1; idx[t++] = c; idx[t++] = c + 1;
  }
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  tGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  tGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  tGeo.computeVertexNormals();
  const tex = new THREE.CanvasTexture(paint());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  scene.add(new THREE.Mesh(tGeo, new THREE.MeshLambertMaterial({ map: tex })));
  // боковые стенки, чтобы земля выглядела как макет на столе
  const edge = [];
  for (let i = 0; i < gx; i++) edge.push(i);
  for (let j = 1; j < gy; j++) edge.push(j * gx + gx - 1);
  for (let i = gx - 2; i >= 0; i--) edge.push((gy - 1) * gx + i);
  for (let j = gy - 2; j >= 0; j--) edge.push(j * gx);
  const sk = [];
  for (let e = 0; e < edge.length - 1; e++) {
    const a = edge[e] * 3, c = edge[e + 1] * 3, B = -220;
    sk.push(pos[a], pos[a + 1], pos[a + 2], pos[c], pos[c + 1], pos[c + 2], pos[a], B, pos[a + 2], pos[c], pos[c + 1], pos[c + 2], pos[c], B, pos[c + 2], pos[a], B, pos[a + 2]);
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sk), 3));
  scene.add(new THREE.Mesh(sGeo, new THREE.MeshBasicMaterial({ color: '#26382F', side: THREE.DoubleSide })));

  // ---------- участки
  const items = new Map(), pickables = [];
  let dirty = true, selId = null, hovId = null, filter = null;

  function makeParcel(p) {
    const rings = p.rings.map((r) => { const a = []; for (let i = 0; i < r.length; i += 2) a.push(new THREE.Vector2(r[i], r[i + 1])); return a; });
    const all = rings.flat();
    const stack = THREE.ShapeUtils.triangulateShape(rings[0], rings.slice(1)).map((t) => t.map((i) => all[i]));
    const tri = [];
    while (stack.length) { // дробим крупные треугольники, чтобы плита повторяла рельеф
      const [a, b, c] = stack.pop();
      const ab = a.distanceTo(b), bc = b.distanceTo(c), ca = c.distanceTo(a), m = Math.max(ab, bc, ca);
      if (m <= MAX_EDGE) { tri.push(a, b, c); continue; }
      if (m === ab) { const q = a.clone().lerp(b, 0.5); stack.push([a, q, c], [q, b, c]); }
      else if (m === bc) { const q = b.clone().lerp(c, 0.5); stack.push([a, b, q], [a, q, c]); }
      else { const q = c.clone().lerp(a, 0.5); stack.push([a, b, q], [q, b, c]); }
    }
    const tp = new Float32Array(tri.length * 3);
    tri.forEach((v, i) => { tp[i * 3] = v.x; tp[i * 3 + 1] = hAt(v.x, v.y); tp[i * 3 + 2] = -v.y; });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(tp, 3));
    geo.computeVertexNormals();
    const baseCol = COL[p.status] || COL.sale, baseOp = 1;
    const mat = new THREE.MeshLambertMaterial({ color: baseCol, side: THREE.DoubleSide, transparent: baseOp < 1, opacity: baseOp, depthWrite: baseOp >= 1 });
    const top = new THREE.Mesh(geo, mat);
    top.userData.id = p.id;
    if (p.split) { // линии расчётного раздела лежат на плите и поднимаются вместе с ней
      const lp = [];
      for (const lot of p.split.lots) for (let i = 0, r = lot.ring; i < r.length; i += 2) {
        const ax = r[i], ay = r[i + 1], bx = r[(i + 2) % r.length], by = r[(i + 3) % r.length], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 60));
        for (let s = 0; s < n; s++) {
          const x0 = ax + ((bx - ax) * s) / n, y0 = ay + ((by - ay) * s) / n, x1 = ax + ((bx - ax) * (s + 1)) / n, y1 = ay + ((by - ay) * (s + 1)) / n;
          lp.push(x0, hAt(x0, y0) + 12, -y0, x1, hAt(x1, y1) + 12, -y1);
        }
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      top.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#14271F' })));
    }
    // стенки по границе: низ на земле, верх поднимается вместе с плитой
    const wp = [], tops = [];
    for (const r of rings) for (let i = 0; i < r.length; i++) {
      const a = r[i], c = r[(i + 1) % r.length], n = Math.max(1, Math.ceil(a.distanceTo(c) / 60));
      for (let s = 0; s < n; s++) {
        const p0 = a.clone().lerp(c, s / n), p1 = a.clone().lerp(c, (s + 1) / n), g0 = hAt(p0.x, p0.y), g1 = hAt(p1.x, p1.y), o = wp.length / 3;
        wp.push(p0.x, g0 - 3, -p0.y, p1.x, g1 - 3, -p1.y, p0.x, g0, -p0.y, p1.x, g1 - 3, -p1.y, p1.x, g1, -p1.y, p0.x, g0, -p0.y);
        tops.push([o + 2, g0], [o + 4, g1], [o + 5, g0]);
      }
    }
    const wGeo = new THREE.BufferGeometry();
    const wAttr = new THREE.BufferAttribute(new Float32Array(wp), 3);
    wGeo.setAttribute('position', wAttr);
    const wMat = new THREE.MeshBasicMaterial({ color: p.group === 'reserve' ? COL.resEdge : COL.red, side: THREE.DoubleSide, transparent: true });
    const wall = new THREE.Mesh(wGeo, wMat);
    scene.add(top, wall);
    pickables.push(top);
    return {
      p, lift: 0, target: LIFT.idle,
      setLift(v) { top.position.y = v; for (const [i, g] of tops) wAttr.array[i * 3 + 1] = g + v; wAttr.needsUpdate = true; },
      look(state, dim) {
        mat.color.set(state === 'sel' ? COL.sel : state === 'hover' ? COL.hover : baseCol);
        const op = dim ? 0.1 : state ? 1 : baseOp;
        mat.opacity = op; mat.transparent = op < 1; mat.depthWrite = op >= 1; mat.needsUpdate = true;
        wMat.opacity = dim ? 0.3 : 1;
      },
    };
  }

  function makeMarker(p) { // участок без установленных границ: круг условной площади и вешка
    const [x, y] = p.c, r = Math.sqrt((p.ha * 1e4) / Math.PI), pts = [];
    let top = hAt(x, y);
    for (let a = 0; a <= 96; a++) { const t = (a / 96) * Math.PI * 2, qx = x + Math.cos(t) * r, qy = y + Math.sin(t) * r, h = hAt(qx, qy); top = Math.max(top, h); pts.push(new THREE.Vector3(qx, h + 30, -qy)); }
    const loop = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: COL.red, dashSize: 130, gapSize: 90 }));
    loop.computeLineDistances();
    const dMat = new THREE.MeshBasicMaterial({ color: COL.sale, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 72), dMat);
    disc.rotation.x = -Math.PI / 2; disc.position.set(x, top + 36, -y); disc.userData.id = p.id;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 560, 8), new THREE.MeshBasicMaterial({ color: '#14271F' }));
    pole.position.set(x, hAt(x, y) + 280, -y);
    const cap = new THREE.Mesh(new THREE.OctahedronGeometry(105), new THREE.MeshLambertMaterial({ color: COL.red }));
    cap.position.set(x, hAt(x, y) + 620, -y);
    scene.add(loop, disc, pole, cap);
    pickables.push(disc);
    return { p, lift: 0, target: 0, setLift() {}, look(state, dim) { dMat.opacity = dim ? 0.08 : state === 'sel' ? 0.62 : state === 'hover' ? 0.45 : 0.25; dMat.color.set(state === 'sel' ? COL.sel : COL.sale); } };
  }

  for (const p of parcels) {
    if (p.rings) items.set(p.id, makeParcel(p));
    else if (p.c) items.set(p.id, makeMarker(p));
  }
  function refresh() {
    for (const [id, it] of items) {
      const state = id === selId ? 'sel' : id === hovId ? 'hover' : '', dim = !state && filter && !filter.has(id);
      it.target = state === 'sel' ? LIFT.sel : state === 'hover' ? LIFT.hover : dim ? LIFT.dim : LIFT.idle;
      it.look(state, dim);
    }
    dirty = true;
  }

  // ---------- подписи деревень и направлений
  const layer = document.createElement('div');
  layer.className = 'map-labels';
  host.appendChild(layer);
  const labels = [];
  function addLabel(text, x, y, cls, prio) {
    const s = document.createElement('span');
    s.className = 'ml ' + cls; s.textContent = text; layer.appendChild(s);
    labels.push({ el: s, v: new THREE.Vector3(x, hAt(x, y) + 70, -y), w: text.length * 7.4 + 16, prio });
  }
  const withC = parcels.filter((p) => p.c);
  for (const pl of places) {
    if (!pl.name) continue;
    const near = Math.min(...withC.map((p) => Math.hypot(p.c[0] - pl.x, p.c[1] - pl.y)));
    if (near < 3200) addLabel(pl.name, pl.x, pl.y, pl.kind === 'village' ? 'village' : '', pl.kind === 'village' ? 1 : 2 + near / 10000);
  }
  // хозяйства, лесничество, урочища, реки: чем мельче объект, тем раньше подпись уступает место другим
  const NAME_PRIO = { farm: 0.3, org: 1.6, water: 2.6, loc: 3.2 };
  for (const nm of map.names || []) addLabel(nm.t, nm.x, nm.y, 'nm-' + nm.k, NAME_PRIO[nm.k] || 3.5);
  // лучи от центра массива к городам: пунктир до края схемы, стрелка и подпись с расстоянием по дороге
  const [ccx, ccy] = meta.center;
  for (const c of meta.cities) {
    if (!c.onMap) continue;
    const tMax = Math.min((W / 2 - 500 - Math.sign(c.dx) * ccx) / Math.abs(c.dx || 1e-9), (H / 2 - 500 - Math.sign(c.dy) * ccy) / Math.abs(c.dy || 1e-9));
    const pts = [];
    for (let t = 700; t <= tMax; t += 140) { const x = ccx + c.dx * t, y = ccy + c.dy * t; pts.push(new THREE.Vector3(x, hAt(x, y) + 95, -y)); }
    const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: '#14271F', dashSize: 170, gapSize: 130 }));
    ray.computeLineDistances();
    const tip = new THREE.Mesh(new THREE.ConeGeometry(85, 300, 14), new THREE.MeshBasicMaterial({ color: '#14271F' }));
    tip.position.copy(pts[pts.length - 1]);
    tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(c.dx, 0, -c.dy).normalize());
    scene.add(ray, tip);
    const tl = Math.min(tMax - 300, 5200); // подпись ставим ближе к массиву, чтобы она попадала в кадр
    addLabel(`${c.name}: ${c.road || c.km} км`, ccx + c.dx * tl, ccy + c.dy * tl, 'way', 0);
  }
  let hw = null;
  for (const r of map.roads) if (r.k === 'main') for (let i = 0; i < r.p.length; i += 2) {
    const x = r.p[i], y = r.p[i + 1], d = Math.hypot(x - ccx, y - ccy);
    if (Math.abs(x) < W / 2 - 300 && Math.abs(y) < H / 2 - 300 && (!hw || d < hw[2])) hw = [x, y, d];
  }
  if (hw) addLabel('трасса Р-132', hw[0], hw[1], 'road', 0.5);
  labels.sort((a, c) => a.prio - c.prio);
  const tmp = new THREE.Vector3();
  function placeLabels() {
    const w = el.clientWidth, h = el.clientHeight, used = [];
    for (const L of labels) {
      tmp.copy(L.v).project(camera);
      const sx = (tmp.x * 0.5 + 0.5) * w, sy = (-tmp.y * 0.5 + 0.5) * h;
      let ok = tmp.z < 1 && sx > 30 && sx < w - 30 && sy > 24 && sy < h - 10;
      if (ok) for (const u of used) if (Math.abs(u[0] - sx) < (u[2] + L.w) / 2 && Math.abs(u[1] - sy) < 19) { ok = false; break; }
      if (ok) { used.push([sx, sy, L.w]); L.el.style.transform = `translate(${Math.round(sx)}px,${Math.round(sy)}px) translate(-50%,-100%)`; }
      L.el.style.visibility = ok ? 'visible' : 'hidden';
    }
  }

  // ---------- камера
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const p of parcels) if (p.rings && p.group === 'main') for (let i = 0; i < p.rings[0].length; i += 2) {
    bx0 = Math.min(bx0, p.rings[0][i]); bx1 = Math.max(bx1, p.rings[0][i]); by0 = Math.min(by0, p.rings[0][i + 1]); by1 = Math.max(by1, p.rings[0][i + 1]);
  }
  // на широком экране справа лежит панель: сдвигаем центр картинки влево и считаем свободную ширину
  const sidePad = () => (host.clientWidth > 820 ? 368 : 0);
  const fit = (size) => size * 1.5 * Math.max(1, (1.25 * host.clientHeight) / Math.max(200, host.clientWidth - sidePad()));
  const homeView = () => ({ tx: (bx0 + bx1) / 2, ty: hAt((bx0 + bx1) / 2, (by0 + by1) / 2), tz: -(by0 + by1) / 2, dist: fit(Math.max(bx1 - bx0, by1 - by0)) });
  const VIEWS = { plan: { polar: 0.05, azim: 0 }, relief: { polar: 0.9, azim: -0.4 } };
  let anim = null;
  function put(v) {
    controls.target.set(v.tx, v.ty, v.tz);
    camera.position.setFromSphericalCoords(v.dist, v.polar, v.azim).add(controls.target);
    camera.lookAt(controls.target);
    dirty = true;
  }
  function now() {
    const sp = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    return { tx: controls.target.x, ty: controls.target.y, tz: controls.target.z, dist: sp.radius, polar: sp.phi, azim: sp.theta };
  }
  function fly(to, ms = 900) {
    const from = now(), goal = Object.assign({}, from, to);
    goal.dist = Math.min(controls.maxDistance, Math.max(controls.minDistance, goal.dist));
    if (reduce || !ms) { put(goal); return; }
    anim = { from, goal, t0: performance.now(), ms };
  }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    if (sidePad()) camera.setViewOffset(w, h, sidePad() / 2, -30, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    dirty = true;
  }
  new ResizeObserver(resize).observe(host);
  resize();
  put(Object.assign(homeView(), reduce ? VIEWS.relief : VIEWS.plan));
  if (!reduce) setTimeout(() => fly(VIEWS.relief, 2200), 500); // единственная анимация при загрузке: план поднимается в рельеф

  // ---------- указатель
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let down = null;
  function pick(e) {
    const r = el.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    return hit ? hit.object.userData.id : null;
  }
  const hover = (id, e) => { if (id !== hovId) { hovId = id; refresh(); el.style.cursor = id ? 'pointer' : ''; } if (cb.onHover) cb.onHover(id ? items.get(id).p : null, e); };
  el.addEventListener('pointermove', (e) => { if (!down && e.pointerType !== 'touch') hover(pick(e), e); });
  el.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; controls.enableZoom = true; anim = null; });
  el.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6 && cb.onSelect) { const id = pick(e); cb.onSelect(id ? items.get(id).p : null); }
    down = null;
  });
  el.addEventListener('pointerleave', (e) => { hover(null, e); if (e.pointerType !== 'touch') controls.enableZoom = false; });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  controls.addEventListener('change', () => { dirty = true; });

  let lastAz = null;
  function frame(t) {
    requestAnimationFrame(frame);
    if (anim) {
      const q = Math.min(1, (t - anim.t0) / anim.ms), e = q < 0.5 ? 4 * q * q * q : 1 - Math.pow(-2 * q + 2, 3) / 2, v = {};
      for (const key in anim.goal) v[key] = anim.from[key] + (anim.goal[key] - anim.from[key]) * e;
      put(v);
      if (q === 1) anim = null;
    }
    controls.update();
    for (const it of items.values()) if (Math.abs(it.target - it.lift) > 0.4) { it.lift += (it.target - it.lift) * (reduce ? 1 : 0.2); it.setLift(it.lift); dirty = true; }
    if (!dirty) return;
    dirty = false;
    renderer.render(scene, camera);
    placeLabels();
    const az = controls.getAzimuthalAngle();
    if (az !== lastAz && cb.onAzimuth) { lastAz = az; cb.onAzimuth(az); }
  }
  requestAnimationFrame(frame);

  return {
    select(id, move = true) {
      selId = id && items.has(id) ? id : null; refresh();
      const p = selId && items.get(selId).p;
      if (!p || !move) return;
      let size = 2 * Math.sqrt((p.ha * 1e4) / Math.PI);
      if (p.rings) { const xs = [], ys = []; for (let i = 0; i < p.rings[0].length; i += 2) { xs.push(p.rings[0][i]); ys.push(p.rings[0][i + 1]); } size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)); }
      const cur = now();
      fly({ tx: p.c[0], ty: hAt(p.c[0], p.c[1]), tz: -p.c[1], dist: Math.max(5200, fit(size) * 2.1), polar: cur.polar < 0.3 ? cur.polar : VIEWS.relief.polar });
    },
    setFilter(ids) { filter = ids ? new Set(ids) : null; refresh(); },
    view(name) { fly(VIEWS[name], 1000); },
    home() { fly(homeView(), 1000); },
    zoom(f) { fly({ dist: now().dist * f }, 350); },
  };
}
