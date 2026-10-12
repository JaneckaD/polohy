// Filtr vozidel: druh dopravy (kulatá tlačítka s krátkým vysvětlením), druh vlaku a kraj (sbalitelné
// seznamy), dopravci schovaní v „Dalších možnostech“. Ukládá se do localStorage (store.setFilter).
import { store } from './store.js';
import { TRAIN_KINDS } from './trains.js';
import { KIND_ICONS } from './icons.js';
import { KINDS, KIND_HINTS, REGIONS, EMPTY_FILTER, effectiveKinds, filterActive, filterCount, describeFilter, describe, carrierColor } from './filtering.js';

const sheet = document.getElementById('filter-sheet');
const badge = document.getElementById('filter-badge');
const activeBar = document.getElementById('active-filter');
const kindsEl = document.getElementById('filter-kinds');
const trainFold = document.getElementById('filter-trains');
const trainKindsEl = document.getElementById('filter-train-kinds');
const regionsEl = document.getElementById('filter-regions');
const hintsEl = document.getElementById('filter-kind-hints');
const carriersEl = document.getElementById('filter-carriers');

const toggle = (list = [], x) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
const flip = (key, value) => store.setFilter({ [key]: toggle(store.filter[key], value) });

function renderKinds() {
  const f = store.filter;
  hintsEl.replaceChildren(
    ...KIND_HINTS.map(([title, text]) => {
      const row = document.createElement('div');
      const b = document.createElement('b');
      b.textContent = `${title}: `;
      row.append(b, text);
      return row;
    }),
  );
  kindsEl.replaceChildren(
    ...Object.entries(KINDS).map(([key, k]) => {
      const on = f.kinds.includes(key);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `kind-btn${on ? ' on' : ''}`;
      b.setAttribute('aria-pressed', String(on));
      b.style.setProperty('--kind-color', k.color);
      b.style.setProperty('--kind-text', k.text);
      // Žlutá na bílé je špatně vidět: nevybraný trolejbus kreslíme tmavší žlutou.
      if (key === 'trolleybus') b.style.setProperty('--kind-ink', '#b38900');
      const icon = document.createElement('span');
      icon.className = 'kind-icon';
      icon.innerHTML = KIND_ICONS[key];
      const label = document.createElement('span');
      label.className = 'kind-label';
      label.textContent = k.label;
      b.append(icon, label);
      b.addEventListener('click', () => flip('kinds', key));
      return b;
    }),
  );
}

/** Seznam se zaškrtávátky: items = [[hodnota, popisek, barva tečky]]. */
function checks(el, key, items) {
  const f = store.filter;
  el.replaceChildren(
    ...items.map(([value, label, color]) => {
      const row = document.createElement('label');
      row.className = 'check-row';
      const dot = document.createElement('span');
      dot.className = 'check-dot';
      if (color) dot.style.setProperty('--dot', color);
      else dot.hidden = true;
      const text = document.createElement('span');
      text.textContent = label;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = f[key].includes(value);
      input.addEventListener('change', () => flip(key, value));
      row.append(dot, text, input);
      return row;
    }),
  );
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

function chips(el, key, items) {
  const f = store.filter;
  el.replaceChildren(...items.map(([value, label, color, text]) => chip(label, f[key].includes(value), () => flip(key, value), color, text)));
}

const foldValue = (n) => (n ? `${n} ${n === 1 ? 'vybraný' : n < 5 ? 'vybrané' : 'vybraných'}` : 'Vše');

function renderAll() {
  const f = store.filter;
  renderKinds();
  const kinds = effectiveKinds(f);
  trainFold.hidden = kinds.length > 0 && !kinds.includes('train') && !f.trainKinds.length;
  checks(trainKindsEl, 'trainKinds', Object.entries(TRAIN_KINDS).map(([k, x]) => [k, x.label, x.color]));
  checks(regionsEl, 'regions', Object.entries(REGIONS).map(([k, x]) => [k, x.name]));
  // Dopravci podle vozů, které teď jezdí v oblasti (a už vybraní), seřazení podle počtu vozů.
  const carriers = new Map();
  for (const v of store.allVehicles()) {
    const name = describe(v).carrier;
    if (!name) continue;
    const c = carriers.get(name) ?? { name, n: 0, ...carrierColor(v) };
    c.n++;
    carriers.set(name, c);
  }
  for (const name of f.carriers) if (!carriers.has(name)) carriers.set(name, { name, n: 0, color: '#636366', text: '#ffffff' });
  chips(carriersEl, 'carriers', [...carriers.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'cs')).map((c) => [c.name, c.name, c.color, c.text]));
  for (const fold of sheet.querySelectorAll('.filter-fold')) {
    const n = fold.dataset.fold === 'trains' ? f.trainKinds.length : fold.dataset.fold === 'regions' ? f.regions.length : f.carriers.length;
    fold.querySelector('.fold-value').textContent = foldValue(n);
  }
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
    text.textContent = `Filtr: ${describeFilter(f)}`;
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Zrušit';
    clear.addEventListener('click', () => store.setFilter(EMPTY_FILTER));
    activeBar.append(text, clear);
  }
  if (!sheet.hidden) renderAll();
}

// Které skupiny jsou rozbalené, si pamatujeme (ve výchozím stavu sbalené).
function initFolds() {
  let open = {};
  try {
    open = JSON.parse(localStorage.getItem('mhd.filter.folds')) ?? {};
  } catch {
    /* nevadí */
  }
  for (const fold of sheet.querySelectorAll('.filter-fold')) {
    fold.open = !!open[fold.dataset.fold];
    fold.addEventListener('toggle', () => {
      open[fold.dataset.fold] = fold.open;
      try {
        localStorage.setItem('mhd.filter.folds', JSON.stringify(open));
      } catch {
        /* nevadí */
      }
    });
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
  initFolds();
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
