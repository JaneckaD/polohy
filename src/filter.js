// Filtr vozidel: typ (trolejbus/autobus), linky a jen zpožděné. Ukládá se do localStorage.
import { applyTypeColors } from './colors.js';
import { store, filterActive, sortLines } from './store.js';
import { vehicleType } from './dszo.js';

const sheet = document.getElementById('filter-sheet');
const badge = document.getElementById('filter-badge');
const activeBar = document.getElementById('active-filter');
const linesEl = document.getElementById('filter-lines');
const typeEl = document.getElementById('filter-type');
const delayedEl = document.getElementById('filter-delayed');

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

function renderState() {
  const f = store.filter;
  for (const b of typeEl.querySelectorAll('button')) b.classList.toggle('active', b.dataset.type === f.type);
  delayedEl.checked = f.delayed;
  const count = (f.type !== 'all') + f.lines.length + f.delayed;
  badge.hidden = !count;
  badge.textContent = String(count);

  activeBar.hidden = !filterActive(f);
  if (filterActive(f)) {
    const parts = [];
    if (f.type !== 'all') parts.push(f.type === 'trolleybus' ? 'trolejbusy' : 'autobusy');
    if (f.lines.length) parts.push(`linky ${sortLines(f.lines).join(', ')}`);
    if (f.delayed) parts.push('jen zpožděné');
    activeBar.replaceChildren();
    const text = document.createElement('span');
    text.textContent = `Filtr: ${parts.join(' · ')}`;
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Zrušit';
    clear.addEventListener('click', () => store.setFilter({ type: 'all', lines: [], delayed: false }));
    activeBar.append(text, clear);
  }
  if (!sheet.hidden) renderLines();
}

export function openFilter() {
  renderLines();
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
  delayedEl.addEventListener('change', () => store.setFilter({ delayed: delayedEl.checked }));
  document.getElementById('filter-reset').addEventListener('click', () => store.setFilter({ type: 'all', lines: [], delayed: false }));
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
