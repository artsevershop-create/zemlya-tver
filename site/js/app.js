import { config } from './config.js';
import { createMap } from './map3d.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nInt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nHa = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const ha = (v) => nHa.format(v) + ' га';
const money = (v) => (v >= 1e6 ? nHa.format(v / 1e6) + ' млн ₽' : nInt.format(Math.round(v / 1000)) + ' тыс. ₽');
const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m > 10 && m < 20 ? c : k === 1 ? a : k > 1 && k < 5 ? b : c; };
const lotName = (p) => `№ ${p.n} - ${ha(p.ha)}`; // единый формат названия участка
const lotsWord = (n) => plural(n, 'участок', 'участка', 'участков');
const hours = (min) => (min < 60 ? `${min} мин` : `${Math.floor(min / 60)} ч${min % 60 >= 8 ? ' ' + Math.round((min % 60) / 5) * 5 + ' мин' : ''}`);

const STATUS = {
  sale: ['В продаже', 'Участок стоит на кадастровом учёте с границами.'],
  check: ['Документы уточняются', 'В кадастре указана общая долевая собственность: состав собственников уточняется.'],
  nobounds: ['Границы не установлены', 'Точные границы в кадастре не определены. На схеме показано условное положение, перед сделкой нужно межевание.'],
  missing: ['Нет в публичном кадастре', 'Участок не найден на кадастровой карте: возможно, он был разделён. Сведения уточняются.'],
  part: ['Поле участка № 257', 'Поле входит в участок № 257 — единое землепользование из нескольких полей. Отдельно оно продаётся после раздела участка № 257 по готовым границам.'],
  reserve: ['Резерв, права уточняются', 'Документы о праве на этот участок пока не подтверждены, он показан для полноты схемы.'],
};
const statusOf = (p) => (p.notInCadastre ? 'missing' : p.status);
const B = (p) => !p.noBounds; // у участка есть границы и посчитанные расстояния

// Разделы по аудиториям. f отбирает подходящие участки, short идёт в карточку участка.
const AUD = [
  { id: 'agro', nav: 'Сельское хозяйство', title: 'Для сельского хозяйства',
    intro: 'Категория земли уже подходит: обрабатывать её можно без смены назначения.',
    uses: [
      { id: 'livestock', short: 'животноводство', title: 'Мясное и молочное животноводство', text: 'Крупные поля от 40 га под пастбища, сенокосы и собственную кормовую базу рядом с фермой.', f: (p) => p.ha >= 40 },
      { id: 'grain', short: 'лён и зерновые', title: 'Лён, зерновые и кормовые травы', text: 'Поля от 20 га удобны для техники. Лён-долгунец и многолетние травы традиционны для Тверской области.', f: (p) => p.ha >= 20 && B(p) },
      { id: 'veg', short: 'овощи и ягоды', title: 'Овощи, картофель, ягодники', text: 'Участки от 5 до 40 га не дальше 500 м от дороги: урожай проще вывозить.', f: (p) => p.tags.includes('farm') },
      { id: 'small', short: 'сад или пасека', title: 'Сад, питомник, пасека', text: 'Небольшие участки до 5 га под плодовый сад, питомник саженцев или пасеку.', f: (p) => p.ha < 5 && B(p) },
    ] },
  { id: 'tourism', nav: 'Туризм', title: 'Для туризма',
    intro: 'От Москвы сюда около трёх часов езды, от Твери час: формат поездки на выходные. Строить гостевые дома на сельхозземле можно не всегда, поэтому разрешённое использование проверяется до покупки.',
    uses: [
      { id: 'water', short: 'база отдыха у воды', title: 'База отдыха или глэмпинг у воды', text: 'Участки до 40 га в пределах 300 м от Тьмаки, Долгуши и ручьёв.', f: (p) => p.tags.includes('tourism') },
      { id: 'estate', short: 'агроусадьба', title: 'Агроусадьба и гостевая ферма', text: 'Участки от 2 до 15 га рядом с деревней и дорогой: ферма с дегустациями, мастер-классами и приёмом гостей.', f: (p) => B(p) && p.ha >= 2 && p.ha <= 15 && p.place.d <= 800 && p.road.d <= 300 },
      { id: 'horse', short: 'конный клуб', title: 'Конный клуб и конные маршруты', text: 'Участки от 10 до 40 га с подъездом: левады, манеж и маршруты по полям и вдоль леса.', f: (p) => B(p) && p.ha >= 10 && p.ha <= 40 && p.road.d <= 300 },
    ] },
  { id: 'business', nav: 'Бизнес', title: 'Для бизнеса',
    intro: 'Варианты, которые не сводятся к выращиванию. Часть из них требует сменить вид разрешённого использования земли.',
    uses: [
      { id: 'settlement', short: 'посёлок', title: 'Дачный или коттеджный посёлок', text: 'Участки от 5 до 50 га рядом с деревней и дорогой. Для застройки нужно сменить вид разрешённого использования; возможность подтверждается в администрации округа.', f: (p) => p.tags.includes('settlement') },
      { id: 'proc', short: 'хранение и переработка', title: 'Хранение и переработка продукции', text: 'Участки от 2 до 30 га у дорог региональной сети 28Н: овощехранилище, зерносушилка или цех для окрестных хозяйств.', f: (p) => B(p) && p.road.ref && p.road.d <= 50 && p.ha >= 2 && p.ha <= 30 },
      { id: 'bank', title: 'Земельный банк и продажа лотами', text: 'Покупка массива целиком, раздел крупных полей и продажа по частям. Расчётные варианты раздела показаны ниже.', f: () => true },
    ] },
  { id: 'state', nav: 'Государство', title: 'Для государства',
    intro: 'Варианты для области и округа. Они зависят от решений органов власти; здесь показано, какие участки подходят по расположению.',
    uses: [
      { id: 'buyout', title: 'Выкуп массива в областную или муниципальную собственность', text: 'При продаже сельхозземли у Тверской области есть преимущественное право покупки по цене сделки. Массив можно выкупить целиком и вернуть в оборот.', f: () => true },
      { id: 'expand', title: 'Расширение деревень и участки для жителей', text: 'Участки вплотную к деревням можно включить в границы населённых пунктов: под личные подсобные хозяйства и наделы для семей.', f: (p) => B(p) && p.place.d <= 400 && p.ha >= 2 },
      { id: 'agropark', title: 'Агропарк с готовыми наделами для фермеров', text: 'Крупные поля делятся на наделы по 5–10 га с общим подъездом: площадка для начинающих фермеров и программ развития сельских территорий.', f: (p) => p.ha >= 40 },
      { id: 'forest', title: 'Лесоразведение', text: 'Удалённые от дорог поля, которые невыгодно обрабатывать, можно передать под посадку леса.', f: (p) => B(p) && p.road.d > 500 },
    ] },
];

const state = { sel: null, use: null, sort: 'ha', dir: -1 };
const sets = {}; // ключ подборки → участки
let data, map3d = null;

const roadText = (p) => {
  if (!p.road) return 'нет данных';
  const kind = p.road.k === 'regional' ? 'региональная дорога' : p.road.k === 'main' ? 'трасса' : 'местная дорога';
  const ref = p.road.ref ? ' ' + p.road.ref : '';
  return p.road.d <= 30 ? `${kind}${ref} по границе участка` : `${nInt.format(p.road.d)} м до дороги (${kind}${ref})`;
};
const waterText = (p) => {
  if (!p.water || p.water.d > 1500) return 'дальше 1,5 км';
  const what = p.water.name ? (p.water.k === 'river' ? 'река ' : 'ручей ') + p.water.name : 'ручей';
  return p.water.d <= 30 ? `${what} по границе участка` : `${what} в ${nInt.format(p.water.d)} м`;
};
const priceText = (p) => (config.showPrices && p.price ? `${money(p.price)} <small>(${nInt.format(Math.round(p.price / p.ha / 1000))} тыс. ₽ за га)</small>` : 'по запросу');
const splitText = (p) => {
  const lots = p.split.lots.filter((l) => !l.rest), rest = p.split.lots.find((l) => l.rest);
  const a = Math.min(...lots.map((l) => l.ha)), b = Math.max(...lots.map((l) => l.ha)), size = a === b ? ha(a) : `${nHa.format(a)}–${ha(b)}`;
  return p.split.kind === 'front'
    ? `вдоль дороги ${lots.length} ${lotsWord(lots.length)} по ${size}, в глубине остаётся поле ${ha(rest.ha)}`
    : `${lots.length} ${lotsWord(lots.length)} по ${size} полосами`;
};

function renderSummary() {
  const t = data.meta.totals, main = data.parcels.filter((p) => p.group === 'main');
  const count = (s) => main.filter((p) => statusOf(p) === s).length;
  const res = data.parcels.filter((p) => p.group === 'reserve');
  $('#panel').innerHTML = `
    <h2 class="panel-h">Массив целиком</h2>
    <dl class="kv">
      <div><dt>Площадь</dt><dd>${ha(t.ha)}</dd></div>
      <div><dt>Участков</dt><dd>${t.count}</dd></div>
      <div><dt>Резерв</dt><dd>ещё ${ha(res.reduce((s, p) => s + p.ha, 0))}, права уточняются</dd></div>
      ${data.meta.cities.filter((c) => c.onMap).map((c) => `<div><dt>До ${c.name === 'Тверь' ? 'Твери' : c.name === 'Москва' ? 'Москвы' : 'Старицы'}</dt><dd>${c.road} км по дороге</dd></div>`).join('')}
      ${config.showPrices ? `<div><dt>Ориентир цены за всё</dt><dd>${money(t.price)}</dd></div>` : ''}
    </dl>
    <h3 class="panel-sub">Условные знаки</h3>
    <ul class="legend">
      <li><i class="sw sale"></i>В продаже: ${count('sale')}</li>
      <li><i class="sw sale"></i>Поля участка № 257: ${count('part')}</li>
      <li><i class="sw check"></i>Документы уточняются: ${count('check')}</li>
      ${count('nobounds') ? `<li><i class="sw nob"></i>Границы не установлены: ${count('nobounds')}</li>` : ''}
      <li><i class="sw res"></i>Резерв, права уточняются: ${res.length}</li>
      <li><i class="sw parts"></i>Вариант раздела на части</li>
      <li><i class="ln dir"></i>Направление на город</li>
      <li><i class="ln main"></i>Трасса Р-132 Тверь — Ржев</li>
      <li><i class="ln reg"></i>Региональные и местные дороги</li>
      <li><i class="ln trk"></i>Полевые дороги</li>
      <li><i class="ln riv"></i>Реки и ручьи</li>
      <li><i class="ln gas"></i>Газопровод (подземный)</li>
      <li><i class="ln pwr"></i>ЛЭП 110 и 35 кВ</li>
      <li><i class="sw wood"></i>Лес</li>
    </ul>
    <p class="panel-note">Рельеф вытянут по высоте в 9 раз, горизонтали проведены через 5 м.</p>`;
}

function renderLot(p) {
  const st = STATUS[statusOf(p)];
  const rows = [['Площадь', ha(p.ha)], ['Кадастровый номер', esc(p.kn)]];
  if (p.parent) rows.push(['В составе участка', esc(data.meta.composite.kn)]);
  if (p.vri) rows.push(['Разрешённое использование', esc(p.vri.toLowerCase())]);
  if (B(p)) {
    rows.push(['Подъезд', roadText(p)]);
    if (p.track < p.road.d && p.road.d > 30) rows.push(['Полевая дорога', p.track <= 30 ? 'по границе участка' : nInt.format(p.track) + ' м']);
    rows.push(['До трассы Р-132', nHa.format(p.main) + ' км по прямой'], ['Вода', waterText(p)], ['Ближайшая деревня', `${esc(p.place.name)}, ${nInt.format(p.place.d)} м`]);
    if (p.elev) rows.push(['Высоты', `${p.elev[0]}–${p.elev[1]} м, перепад ${p.elev[1] - p.elev[0]} м`]);
  }
  if (B(p) && p.gas != null && p.gas <= 500) rows.push(['Газопровод', p.gas <= 30 ? 'проходит по участку или вдоль границы: действует охранная зона' : `подземный, в ${nInt.format(p.gas)} м`]);
  if (B(p) && p.power && p.power.d <= 300) rows.push(['ЛЭП', `${p.power.v} кВ, ${p.power.d <= 30 ? 'проходит по участку или вдоль границы' : 'в ' + nInt.format(p.power.d) + ' м'}`]);
  if (p.farm) rows.push(['Земли хозяйства', esc(p.farm)]);
  if (p.tver) rows.push(['До Твери', p.tver + ' км по прямой']);
  if (p.group === 'main') rows.push(['Ориентир цены', priceText(p)]);
  const fits = p.group === 'main' ? AUD.flatMap((a) => a.uses).filter((u) => u.short && u.f(p)).map((u) => u.short) : [];
  $('#panel').innerHTML = `
    <button type="button" class="panel-close" id="panelClose">К массиву целиком</button>
    <h2 class="panel-h">${esc(lotName(p))}</h2>
    <p class="panel-where">у деревни ${esc(p.village)}</p>
    <p class="status s-${statusOf(p)}"><b>${st[0]}.</b> ${st[1]}</p>
    <dl class="kv">${rows.map((r) => `<div><dt>${r[0]}</dt><dd>${r[1]}</dd></div>`).join('')}</dl>
    ${fits.length ? `<p class="fits">Подходит под: ${fits.join(', ')}.</p>` : ''}
    ${p.split ? `<p class="fits">Вариант раздела: ${splitText(p)}. <a href="#split">Смотреть раздел</a></p>` : ''}
    <div class="panel-act">
      <button type="button" class="btn" id="askLot">Запросить документы</button>
      ${p.notInCadastre ? '' : `<a class="btn ghost" target="_blank" rel="noopener" href="https://nspd.gov.ru/map?thematic=PKK&query=${encodeURIComponent(p.kn)}">Открыть в кадастре</a>`}
    </div>`;
  $('#panelClose').onclick = () => select(null);
  $('#askLot').onclick = () => {
    const f = $('#fLots'), list = f.value.split(/[,\s]+/).filter(Boolean);
    if (!list.includes(p.n)) list.push(p.n);
    f.value = list.join(', ');
    $('#request').scrollIntoView({ behavior: 'smooth' });
  };
}

function select(p, move = true) {
  state.sel = p ? p.id : null;
  if (map3d) map3d.select(state.sel, move);
  if (p) renderLot(p); else renderSummary();
  document.querySelectorAll('#lotTable tbody tr').forEach((tr) => tr.classList.toggle('on', tr.dataset.id === state.sel));
  history.replaceState(null, '', p ? '#u' + p.n : location.pathname + location.search);
}

function setUse(key, force) {
  state.use = state.use === key && !force ? null : key;
  if (map3d) map3d.setFilter(state.use ? sets[state.use].map((p) => p.id) : null);
  document.querySelectorAll('[data-use]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.use === state.use)));
}

function renderAudiences() {
  const main = data.parcels.filter((p) => p.group === 'main');
  for (const a of AUD) {
    for (const u of a.uses) sets[u.id] = main.filter(u.f);
    sets[a.id] = main.filter((p) => a.uses.some((u) => u.f(p)));
  }
  const shown = new Set(); // чтобы примеры в разных строках не повторяли один и тот же участок
  $('#chips').innerHTML = AUD.map((a) => `<button type="button" data-use="${a.id}" aria-pressed="false">${a.nav}</button>`).join('');
  $('#audiences').innerHTML = AUD.map((a) => `<section class="band" id="${a.id}"><div class="wrap">
    <h2>${a.title}</h2>
    <p class="intro">${a.intro}</p>
    <div class="uses">${a.uses.map((u) => {
      const m = sets[u.id], sum = m.reduce((s, p) => s + p.ha, 0);
      const ranked = [...m].filter((p) => B(p) && p.status === 'sale').sort((x, y) => (x.road.d <= 30) === (y.road.d <= 30) ? y.ha - x.ha : x.road.d <= 30 ? -1 : 1);
      const best = m.length === main.length ? null : ranked.find((p) => !shown.has(p.id)) || ranked[0];
      if (best) shown.add(best.id);
      const eg = best ? `Например, ${lotName(best)}, у деревни ${esc(best.village)}: ${roadText(best)}${best.water.d <= 300 ? ', ' + waterText(best) : ''}.` : '';
      return `<article class="use">
        <div><h3>${u.title}</h3><p>${u.text}</p><p class="use-ex">${eg}</p></div>
        <p class="use-num"><b>${m.length}</b> ${lotsWord(m.length)}<br><b>${nInt.format(sum)}</b> га</p>
        <button type="button" class="btn ghost" data-use="${u.id}" data-jump="1" aria-pressed="false">Показать на схеме</button>
      </article>`;
    }).join('')}</div>
  </div></section>`).join('');
  $('#fPurpose').innerHTML = ['Пока выбираю', 'Сельское хозяйство', 'Туризм', 'Бизнес', 'Государственный или муниципальный проект', 'Другое'].map((t) => `<option>${t}</option>`).join('');
}

function renderWhere(map) {
  const cs = data.meta.cities, w = 560, h = 330, pad = [112, 46];
  const xs = [0, ...cs.map((c) => c.ex)], ys = [0, ...cs.map((c) => c.ny)];
  const s = Math.min((w - 2 * pad[0]) / (Math.max(...xs) - Math.min(...xs)), (h - 2 * pad[1]) / (Math.max(...ys) - Math.min(...ys)));
  const X = (v) => pad[0] + (v - Math.min(...xs)) * s, Y = (v) => pad[1] + (Math.max(...ys) - v) * s;
  $('#whereMap').innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Схема расположения участков относительно Твери, Москвы, Старицы и Ржева">
    ${cs.map((c) => `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(c.ex)}" y2="${Y(c.ny)}" class="w-line"/>`).join('')}
    ${cs.map((c) => { const end = c.ex > 60 || c.ex < 0; return `<circle cx="${X(c.ex)}" cy="${Y(c.ny)}" r="${c.id === 'moscow' ? 8 : 5.5}" class="w-city"/>
      <text x="${X(c.ex) + (end ? -12 : 12)}" y="${Y(c.ny) - 6}" text-anchor="${end ? 'end' : 'start'}" class="w-name">${c.name}</text>
      <text x="${X(c.ex) + (end ? -12 : 12)}" y="${Y(c.ny) + 11}" text-anchor="${end ? 'end' : 'start'}" class="w-km">${c.road} км по дороге</text>`; }).join('')}
    <rect x="${X(0) - 8}" y="${Y(0) - 8}" width="16" height="16" class="w-here" transform="rotate(45 ${X(0)} ${Y(0)})"/>
    <text x="${X(0)}" y="${Y(0) - 17}" text-anchor="middle" class="w-name">Участки</text>
  </svg>`;
  $('#whereList').innerHTML = cs.map((c) => `<div><dt>${c.name}</dt><dd>${c.road} км по дороге, около ${hours(c.min)} езды. По прямой ${c.km} км.</dd></div>`).join('');
  // что вокруг участков: названия с карты хозяйства и из OpenStreetMap
  const of = (k) => [...new Set((map.names || []).filter((v) => v.k === k).map((v) => v.t))];
  const main = data.parcels.filter((p) => p.group === 'main' && B(p));
  const gasNear = main.filter((p) => p.gas != null && p.gas <= 100), pwNear = main.filter((p) => p.power && p.power.d <= 100);
  const list = (a) => a.map((p) => p.n).sort((x, y) => x - y).join(', ');
  const around = [
    ['Хозяйства', `${of('farm').join(' и ')}. Участки у Аполишено, Леушкино, Бакланово, Чухино и соседних деревень — земли «Ленинского знамени» с центральной усадьбой в Гостенево; участки у Емельяново, Сафроново, Зашейково и Панофидино — земли «Красноармейца» с усадьбой в Емельяново.`],
    ['Лес и торф', `${of('org').join(', ')}. Лесные кварталы лесничества граничат со многими полями.`],
    ['Урочища и болота', of('loc').map((t) => t.replace(/^(ур|бол)\. /, '')).sort((a, c) => a.localeCompare(c, 'ru')).join(', ') + '.'],
    ['Реки и ручьи', of('water').map((t) => t.replace(/^(р|руч)\. /, '')).join(', ') + '.'],
    ['Газопровод', `Подземный газопровод пересекает массив с северо-запада на юго-восток, мимо деревни Мирная. Ближе 100 м к нему ${gasNear.length} ${lotsWord(gasNear.length)}: № ${list(gasNear)}. Вдоль трубы действует охранная зона с ограничениями на строительство.`],
    ['ЛЭП', `Линии 110 и 35 кВ. Ближе 100 м к ним ${pwNear.length} ${lotsWord(pwNear.length)}: № ${list(pwNear)}.`],
  ];
  $('#aroundList').innerHTML = around.map((r) => `<div><dt>${r[0]}</dt><dd>${esc(r[1])}</dd></div>`).join('');
  $('#whereNear').textContent =data.meta.near.slice(0, 12).map((v) => `${v.name} (${v.d < 950 ? Math.round(v.d / 10) * 10 + ' м' : nHa.format(v.d / 1000) + ' км'})`).join(', ') + '.';
}

function renderSplit() {
  const list = data.parcels.filter((p) => p.split), c = data.meta.composite;
  sets.split = list;
  sets.p257 = data.parcels.filter((p) => p.parent);
  $('#splitWhole').innerHTML = `<h3 class="sub-h">№ 257 - ${ha(c.ha)}: ${c.count} ${plural(c.count, 'поле', 'поля', 'полей')} по готовым границам</h3>
    <p class="intro">Самый большой участок, ${ha(c.ha)}, уже состоит из ${c.count} отдельных полей от ${nHa.format(c.min)} до ${ha(c.max)} у деревень ${c.villages.map(esc).join(', ')}. У каждого поля есть свои границы и кадастровый номер, поэтому делить участок проще всего по ним: кадастровому инженеру остаётся оформить раздел единого землепользования.</p>
    <button type="button" class="btn ghost" data-use="p257" data-jump="1" aria-pressed="false">Показать поля на схеме</button>`;
  $('#splitList').innerHTML = list.map((p) => {
    const pts = p.rings[0], xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
    const x0 = Math.min(...xs), y1 = Math.max(...ys), w = Math.max(...xs) - x0, h = y1 - Math.min(...ys), k = 300 / Math.max(w, h), m = 8;
    const path = (r) => { let d = ''; for (let i = 0; i < r.length; i += 2) d += `${i ? 'L' : 'M'}${((r[i] - x0) * k + m).toFixed(1)} ${((y1 - r[i + 1]) * k + m).toFixed(1)}`; return d + 'Z'; };
    const mid = (r) => { let sx = 0, sy = 0; for (let i = 0; i < r.length; i += 2) { sx += r[i]; sy += r[i + 1]; } const n = r.length / 2; return [((sx / n - x0) * k + m).toFixed(1), ((y1 - sy / n) * k + m + 4).toFixed(1)]; };
    const noRoad = p.split.lots.filter((l) => !l.road).length;
    return `<article class="cut">
      <svg viewBox="0 0 ${(w * k + 2 * m).toFixed(0)} ${(h * k + 2 * m).toFixed(0)}" role="img" aria-label="Вариант раздела участка ${p.n}">
        ${p.split.lots.map((l, i) => `<path d="${path(l.ring)}" class="${l.rest ? 'c-rest' : i % 2 ? 'c-b' : 'c-a'}"/>`).join('')}
        <path d="${path(pts)}" class="c-out"/>
        ${p.split.lots.map((l) => { const c = mid(l.ring); return `<text x="${c[0]}" y="${c[1]}" text-anchor="middle">${nHa.format(l.ha)}</text>`; }).join('')}
      </svg>
      <div>
        <h3>${lotName(p)}</h3>
        <p class="cut-where">у деревни ${esc(p.village)}; ${roadText(p)}</p>
        <p>Вариант: ${splitText(p)}.</p>
        <p class="cut-note">${noRoad ? `У ${noRoad} ${plural(noRoad, 'части', 'частей', 'частей')} нет выхода к дороге общего пользования: понадобится проезд вдоль границы или подъезд по полевой дороге.` : 'Все части выходят к дороге.'}</p>
        <button type="button" class="btn ghost" data-lot="${p.id}">Показать на схеме</button>
      </div>
    </article>`;
  }).join('');
  document.querySelectorAll('[data-lot]').forEach((b) => b.addEventListener('click', () => {
    select(data.parcels.find((p) => p.id === b.dataset.lot));
    $('#plan').scrollIntoView({ behavior: 'smooth' });
  }));
}

function renderTable() {
  const scope = $('#lotScope').value, village = $('#lotVillage').value;
  const key = { n: (p) => +p.n, village: (p) => p.village, ha: (p) => p.ha, road: (p) => (p.road && B(p) ? p.road.d : 1e9), water: (p) => (p.water && B(p) ? p.water.d : 1e9), price: (p) => p.price || 0 }[state.sort];
  const list = data.parcels.filter((p) => (scope === 'all' || p.group === 'main') && (!village || p.village === village))
    .sort((a, c) => { const x = key(a), y = key(c); return (typeof x === 'string' ? x.localeCompare(y, 'ru') : x - y) * state.dir; });
  $('#lotTable tbody').innerHTML = list.map((p) => `<tr data-id="${p.id}" class="${p.id === state.sel ? 'on' : ''} ${p.group}">
      <td><button type="button" class="lot-link">${esc(lotName(p))}</button></td>
      <td>${esc(p.village)}</td>
      <td class="num">${!B(p) ? '—' : p.road.d <= 30 ? 'у дороги' : nInt.format(p.road.d)}</td>
      <td class="num">${!B(p) ? '—' : p.water.d > 1500 ? 'дальше 1 500' : nInt.format(p.water.d)}</td>
      <td class="num price-col">${p.group === 'main' && config.showPrices ? money(p.price) : 'по запросу'}</td>
      <td><span class="tag s-${statusOf(p)}">${STATUS[statusOf(p)][0]}</span></td>
    </tr>`).join('');
  $('#lotCount').textContent = `${list.length} ${lotsWord(list.length)}, ${ha(list.reduce((s, p) => s + p.ha, 0))}`;
  document.querySelectorAll('#lotTable th button').forEach((b) => b.setAttribute('aria-sort', b.dataset.sort === state.sort ? (state.dir > 0 ? 'ascending' : 'descending') : 'none'));
}

function renderFacts() {
  const main = data.parcels.filter((p) => p.group === 'main'), drawn = main.filter(B);
  const atRoad = drawn.filter((p) => p.road.d <= 30).length, atWater = drawn.filter((p) => p.water.d <= 300).length;
  const el = drawn.filter((p) => p.elev).flatMap((p) => p.elev);
  const shared = main.filter((p) => p.status === 'check').length;
  const c = data.meta.composite, docs = main.length - c.count + 1;
  const facts = [
    ['Категория земли', 'Земли сельскохозяйственного назначения. Разрешённое использование по кадастру: для сельскохозяйственного использования или производства.'],
    ['Подъезд', `${atRoad} из ${drawn.length} участков с границами примыкают к дорогам общего пользования. Трасса Р-132 Тверь — Ржев проходит в ${nHa.format(Math.min(...drawn.map((p) => p.main)))}–${nHa.format(Math.max(...drawn.map((p) => p.main)))} км.`],
    ['Вода', `${atWater} ${lotsWord(atWater)} в пределах 300 м от Тьмаки, Долгуши или безымянных ручьёв.`],
    ['Рельеф', `Высоты участков от ${Math.min(...el)} до ${Math.max(...el)} м над уровнем моря.`],
    ['Состав', `По документам это ${docs} ${plural(docs, 'земельный участок', 'земельных участка', 'земельных участков')}. № 257 - ${ha(c.ha)} — единое землепользование из ${c.count} отдельных ${plural(c.count, 'поля', 'полей', 'полей')} от ${nHa.format(c.min)} до ${ha(c.max)}; на схеме каждое поле показано отдельно.`],
    ['Границы', `${drawn.length} из ${main.length} участков и полей стоят на кадастровом учёте с границами. № 44, 45 и 46 на публичной кадастровой карте не найдены.`],
    ['Документы', `Свидетельства о государственной регистрации права 2009–2010 годов. Актуальные выписки ЕГРН готовятся; по ${shared} участкам уточняется состав собственников.`],
    ['Коммуникации', 'Сведения об электричестве, газе и воде по каждому участку предоставляются по запросу.'],
  ];
  $('#factList').innerHTML = facts.map((f) => `<div><dt>${f[0]}</dt><dd>${f[1]}</dd></div>`).join('');
}

function setupForm() {
  const c = config.contact, ready = !!c.email;
  $('#fSend').disabled = !ready;
  $('#fNote').textContent = ready
    ? `Откроется ваша почтовая программа с готовым письмом${c.name ? ' для ' + c.name : ''}.${c.phone ? ' Телефон: ' + c.phone + '.' : ''}`
    : 'Приём запросов откроется, когда на сайте появятся контакты продавца.';
  $('#form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!ready) return;
    const f = new FormData(e.target);
    const body = [`Участки: ${f.get('lots') || 'не выбраны'}`, `Задача: ${f.get('purpose')}`, `Имя: ${f.get('name')}`, `Связь: ${f.get('contact')}`, '', f.get('note')].join('\n');
    location.href = `mailto:${c.email}?subject=${encodeURIComponent('Запрос по земле в Старицком округе')}&body=${encodeURIComponent(body)}`;
  });
}

async function start() {
  $('#draft').hidden = !config.draft;
  if (config.draft) document.documentElement.style.setProperty('--draft', $('#draft').offsetHeight + 'px');
  const [d, m, dem] = await Promise.all([
    fetch('data/parcels.json').then((r) => r.json()), fetch('data/map.json').then((r) => r.json()), fetch('data/dem.bin').then((r) => r.arrayBuffer()),
  ]);
  data = d;
  const main = data.parcels.filter((p) => p.group === 'main'), tver = data.meta.cities.find((c) => c.id === 'tver');
  $('#h1').textContent = `${nInt.format(Math.round(data.meta.totals.ha / 10) * 10)} гектаров сельхозземли в ${tver.road} километрах от Твери`;
  $('#lead').textContent = `${main.length} ${lotsWord(main.length)} от ${nHa.format(Math.min(...main.map((p) => p.ha)))} до ${nInt.format(Math.max(...main.map((p) => p.ha)))} га у деревень Старицкого округа. Двигайте схему и нажмите на участок: откроются площадь, подъезд, вода и ориентир цены.`;
  $('#genDate').textContent = 'данные на ' + data.meta.generated.split('-').reverse().join('.');
  if (!config.showPrices) document.body.classList.add('no-prices');
  renderAudiences(); renderWhere(m); renderSplit(); renderFacts(); setupForm();
  $('#lotVillage').insertAdjacentHTML('beforeend', [...new Set(main.map((p) => p.village))].sort((a, c) => a.localeCompare(c, 'ru')).map((v) => `<option>${esc(v)}</option>`).join(''));
  renderTable(); renderSummary();

  const tip = $('#tip');
  try {
    map3d = createMap($('#map'), data, m, dem, {
      onSelect: (p) => select(p),
      onHover: (p, e) => {
        tip.hidden = !p;
        if (p) { tip.textContent = lotName(p); const r = $('#plan').getBoundingClientRect(); tip.style.transform = `translate(${e.clientX - r.left + 14}px,${e.clientY - r.top + 14}px)`; }
      },
      onAzimuth: (a) => { $('#north').style.transform = `rotate(${a}rad)`; },
    });
  } catch (err) {
    console.error(err);
    $('#map').innerHTML = '<p class="map-fail">3D-схема не открылась в этом браузере. Все участки доступны в таблице ниже.</p>';
    $('#hint').hidden = true;
  }

  document.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => {
    setUse(b.dataset.use, !!b.dataset.jump); // кнопка в разделе всегда включает подборку, кнопка над схемой переключает
    if (b.dataset.jump) { select(null, false); if (map3d) map3d.home(); $('#plan').scrollIntoView({ behavior: 'smooth' }); }
  }));
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (map3d) map3d.view(b.dataset.view);
  }));
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    if (!map3d) return;
    if (b.dataset.act === 'home') map3d.home(); else map3d.zoom(b.dataset.act === 'in' ? 0.7 : 1.4);
  }));
  $('#lotScope').onchange = renderTable; $('#lotVillage').onchange = renderTable;
  document.querySelectorAll('#lotTable th button').forEach((b) => b.addEventListener('click', () => {
    if (state.sort === b.dataset.sort) state.dir = -state.dir; else { state.sort = b.dataset.sort; state.dir = ['n', 'village', 'road', 'water'].includes(state.sort) ? 1 : -1; }
    renderTable();
  }));
  $('#lotTable tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    select(data.parcels.find((p) => p.id === tr.dataset.id));
    $('#plan').scrollIntoView({ behavior: 'smooth' });
  });
  const fromHash = location.hash.match(/^#u(\d+)$/);
  if (fromHash) { const p = data.parcels.find((q) => q.n === fromHash[1]); if (p) setTimeout(() => select(p), 2900); }
}
start().catch((err) => { console.error(err); $('#panel').innerHTML = '<p class="map-fail">Данные не загрузились. Обновите страницу.</p>'; });
