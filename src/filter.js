// Filtr vozidel: typ (trolejbus/autobus) a linky. Ukládá se do localStorage.
import { applyTypeColors } from './colors.js';
import { store, filterActive, sortLines } from './store.js';
import { vehicleType } from './dszo.js';
import { TRAIN_KINDS } from './trains.js';

const sheet = document.getElementById('filter-sheet');
const badge = document.getElementById('filter-badge');
const activeBar = document.getElementById('active-filter');
const linesEl = document.getElementById('filter-lines');
const typeEl = document.getElementById('filter-type');
const trainSection = document.getElementById('filter-trains');
const kindsEl = document.getElementById('filter-kinds');
const operatorsEl = document.getElementById('filter-operators');
const linesSection = linesEl.closest('.filter-section');
const RESET = { type: 'all', lines: [], trainKinds: [], operators: [] };
const TYPE_NAMES = { trolleybus: 'trolejbusy', bus: 'autobusy', train: 'vlaky' };

let knownLines = new Map(); // ref -> type

export function setKnownLines(lines) {
  knownLines = new Map(lines.map((l) => [l.ref, l.type]));
  renderLines();
}

function linesFromVehicles() {
  for (const v of store.vehicles) if (!knownLines.has(v.line)) knownLines.set(v.line, v.type ?? vehicleType(v.id));
}

function renderLines() {
  linesFromVehicles();
  const f = store.filter;
  linesEl.replaceChildren();
  for (const ref of sortLines(knownLines.keys())) {
    const type = knownLines.get(ref);
    if (f.type !== 'all' && type !== f.type) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `line-toggle${f.lines.includes(ref) ? ' on' : ''}`;
    applyTypeColors(b, type);
    b.textContent = ref;
    b.addEventListener('click', () => {
      const lines = f.lines.includes(ref) ? f.lines.filter((x) => x !== ref) : [...f.lines, ref];
      store.setFilter({ lines });
    });
    linesEl.append(b);
  }
}

function chip(label, on, onClick, color, text) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `chip-toggle${on ? ' on' : ''}`;
  if (color) b.style.setProperty('--chip-color', color);
  if (text) b.style.setProperty('--chip-text', text);
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

const toggle = (list = [], x) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

// Druhy vlaků a dopravci (dopravci z vlaků, které jsou teď v kraji, plus už vybraní).
function renderTrains() {
  const f = store.filter;
  linesSection.hidden = f.type === 'train';
  trainSection.hidden = f.type === 'trolleybus' || f.type === 'bus';
  kindsEl.replaceChildren(
    ...Object.entries(TRAIN_KINDS).map(([key, k]) =>
      chip(k.label, f.trainKinds?.includes(key), () => store.setFilter({ trainKinds: toggle(f.trainKinds, key) }), k.color),
    ),
  );
  const ops = new Map(store.trains.map((t) => [t.operator.short, t.operator]));
  for (const o of f.operators ?? []) if (!ops.has(o)) ops.set(o, { color: '#636366', text: '#ffffff' });
  operatorsEl.replaceChildren(
    ...[...ops].sort((a, b) => a[0].localeCompare(b[0], 'cs')).map(([name, op]) =>
      chip(name, f.operators?.includes(name), () => store.setFilter({ operators: toggle(f.operators, name) }), op.color, op.text),
    ),
  );
  if (!ops.size) operatorsEl.append(Object.assign(document.createElement('span'), { className: 'filter-empty', textContent: 'Teď v kraji nejede žádný vlak.' }));
}

function renderState() {
  const f = store.filter;
  for (const b of typeEl.querySelectorAll('button')) b.classList.toggle('active', b.dataset.type === f.type);
  const count = (f.type !== 'all') + f.lines.length + (f.trainKinds?.length ?? 0) + (f.operators?.length ?? 0);
  badge.hidden = !count;
  badge.textContent = String(count);

  activeBar.hidden = !filterActive(f);
  if (filterActive(f)) {
    const parts = [];
    if (f.type !== 'all') parts.push(TYPE_NAMES[f.type]);
    if (f.lines.length) parts.push(`linky ${sortLines(f.lines).join(', ')}`);
    if (f.trainKinds?.length) parts.push(f.trainKinds.map((k) => TRAIN_KINDS[k]?.label.toLowerCase()).join(', '));
    if (f.operators?.length) parts.push(f.operators.join(', '));
    activeBar.replaceChildren();
    const text = document.createElement('span');
    text.textContent = `Filtr: ${parts.join(' · ')}`;
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Zrušit';
    clear.addEventListener('click', () => store.setFilter(RESET));
    activeBar.append(text, clear);
  }
  if (!sheet.hidden) {
    renderLines();
    renderTrains();
  }
}

export function openFilter() {
  renderLines();
  renderTrains();
  renderState();
  sheet.hidden = false;
}

export function initFilter() {
  document.getElementById('filter-open').addEventListener('click', openFilter);
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) sheet.hidden = true;
  });
  typeEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) store.setFilter({ type: b.dataset.type });
  });
  document.getElementById('filter-reset').addEventListener('click', () => store.setFilter(RESET));
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
