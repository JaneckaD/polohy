// Legenda mapy: co znamenají barvy kolečka vozů, značky a čáry na mapě.
import { KINDS } from './filtering.js';
import { TRAIN_KINDS } from './trains.js';

const sheet = document.getElementById('legend-sheet');
const body = document.getElementById('legend-body');

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

/** Kolečko vozu jako na mapě: barva, text, případně šipka směru. */
function vehicle(label, color, text, { type = 'bus', arrow = null } = {}) {
  const el = h('div', 'vehicle');
  el.dataset.type = type;
  el.style.setProperty('--vehicle-color', color);
  el.style.setProperty('--vehicle-text', text);
  if (String(label).length >= 3) el.classList.add('long-label');
  const a = h('div', 'vehicle-arrow');
  if (arrow == null) a.hidden = true;
  else a.style.transform = `rotate(${arrow}deg)`;
  el.append(a, h('div', 'vehicle-dot', label));
  return el;
}

function row(samples, title, note) {
  const r = h('div', 'legend-row');
  const s = h('div', 'legend-samples');
  s.append(...samples);
  const t = h('div', 'legend-text');
  t.append(h('b', null, title));
  if (note) t.append(h('small', null, note));
  r.append(s, t);
  return r;
}

function group(title, rows) {
  const g = h('div', 'legend-group');
  g.append(h('div', 'filter-label', title));
  const list = h('div', 'legend-list');
  list.append(...rows);
  g.append(list);
  return g;
}

function render() {
  const k = KINDS;
  const t = TRAIN_KINDS;
  body.replaceChildren(
    group('Vozy a vlaky', [
      row([vehicle('4', k.tram.color, k.tram.text, { type: 'tram' })], 'Tramvaj', 'Městská doprava, v kolečku číslo linky'),
      row([vehicle('3', k.trolleybus.color, k.trolleybus.text, { type: 'trolleybus' })], 'Trolejbus', 'Městská doprava'),
      row([vehicle('31', k.mhd.color, k.mhd.text)], 'Autobus MHD', 'Městská doprava'),
      row([vehicle('371', k.regional.color, k.regional.text)], 'Regionální autobus', 'Linky mezi obcemi, živě nebo odhadem podle jízdního řádu'),
      row([vehicle('856', k.coach.color, k.coach.text), vehicle('RJ', k.coach.color, k.coach.text)], 'Dálkový autobus', 'Linky přes celou republiku a do zahraničí, živě nebo odhadem podle jízdního řádu'),
      row([vehicle('Os', t.os.color, '#fff', { type: 'train' }), vehicle('Sp', t.sp.color, '#fff', { type: 'train' })], 'Osobní a spěšný vlak', 'V kolečku druh vlaku, číslo je v detailu'),
      row([vehicle('R', t.r.color, '#fff', { type: 'train' }), vehicle('EC', t.int.color, '#fff', { type: 'train' })], 'Rychlík a mezinárodní vlak', 'R, RJ, LE, IC… a EC, EN, rj…'),
      row([vehicle('6', k.mhd.color, k.mhd.text, { arrow: 45 })], 'Šipka u kolečka', 'Směr, kterým vůz jede'),
      row([h('div', 'legend-dots')], 'Malé tečky', 'Na oddálené mapě s mnoha vozy, po přiblížení se ukážou kolečka s čísly'),
    ]),
    group('Na mapě', [
      row([h('div', 'legend-line route')], 'Trasa vybraného vozu', 'Barevně ještě pojede, šedě už projel, tečky jsou zastávky'),
      row([h('div', 'legend-line rail')], 'Železniční trať', 'Všechny tratě v oblasti'),
      row([h('div', 'legend-area')], 'Mimo oblast', 'Šrafovaná plocha, tam aplikace zatím vozy neukazuje'),
      row([h('div', 'legend-line border')], 'Hranice krajů', null),
      row([h('div', 'me')], 'Moje poloha', null),
    ]),
    group('Zpoždění v detailu', [
      row([h('span', 'legend-pill delay-ok', 'včas')], 'Včas', 'Zpoždění do 2 minut'),
      row([h('span', 'legend-pill delay-minor', '3 min')], 'Malé zpoždění', '2 až 4 minuty'),
      row([h('span', 'legend-pill delay-major', '6 min')], 'Větší zpoždění', '4 až 10 minut'),
      row([h('span', 'legend-pill delay-severe', '12 min')], 'Velké zpoždění', 'Víc než 10 minut'),
    ]),
  );
}

export function initLegend() {
  document.getElementById('legend-open').addEventListener('click', () => {
    render();
    sheet.hidden = false;
  });
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) sheet.hidden = true;
  });
}
