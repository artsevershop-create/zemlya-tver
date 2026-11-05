// Скачивает исходные данные в data/raw: границы участков (НСПД), дороги и реки (OpenStreetMap), рельеф (Terrain Tiles).
// Запуск: node --use-system-ca tools/fetch.js   (повторный запуск докачивает только недостающее)
const fs = require('fs');
const path = require('path');
const RAW = path.join(__dirname, '..', 'data', 'raw');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const R = 20037508.34;
const toLon = (x) => (x / R) * 180;
const toLat = (y) => (Math.atan(Math.exp((y / R) * Math.PI)) * 360) / Math.PI - 90;

const KNS = [
  ...[...range(36, 67), ...range(76, 96)].map((n) => '69:32:0000009:' + n),
  // 257 — единое землепользование, 235–256 — его обособленные участки (поля) со своими границами
  // 258–289 — 32 участка «Красноармейца» (884,64 га по презентации), документов о праве в папке нет: на схеме это резерв
  ...[...range(235, 291), 320].map((n) => '69:32:0000013:' + n),
];

async function getParcel(kn) {
  const file = path.join(RAW, 'nspd', kn.replace(/:/g, '_') + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  let out = { kn, error: 'unknown' };
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch('https://nspd.gov.ru/api/geoportal/v2/search/geoportal?thematicSearchId=1&query=' + encodeURIComponent(kn), {
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://nspd.gov.ru/map?thematic=PKK' },
        signal: AbortSignal.timeout(60000),
      });
      if (!r.ok) { out = { kn, error: 'HTTP ' + r.status }; await sleep(1500); continue; }
      const j = await r.json();
      const f = ((j.data && j.data.features) || []).find((x) => x.properties.options && x.properties.options.cad_num === kn);
      out = f ? { kn, geometry: f.geometry, options: f.properties.options } : { kn, error: 'not found' };
      break;
    } catch (e) { out = { kn, error: e.message }; await sleep(1500); }
  }
  if (!out.error || /404|not found/.test(out.error)) fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

async function pool(items, n, fn) {
  const res = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; res[k] = await fn(items[k]); }
  }));
  return res;
}

async function getOsm(b) {
  const file = path.join(RAW, 'osm.json');
  if (fs.existsSync(file)) return;
  const box = `(${b.s.toFixed(5)},${b.w.toFixed(5)},${b.n.toFixed(5)},${b.e.toFixed(5)})`;
  const q = `[out:json][timeout:120];(
    way[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|track|service)$"]${box};
    way[waterway~"^(river|stream)$"]${box};
    way[natural=water]${box}; relation[natural=water]${box};
    way[landuse=forest]${box}; way[natural=wood]${box};
    relation[landuse=forest]${box}; relation[natural=wood]${box};
    node[place~"^(town|village|hamlet)$"]${box};
  );out geom;`;
  for (const host of ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    try {
      const r = await fetch(host, {
        method: 'POST',
        headers: { 'User-Agent': 'zemlya-tver-site/1.0 (land plan visualisation)', 'Content-Type': 'application/x-www-form-urlencoded', Accept: '*/*' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(150000),
      });
      const t = await r.text();
      if (r.ok && t.startsWith('{')) { fs.writeFileSync(file, t); console.log('osm ok', host, t.length); return; }
      console.log('osm', host, r.status, t.slice(0, 80).replace(/\s+/g, ' '));
    } catch (e) { console.log('osm', host, 'FAIL', e.message); }
  }
}

// газопроводы, ЛЭП, названные болота и урочища
async function getExtra(b) {
  const file = path.join(RAW, 'osm_extra.json');
  if (fs.existsSync(file)) return;
  const box = `(${b.s.toFixed(5)},${b.w.toFixed(5)},${b.n.toFixed(5)},${b.e.toFixed(5)})`;
  const q = `[out:json][timeout:60];(way[man_made=pipeline]${box};way[power=line]${box};node[place=locality]${box};way[natural=wetland][name]${box};relation[natural=wetland][name]${box};);out geom;`;
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', headers: { 'User-Agent': 'zemlya-tver-site/1.0 (land plan visualisation)', 'Content-Type': 'application/x-www-form-urlencoded', Accept: '*/*' },
      body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(90000),
    });
    const t = await r.text();
    if (r.ok && t.startsWith('{')) { fs.writeFileSync(file, t); console.log('osm extra ok', t.length); } else console.log('osm extra', r.status);
  } catch (e) { console.log('osm extra FAIL', e.message); }
}

async function getDem(b) {
  const Z = 12, n = 2 ** Z;
  const tx = (lon) => Math.floor(((lon + 180) / 360) * n);
  const ty = (lat) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  const jobs = [];
  for (let x = tx(b.w); x <= tx(b.e); x++) for (let y = ty(b.n); y <= ty(b.s); y++) jobs.push([x, y]);
  let ok = 0;
  await pool(jobs, 4, async ([x, y]) => {
    const file = path.join(RAW, 'dem', `${Z}_${x}_${y}.png`);
    if (fs.existsSync(file)) { ok++; return; }
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`, { signal: AbortSignal.timeout(40000) });
        if (r.ok) { fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); ok++; return; }
      } catch (e) { await sleep(1000); }
    }
  });
  console.log(`dem tiles ${ok}/${jobs.length}`);
}

// расстояния по дорогам от центра массива до городов (открытый сервис маршрутов OSRM)
async function getRoutes(from) {
  const file = path.join(RAW, 'routes.json');
  if (fs.existsSync(file)) { // пересчитываем, только если центр сдвинулся заметно
    const was = JSON.parse(fs.readFileSync(file, 'utf8')).from;
    if (Math.abs(was[0] - from[0]) < 0.003 && Math.abs(was[1] - from[1]) < 0.002) return;
  }
  const cities = { tver: [35.9176, 56.8587], moscow: [37.6173, 55.7558], staritsa: [34.9337, 56.5145], rzhev: [34.3282, 56.2624] };
  const out = { from, cities: {} };
  for (const [k, to] of Object.entries(cities)) {
    try {
      const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${from.map((v) => v.toFixed(5)).join(',')};${to.join(',')}?overview=false`, { headers: { 'User-Agent': 'zemlya-tver-site/1.0' }, signal: AbortSignal.timeout(30000) });
      const j = await r.json();
      if (j.code === 'Ok') out.cities[k] = { km: Math.round(j.routes[0].distance / 1000), min: Math.round(j.routes[0].duration / 60) };
    } catch (e) { console.log('route', k, 'FAIL', e.message); }
  }
  if (Object.keys(out.cities).length) fs.writeFileSync(file, JSON.stringify(out));
  console.log('routes', JSON.stringify(out.cities));
}

(async () => {
  for (const d of ['nspd', 'dem']) fs.mkdirSync(path.join(RAW, d), { recursive: true });
  const parcels = await pool(KNS, 3, getParcel);
  const good = parcels.filter((p) => p.geometry);
  console.log(`parcels ${good.length}/${KNS.length}; problems: ` + parcels.filter((p) => p.error).map((p) => p.kn.split(':')[3] + ' ' + p.error).join('; '));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = (a) => { if (typeof a[0] === 'number') { x0 = Math.min(x0, a[0]); x1 = Math.max(x1, a[0]); y0 = Math.min(y0, a[1]); y1 = Math.max(y1, a[1]); } else a.forEach(walk); };
  good.forEach((p) => walk(p.geometry.coordinates));
  const M = 3300; // запас по краям в метрах проекции (около 1,8 км на местности)
  const b = { w: toLon(x0 - M), e: toLon(x1 + M), s: toLat(y0 - M), n: toLat(y1 + M), x0: x0 - M, x1: x1 + M, y0: y0 - M, y1: y1 + M };
  const bboxFile = path.join(RAW, 'bbox.json');
  const old = fs.existsSync(bboxFile) ? JSON.parse(fs.readFileSync(bboxFile, 'utf8')) : null;
  if (old && ['x0', 'x1', 'y0', 'y1'].some((k) => Math.abs(old[k] - b[k]) > 1)) { // охват изменился: карту и маршруты нужно скачать заново
    for (const f of ['osm.json', 'osm_extra.json', 'routes.json']) fs.rmSync(path.join(RAW, f), { force: true });
    console.log('bbox changed: osm and routes will be refetched');
  }
  fs.writeFileSync(bboxFile, JSON.stringify(b));
  console.log('bbox', JSON.stringify(b), 'types', [...new Set(good.map((p) => p.geometry.type))].join(','));
  await getOsm(b);
  await getExtra(b);
  await getDem(b);
  // маршруты считаем от центра участков с документами (взвешенного по площади), а не от центра охвата карты
  const regKn = new Set(fs.readFileSync(path.join(__dirname, '..', 'data', 'registry.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split(',')[0]));
  const isMain = (kn) => regKn.has(kn) || (kn.startsWith('69:32:0000013:') && +kn.split(':')[3] >= 235 && +kn.split(':')[3] <= 256);
  let sx = 0, sy = 0, sw = 0;
  for (const p of good) {
    if (!isMain(p.kn) || p.geometry.type !== 'Polygon') continue;
    const ring = p.geometry.coordinates[0], a = p.options.specified_area || p.options.land_record_area || 1;
    sx += (ring.reduce((s, c) => s + c[0], 0) / ring.length) * a; sy += (ring.reduce((s, c) => s + c[1], 0) / ring.length) * a; sw += a;
  }
  await getRoutes([toLon(sx / sw), toLat(sy / sw)]);
})();
