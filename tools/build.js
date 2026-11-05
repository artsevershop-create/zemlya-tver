// Готовит данные сайта из data/raw: site/data/parcels.json, map.json, dem.bin, а также копирует библиотеку и шрифты.
// Запуск: node tools/build.js
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(SITE, 'data');
const R = 20037508.34;
const toLon = (x) => (x / R) * 180;
const toLat = (y) => (Math.atan(Math.exp((y / R) * Math.PI)) * 360) / Math.PI - 90;
const merc = (lon, lat) => [(lon / 180) * R, (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / Math.PI) * R];

const b = JSON.parse(fs.readFileSync(path.join(RAW, 'bbox.json'), 'utf8'));
const Xc = (b.x0 + b.x1) / 2, Yc = (b.y0 + b.y1) / 2;
const K = Math.cos((toLat(Yc) * Math.PI) / 180);
const loc = (X, Y) => [(X - Xc) * K, (Y - Yc) * K]; // местные метры: x на восток, y на север
const ll = (lon, lat) => { const m = merc(lon, lat); return loc(m[0], m[1]); };
const W = (b.x1 - b.x0) * K, H = (b.y1 - b.y0) * K;

// ---------- рельеф
const TS = 256, NPX = 2 ** 12 * TS, tiles = {};
for (const f of fs.readdirSync(path.join(RAW, 'dem'))) {
  const m = f.match(/_(\d+)_(\d+)\.png$/);
  const png = PNG.sync.read(fs.readFileSync(path.join(RAW, 'dem', f)));
  const a = new Float32Array(TS * TS);
  for (let i = 0; i < TS * TS; i++) a[i] = png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768;
  tiles[m[1] + '_' + m[2]] = a;
}
const px = (gx, gy) => { const t = tiles[Math.floor(gx / TS) + '_' + Math.floor(gy / TS)]; return t ? t[(gy % TS) * TS + (gx % TS)] : NaN; };
function elevMerc(X, Y) {
  const fx = ((X + R) / (2 * R)) * NPX - 0.5, fy = ((R - Y) / (2 * R)) * NPX - 0.5;
  const x = Math.floor(fx), y = Math.floor(fy), u = fx - x, v = fy - y;
  const a = px(x, y), bb = px(x + 1, y), c = px(x, y + 1), d = px(x + 1, y + 1);
  if ([bb, c, d].some(Number.isNaN)) return a;
  return a * (1 - u) * (1 - v) + bb * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
const CELL = 50, nx = Math.floor(W / CELL) + 1, ny = Math.floor(H / CELL) + 1, west = -W / 2, north = H / 2;
let dem = new Float32Array(nx * ny);
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) dem[j * nx + i] = elevMerc((west + i * CELL) / K + Xc, (north - j * CELL) / K + Yc);
for (let pass = 0; pass < 2; pass++) {
  const o = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let s = 0, n = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < nx && jj < ny) { s += dem[jj * nx + ii]; n++; }
    }
    o[j * nx + i] = s / n;
  }
  dem = o;
}
function hAt(x, y) {
  const fx = Math.min(nx - 1.001, Math.max(0, (x - west) / CELL)), fy = Math.min(ny - 1.001, Math.max(0, (north - y) / CELL));
  const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
  return dem[j * nx + i] * (1 - u) * (1 - v) + dem[j * nx + i + 1] * u * (1 - v) + dem[(j + 1) * nx + i] * (1 - u) * v + dem[(j + 1) * nx + i + 1] * u * v;
}
let dmin = Infinity, dmax = -Infinity;
const demI = new Int16Array(nx * ny);
for (let i = 0; i < dem.length; i++) { dmin = Math.min(dmin, dem[i]); dmax = Math.max(dmax, dem[i]); demI[i] = Math.round(dem[i] * 10); }

// ---------- геометрия
function simplify(pts, tol) { // Дуглас — Пекер, pts: [[x,y],...]
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, c] = stack.pop();
    let md = 0, mi = -1;
    for (let i = a + 1; i < c; i++) { const d = segDist(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[c][0], pts[c][1]); if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, c]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function segDist(px0, py0, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px0 - ax) * dx + (py0 - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px0 - ax - t * dx, py0 - ay - t * dy);
}
const flat = (pts) => { const o = []; for (const p of pts) o.push(Math.round(p[0]), Math.round(p[1])); return o; };
const inBox = (p, m) => p[0] > -W / 2 - m && p[0] < W / 2 + m && p[1] > -H / 2 - m && p[1] < H / 2 + m;
function stitch(ways) { // собирает замкнутые кольца из отрезков мультиполигона
  const rings = [], pool = ways.map((w) => w.slice());
  const key = (p) => p[0].toFixed(1) + ',' + p[1].toFixed(1);
  while (pool.length) {
    let cur = pool.pop(), grown = true;
    while (key(cur[0]) !== key(cur[cur.length - 1]) && grown) {
      grown = false;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i], end = key(cur[cur.length - 1]);
        if (key(w[0]) === end) { cur = cur.concat(w.slice(1)); pool.splice(i, 1); grown = true; break; }
        if (key(w[w.length - 1]) === end) { cur = cur.concat(w.slice().reverse().slice(1)); pool.splice(i, 1); grown = true; break; }
      }
    }
    if (cur.length > 3 && key(cur[0]) === key(cur[cur.length - 1])) rings.push(cur);
  }
  return rings;
}

// ---------- карта OSM
const osm = JSON.parse(fs.readFileSync(path.join(RAW, 'osm.json'), 'utf8')).elements;
const geomPts = (g) => g.filter(Boolean).map((p) => ll(p.lon, p.lat));
const roads = [], rivers = [], water = [], forest = [], places = [];
const ROAD = { primary: 'main', trunk: 'main', motorway: 'main', secondary: 'main', tertiary: 'regional', unclassified: 'local', residential: 'local', track: 'track', service: 'track' };
for (const e of osm) {
  const t = e.tags || {};
  if (e.type === 'node' && t.place) { const p = ll(e.lon, e.lat); if (inBox(p, 0)) places.push({ name: t.name, kind: t.place, x: Math.round(p[0]), y: Math.round(p[1]) }); continue; }
  if (e.type === 'way' && t.highway) { const pts = geomPts(e.geometry); if (pts.some((p) => inBox(p, 200))) roads.push({ k: ROAD[t.highway], ref: t.ref || '', name: t.name || '', pts: simplify(pts, 4) }); continue; }
  if (e.type === 'way' && t.waterway) { const pts = geomPts(e.geometry); if (pts.some((p) => inBox(p, 200))) rivers.push({ k: t.waterway, name: t.name || '', pts: simplify(pts, 4) }); continue; }
  const target = t.natural === 'water' ? water : (t.natural === 'wood' || t.landuse === 'forest') ? forest : null;
  if (!target) continue;
  let rings = [];
  if (e.type === 'way') { const pts = geomPts(e.geometry); if (pts.length > 3) rings = [pts]; }
  else {
    const outer = e.members.filter((m) => m.type === 'way' && m.geometry && m.role !== 'inner').map((m) => geomPts(m.geometry));
    const inner = e.members.filter((m) => m.type === 'way' && m.geometry && m.role === 'inner').map((m) => geomPts(m.geometry));
    rings = stitch(outer).concat(stitch(inner));
  }
  rings = rings.filter((r) => r.some((p) => inBox(p, 300))).map((r) => simplify(r, target === forest ? 12 : 5)).filter((r) => r.length > 3);
  if (rings.length) target.push(rings.map(flat));
}

// ---------- участки
const RATE = { A: 70000, B: 50000, C: 35000 }; // базовые ставки, ₽/га: те же, что в таблице «Реестр и оценка участков»
const reg = {};
fs.readFileSync(path.join(ROOT, 'data', 'registry.csv'), 'utf8').trim().split(/\r?\n/).slice(1).forEach((l) => {
  const [kn, area, lm, dist] = l.split(',');
  reg[kn] = { area: +area, lm, dist: dist === '' ? null : +dist };
});
const roadSegs = [], riverSegs = [];
for (const r of roads) for (let i = 1; i < r.pts.length; i++) roadSegs.push([r.pts[i - 1][0], r.pts[i - 1][1], r.pts[i][0], r.pts[i][1], r]);
for (const r of rivers) for (let i = 1; i < r.pts.length; i++) riverSegs.push([r.pts[i - 1][0], r.pts[i - 1][1], r.pts[i][0], r.pts[i][1], r]);
function nearest(pts, segs, filter) {
  let best = Infinity, obj = null;
  for (const s of segs) {
    if (filter && !filter(s[4])) continue;
    for (const p of pts) { const d = segDist(p[0], p[1], s[0], s[1], s[2], s[3]); if (d < best) { best = d; obj = s[4]; } }
  }
  return { d: Math.round(best), obj };
}
function densify(ring, step) {
  const o = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length], n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / step));
    for (let k = 0; k < n; k++) o.push([a[0] + ((c[0] - a[0]) * k) / n, a[1] + ((c[1] - a[1]) * k) / n]);
  }
  return o;
}
function inside(x, y, rings) {
  let c = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
}
const hav = (lat, lon) => { const T = [56.8587, 35.9176], rad = (v) => (v * Math.PI) / 180; const a = Math.sin(rad(T[0] - lat) / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(T[0])) * Math.sin(rad(T[1] - lon) / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(a)); };
const ptsDist = (d) => (d === null ? 1 : d <= 500 ? 3 : d <= 1000 ? 2 : d <= 1500 ? 1 : 0);
const ptsSize = (g) => (g < 2 ? 0 : g < 5 ? 2 : g < 50 ? 3 : g < 100 ? 2 : 1);

const parcels = [];
const SKIP = new Set(['69:32:0000013:320']); // по НСПД собственность муниципальная
for (const f of fs.readdirSync(path.join(RAW, 'nspd'))) {
  const raw = JSON.parse(fs.readFileSync(path.join(RAW, 'nspd', f), 'utf8'));
  if (SKIP.has(raw.kn)) continue;
  const r = reg[raw.kn], o = raw.options || {};
  const quarter = raw.kn.split(':')[2] === '0000009' ? '9' : '13', n = raw.kn.split(':')[3];
  const areaM2 = r ? r.area : (o.land_record_area || o.specified_area || o.declared_area || 0);
  const ha = areaM2 / 10000;
  const p = { id: quarter + '-' + n, kn: raw.kn, n, group: r ? 'main' : 'reserve', ha: +ha.toFixed(2), vri: o.permitted_use_established_by_document || '', cad: o.cost_value || null };
  const shared = o.right_type === 'Общая долевая собственность';
  let pts = [];
  if (raw.geometry && raw.geometry.type === 'Polygon') {
    const rings = raw.geometry.coordinates.map((ring) => { const q = ring.map((c) => loc(c[0], c[1])); q.pop(); return q; });
    p.rings = rings.map(flat);
    let A = 0, cx = 0, cy = 0; const g = rings[0];
    for (let i = 0, j = g.length - 1; i < g.length; j = i++) { const cr = g[j][0] * g[i][1] - g[i][0] * g[j][1]; A += cr; cx += (g[j][0] + g[i][0]) * cr; cy += (g[j][1] + g[i][1]) * cr; }
    p.c = [Math.round(cx / (3 * A)), Math.round(cy / (3 * A))];
    pts = densify(g, 30);
    const xs = g.map((q) => q[0]), ys = g.map((q) => q[1]), hs = [];
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 40) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 40) if (inside(x, y, rings)) hs.push(hAt(x, y));
    hs.sort((a, c) => a - c);
    if (hs.length) p.elev = [Math.round(hs[Math.floor(hs.length * 0.05)]), Math.round(hs[Math.floor(hs.length * 0.95)])];
  } else if (raw.geometry && raw.geometry.type === 'Point') {
    p.c = loc(raw.geometry.coordinates[0], raw.geometry.coordinates[1]).map(Math.round); p.noBounds = true; pts = [p.c];
  } else { p.noBounds = true; p.notInCadastre = true; }
  if (pts.length) {
    const rd = nearest(pts, roadSegs, (q) => q.k !== 'track'), tr = nearest(pts, roadSegs, (q) => q.k === 'track');
    const mn = nearest([p.c], roadSegs, (q) => q.k === 'main'), rv = nearest(pts, riverSegs);
    p.road = { d: rd.d, ref: rd.obj.ref, k: rd.obj.k }; p.track = tr.d; p.main = +(mn.d / 1000).toFixed(1);
    p.water = { d: rv.d, name: rv.obj.name, k: rv.obj.k };
    let bd = Infinity, bp = null;
    for (const pl of places) for (const q of pts) { const d = Math.hypot(q[0] - pl.x, q[1] - pl.y); if (d < bd) { bd = d; bp = pl; } }
    p.place = { d: Math.round(bd), name: bp.name };
    p.tver = Math.round(hav(toLat(p.c[1] / K + Yc), toLon(p.c[0] / K + Xc)));
  }
  p.village = r ? (r.lm.startsWith('с/п') ? 'Емельяновское' : r.lm.split(' ')[0]) : (p.place ? p.place.name : '');
  if (r) {
    const score = ptsDist(r.dist) + ptsSize(ha) - (shared ? 1 : 0);
    p.cls = score >= 5 ? 'A' : score >= 3 ? 'B' : 'C';
    p.price = Math.round((ha * RATE[p.cls]) / 1000) * 1000;
  }
  p.status = p.group === 'reserve' ? 'reserve' : p.noBounds ? 'nobounds' : shared ? 'check' : 'sale';
  const tags = [];
  if (p.group === 'main') {
    if (ha >= 40) tags.push('livestock');
    if (ha >= 5 && ha < 40 && p.road && p.road.d <= 500) tags.push('farm');
    if (p.water && p.water.d <= 300 && ha <= 40 && !p.noBounds) tags.push('tourism');
    if (p.place && p.place.d <= 800 && p.road && p.road.d <= 300 && ha >= 5 && ha <= 50 && !p.noBounds) tags.push('settlement');
  }
  p.tags = tags;
  p._pts = pts;
  parcels.push(p);
}
parcels.sort((a, c) => (a.group === c.group ? c.ha - a.ha : a.group === 'main' ? -1 : 1));

// ---------- города и ближайшие населённые пункты
const mainC = parcels.filter((p) => p.group === 'main' && p.c);
const sumHa = mainC.reduce((s, p) => s + p.ha, 0);
const center = [Math.round(mainC.reduce((s, p) => s + p.c[0] * p.ha, 0) / sumHa), Math.round(mainC.reduce((s, p) => s + p.c[1] * p.ha, 0) / sumHa)];
const cLat = toLat(center[1] / K + Yc), cLon = toLon(center[0] / K + Xc);
const routes = fs.existsSync(path.join(RAW, 'routes.json')) ? JSON.parse(fs.readFileSync(path.join(RAW, 'routes.json'), 'utf8')).cities : {};
const havKm = (la1, lo1, la2, lo2) => { const rad = (v) => (v * Math.PI) / 180; const a = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2; return 2 * 6371 * Math.asin(Math.sqrt(a)); };
const cities = [['tver', 'Тверь', 56.8587, 35.9176, true], ['moscow', 'Москва', 55.7558, 37.6173, true], ['staritsa', 'Старица', 56.5145, 34.9337, true], ['rzhev', 'Ржев', 56.2624, 34.3282, false]].map(([id, name, lat, lon, onMap]) => {
  const ex = (lon - cLon) * Math.cos((cLat * Math.PI) / 180) * 111.32, ny2 = (lat - cLat) * 110.57, len = Math.hypot(ex, ny2);
  return { id, name, onMap, km: Math.round(havKm(cLat, cLon, lat, lon)), road: routes[id] ? routes[id].km : null, min: routes[id] ? routes[id].min : null, dx: +(ex / len).toFixed(4), dy: +(ny2 / len).toFixed(4), ex: Math.round(ex), ny: Math.round(ny2) };
});
const near = places.filter((pl) => pl.name).map((pl) => {
  let d = Infinity;
  for (const p of mainC) for (const q of p._pts) d = Math.min(d, Math.hypot(q[0] - pl.x, q[1] - pl.y));
  return { name: pl.name, kind: pl.kind, d: Math.round(d) };
}).filter((v) => v.d <= 2500).sort((a, c) => a.d - c.d);

// ---------- расчётные варианты раздела самых перспективных участков
const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return Math.abs(a) / 2; };
function clipHP(poly, ax, ay, c) { // оставляет часть многоугольника, где x*ax + y*ay <= c
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], bb = poly[(i + 1) % poly.length], da = a[0] * ax + a[1] * ay - c, db = bb[0] * ax + bb[1] * ay - c;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); out.push([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t]); }
  }
  return out;
}
function equalSlices(poly, ax, ay, n) { // n равных по площади полос вдоль направления (ax, ay)
  const pr = poly.map((p) => p[0] * ax + p[1] * ay), lo = Math.min(...pr), hi = Math.max(...pr), total = ringArea(poly), cuts = [lo - 1];
  for (let k = 1; k < n; k++) {
    let a = lo, c = hi;
    for (let it = 0; it < 40; it++) { const m = (a + c) / 2; if (ringArea(clipHP(poly, ax, ay, m)) < (total * k) / n) a = m; else c = m; }
    cuts.push((a + c) / 2);
  }
  cuts.push(hi + 1);
  const out = [];
  for (let k = 0; k < n; k++) { const piece = clipHP(clipHP(poly, ax, ay, cuts[k + 1]), -ax, -ay, -cuts[k]); if (piece.length > 2) out.push(piece); }
  return out;
}
const unflat = (r) => { const o = []; for (let i = 0; i < r.length; i += 2) o.push([r[i], r[i + 1]]); return o; };
const cand = parcels.filter((p) => p.group === 'main' && p.status === 'sale' && p.rings && p.rings.length === 1 && p.ha >= 19)
  .map((p) => ({ p, s: (p.road.d <= 30 ? 2 : p.road.d <= 300 ? 1 : 0) + (p.place.d <= 600 ? 1 : 0) + (p.cls === 'A' ? 1 : 0) }))
  .sort((a, c) => c.s - a.s || c.p.ha - a.p.ha).slice(0, 5);
for (const { p } of cand) {
  const g = unflat(p.rings[0]), total = ringArea(g);
  let dx = 0, dy = 0, tx = 0, ty = 0, wsum = 0;
  for (const s of roadSegs) {
    if (s[4].k === 'track') continue;
    let d = Infinity;
    for (const q of p._pts) d = Math.min(d, segDist(q[0], q[1], s[0], s[1], s[2], s[3]));
    if (d > 90) continue;
    let vx = s[2] - s[0], vy = s[3] - s[1];
    const len = Math.hypot(vx, vy);
    if (!len) continue;
    if (vx * dx + vy * dy < 0) { vx = -vx; vy = -vy; }
    dx += vx; dy += vy; tx += ((s[0] + s[2]) / 2) * len; ty += ((s[1] + s[3]) / 2) * len; wsum += len;
  }
  let kind = 'strips', pieces = [], rest = null;
  if (wsum) {
    const l = Math.hypot(dx, dy); dx /= l; dy /= l;
    let nx2 = -dy, ny2 = dx;
    if (p.c[0] * nx2 + p.c[1] * ny2 < (tx / wsum) * nx2 + (ty / wsum) * ny2) { nx2 = -nx2; ny2 = -ny2; }
    const front = Math.min(...g.map((q) => q[0] * nx2 + q[1] * ny2)), DEPTH = 220;
    const band = clipHP(g, nx2, ny2, front + DEPTH), share = ringArea(band) / total;
    if (p.road.d <= 30 && share > 0.12 && share < 0.6) {
      kind = 'front';
      pieces = equalSlices(band, dx, dy, Math.max(2, Math.round(ringArea(band) / 30000)));
      rest = clipHP(g, -nx2, -ny2, -(front + DEPTH));
    } else pieces = equalSlices(g, dx, dy, Math.max(3, Math.round(total / 80000)));
  } else {
    const mx = g.reduce((s, q) => s + q[0], 0) / g.length, my = g.reduce((s, q) => s + q[1], 0) / g.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const q of g) { sxx += (q[0] - mx) ** 2; syy += (q[1] - my) ** 2; sxy += (q[0] - mx) * (q[1] - my); }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    pieces = equalSlices(g, Math.cos(ang), Math.sin(ang), Math.max(3, Math.round(total / 80000)));
  }
  const all = rest ? pieces.concat([rest]) : pieces, scale = p.ha / (all.reduce((s, r) => s + ringArea(r), 0) / 10000);
  p.split = {
    kind,
    lots: all.map((r, i) => ({
      id: p.n + '-' + (i + 1), ha: +((ringArea(r) / 10000) * scale).toFixed(1), rest: r === rest || undefined, ring: flat(r),
      road: nearest(densify(r, 30), roadSegs, (q) => q.k !== 'track').d <= 40,
    })),
  };
}
for (const p of parcels) delete p._pts;

// ---------- запись
fs.mkdirSync(OUT, { recursive: true });
const main = parcels.filter((p) => p.group === 'main');
const meta = {
  generated: new Date().toISOString().slice(0, 10), w: Math.round(W), h: Math.round(H),
  dem: { nx, ny, cell: CELL, west: Math.round(west), north: Math.round(north), min: Math.round(dmin), max: Math.round(dmax) },
  totals: { count: main.length, ha: +main.reduce((s, p) => s + p.ha, 0).toFixed(1), price: main.reduce((s, p) => s + p.price, 0) },
  center, cities, near,
};
fs.writeFileSync(path.join(OUT, 'parcels.json'), JSON.stringify({ meta, parcels, places }));
fs.writeFileSync(path.join(OUT, 'map.json'), JSON.stringify({
  roads: roads.map((r) => ({ k: r.k, ref: r.ref, p: flat(r.pts) })), rivers: rivers.map((r) => ({ k: r.k, name: r.name, p: flat(r.pts) })), water, forest,
}));
fs.writeFileSync(path.join(OUT, 'dem.bin'), Buffer.from(demI.buffer));

const cp = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const NM = path.join(ROOT, 'node_modules');
cp(path.join(NM, 'three', 'build', 'three.module.min.js'), path.join(SITE, 'vendor', 'three.module.min.js'));
cp(path.join(NM, 'three', 'examples', 'jsm', 'controls', 'OrbitControls.js'), path.join(SITE, 'vendor', 'OrbitControls.js'));
for (const [pkg, weights] of [['golos-text', [400, 500, 600]], ['sofia-sans-extra-condensed', [700, 800]]]) {
  for (const w of weights) for (const sub of ['cyrillic', 'latin']) {
    const name = `${pkg}-${sub}-${w}-normal.woff2`;
    cp(path.join(NM, '@fontsource', pkg, 'files', name), path.join(SITE, 'fonts', name));
  }
}

const size = (f) => Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + ' KB';
console.log(`extent ${Math.round(W)}x${Math.round(H)} m, dem ${nx}x${ny}, elev ${Math.round(dmin)}..${Math.round(dmax)} m`);
console.log(`roads ${roads.length}, rivers ${rivers.length}, water ${water.length}, forest ${forest.length}, places ${places.length}`);
console.log(`files: parcels ${size('parcels.json')}, map ${size('map.json')}, dem ${size('dem.bin')}`);
console.log('totals', JSON.stringify(meta.totals), 'status', JSON.stringify(parcels.reduce((a, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {})));
for (const t of ['livestock', 'farm', 'tourism', 'settlement']) { const l = main.filter((p) => p.tags.includes(t)); console.log(t, l.length, l.reduce((s, p) => s + p.ha, 0).toFixed(0) + ' ha', l.map((p) => p.n).join(',')); }
console.log('road d', main.filter((p) => p.road).map((p) => p.n + ':' + p.road.d).join(' '));
console.log('water', main.filter((p) => p.water && p.water.d <= 300).map((p) => p.n + ':' + p.water.d + (p.water.name || p.water.k)).join(' '));
console.log('cities', cities.map((c) => `${c.name} ${c.km}/${c.road} км ${c.min} мин`).join('; '));
console.log('near', near.length, near.slice(0, 14).map((v) => v.name + ' ' + v.d).join(', '));
for (const p of parcels.filter((q) => q.split)) console.log('split', p.n, p.ha, p.village, p.split.kind, p.split.lots.map((l) => l.ha + (l.road ? '' : '!') + (l.rest ? 'R' : '')).join(' '));
const farRoad = main.filter((p) => p.road && !p.noBounds && p.road.d > 500), byPlace = main.filter((p) => p.place && !p.noBounds && p.place.d <= 400 && p.ha >= 2);
console.log('far', farRoad.length, 'byPlace', byPlace.length, 'small', main.filter((p) => p.ha < 5 && !p.noBounds).length, 'proc', main.filter((p) => !p.noBounds && p.road.ref && p.road.d <= 50 && p.ha >= 2 && p.ha <= 30).length, 'horse', main.filter((p) => !p.noBounds && p.ha >= 10 && p.ha <= 40 && p.road.d <= 300).length, 'estate', main.filter((p) => !p.noBounds && p.ha >= 2 && p.ha <= 15 && p.place.d <= 800 && p.road.d <= 300).length, 'grain', main.filter((p) => p.ha >= 20).length);
