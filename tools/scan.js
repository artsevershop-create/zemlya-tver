// Поиск частей единого землепользования: перебирает номера участков в квартале и сохраняет ответы НСПД в data/raw/scan.
// Запуск: node --use-system-ca tools/scan.js 69:32:0000013 150 256
const fs = require('fs');
const path = require('path');
const [quarter, from, to] = [process.argv[2], +process.argv[3], +process.argv[4]];
const DIR = path.join(__dirname, '..', 'data', 'raw', 'scan');
fs.mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(kn) {
  const file = path.join(DIR, kn.replace(/:/g, '_') + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  let out = { kn, error: 'unknown' };
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch('https://nspd.gov.ru/api/geoportal/v2/search/geoportal?thematicSearchId=1&query=' + encodeURIComponent(kn), {
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://nspd.gov.ru/map?thematic=PKK' }, signal: AbortSignal.timeout(60000),
      });
      if (r.status === 404) { out = { kn, error: 'not found' }; break; }
      if (!r.ok) { out = { kn, error: 'HTTP ' + r.status }; await sleep(1500); continue; }
      const j = await r.json();
      const f = ((j.data && j.data.features) || []).find((x) => x.properties.options && x.properties.options.cad_num === kn);
      out = f ? { kn, geometry: f.geometry, options: f.properties.options } : { kn, error: 'not found' };
      break;
    } catch (e) { out = { kn, error: e.message }; await sleep(1500); }
  }
  if (!out.error || out.error === 'not found') fs.writeFileSync(file, JSON.stringify(out));
  return out;
}

(async () => {
  const kns = [];
  for (let n = from; n <= to; n++) kns.push(`${quarter}:${n}`);
  const res = new Array(kns.length);
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (i < kns.length) { const k = i++; res[k] = await get(kns[k]); } }));
  for (const p of res) {
    const o = p.options || {};
    const m = (o.readable_address || '').match(/Ориентир ([^.]+)\./);
    console.log([p.kn.split(':')[3], p.error || p.geometry.type, o.land_record_subtype || o.subtype || '', o.specified_area || o.land_record_area || o.declared_area || '', (o.land_record_reg_date || o.registration_date || '').slice(0, 10), o.ownership_type || '', o.status || '', m ? m[1] : ''].join('|'));
  }
})();
