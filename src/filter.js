// Filtr vozidel: druh dopravy, druh vlaku, kraj, město (MHD), dopravce a linky Zlín–Otrokovice.
// Ukládá se do localStorage (store.setFilter), takže platí i po dalším otevření aplikace.
import { applyTypeColors } from './colors.js';
import { store, sortLines } from './store.js';
import { vehicleType } from './dszo.js';
import { TRAIN_KINDS } from './trains.js';
import { KINDS, REGIONS, NETWORK_NAMES, BUS_CARRIERS, EMPTY_FILTER, effectiveKinds, filterActive, filterCount, describeFilter } from './filtering.js';

const sheet = document.getElementById('filter-sheet');
const badge = document.getElementById('filter-badge');
const activeBar = document.getElementById('active-filter');
const linesEl = document.getElementById('filter-lines');
const kindsEl = document.getElementById('filter-kinds');
const trainSection = document.getElementById('filter-trains');
const trainKindsEl = document.getElementById('filter-train-kinds');
const regionsEl = document.getElementById('filter-regions');
const networksEl = document.getElementById('filter-networks');
const carriersEl = document.getElementById('filter-carriers');

let knownLines = new Map(); // ref -> type

export function setKnownLines(lines) {
  knownLines = new Map(lines.map((l) => [l.ref, l.type]));
  if (!sheet.hidden) renderLines();
}

function linesFromVehicles() {
  for (const v of store.vehicles) if (!knownLines.has(v.line)) knownLines.set(v.line, v.type ?? vehicleType(v.id));
}

const toggle = (list = [], x) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

function renderLines() {
  linesFromVehicles();
  const f = store.filter;
  const kinds = f.kinds;
  linesEl.replaceChildren();
  for (const ref of sortLines(knownLines.keys())) {
    const type = knownLines.get(ref);
    // Vybraný jen trolejbus nebo jen autobus: linky druhého typu schováme.
    if (kinds.length && !kinds.includes(type === 'trolleybus' ? 'trolleybus' : 'mhd') && !f.lines.includes(ref)) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `line-toggle${f.lines.includes(ref) ? ' on' : ''}`;
    applyTypeColors(b, type);
    b.textContent = ref;
    b.addEventListener('click', () => store.setFilter({ lines: toggle(store.filter.lines, ref) }));
    linesEl.append(b);
  }
}

function chip(label, on, onClick, color, text) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `chip-toggle${on ? ' on' : ''}`;
  b.setAttribute('aria-pressed', String(on));
  if (color) b.style.setProperty('--chip-color', color);
  if (text) b.style.setProperty('--chip-text', text);
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/** Řada přepínačů jedné skupiny filtru: items = [[klíč, popisek, barva, písmo]]. */
function chips(el, key, items) {
  const f = store.filter;
  el.replaceChildren(...items.map(([value, label, color, text]) => chip(label, f[key].includes(value), () => store.setFilter({ [key]: toggle(store.filter[key], value) }), color, text)));
}

function renderChips() {
  const f = store.filter;
  chips(kindsEl, 'kinds', Object.entries(KINDS).map(([k, x]) => [k, x.label, x.color, x.text]));
  const kinds = effectiveKinds(f);
  trainSection.hidden = kinds.length > 0 && !kinds.includes('train') && !f.trainKinds.length;
  chips(trainKindsEl, 'trainKinds', Object.entries(TRAIN_KINDS).map(([k, x]) => [k, x.label, x.color]));
  chips(regionsEl, 'regions', Object.entries(REGIONS).map(([k, x]) => [k, x.name]));
  chips(networksEl, 'networks', Object.entries(NETWORK_NAMES).map(([k, name]) => [k, name, KINDS.mhd.color]));
  // Dopravci autobusů, které známe, a vlakoví dopravci podle vlaků, které jsou teď v kraji (a už vybraní).
  const carriers = new Map(BUS_CARRIERS.map((c) => [c.name, c]));
  for (const t of store.trains) if (!carriers.has(t.operator.short)) carriers.set(t.operator.short, { name: t.operator.short, color: t.operator.color, text: t.operator.text });
  for (const name of f.carriers) if (!carriers.has(name)) carriers.set(name, { name, color: '#636366', text: '#ffffff' });
  chips(carriersEl, 'carriers', [...carriers.values()].map((c) => [c.name, c.name, c.color, c.text]));
}

function renderState() {
  const f = store.filter;
  const count = filterCount(f);
  badge.hidden = !count;
  badge.textContent = String(count);

  activeBar.hidden = !filterActive(f);
  if (filterActive(f)) {
    activeBar.replaceChildren();
    const text = document.createElement('span');
    text.textContent = `Filtr: ${describeFilter(f, sortLines)}`;
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Zrušit';
    clear.addEventListener('click', () => store.setFilter(EMPTY_FILTER));
    activeBar.append(text, clear);
  }
  if (!sheet.hidden) {
    renderChips();
    renderLines();
  }
}

export function openFilter() {
  sheet.hidden = false;
  renderState();
}

export function initFilter() {
  document.getElementById('filter-open').addEventListener('click', openFilter);
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) sheet.hidden = true;
  });
  document.getElementById('filter-reset').addEventListener('click', () => store.setFilter(EMPTY_FILTER));
  let last = '';
  store.subscribe(() => {
    const key = JSON.stringify(store.filter);
    if (key !== last) {
      last = key;
      renderState();
    }
  });
  renderState();
}
