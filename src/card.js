// Karta s detaily vozu (při najetí myší) a spodní panel s jízdním řádem spoje (po klepnutí).
import { FEATURES } from './dszo.js';
import { applyTypeColors, TYPE_LABELS, delayLevel } from './colors.js';
import { currentTripIndex } from './route-match.js';

const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
  wifi: svg('<path d="M2 8.5a15 15 0 0 1 20 0"/><path d="M5.5 12a10 10 0 0 1 13 0"/><path d="M9 15.5a5 5 0 0 1 6 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/>'),
  ac: svg('<path d="M12 2v20M4 6.5l16 11M20 6.5l-16 11"/><path d="M9.5 3.5 12 5l2.5-1.5M9.5 20.5 12 19l2.5 1.5"/>'),
  lowlevel: svg('<circle cx="10" cy="4" r="1.6"/><path d="M10 7v6h6l2.5 5"/><path d="M10 10h5"/><path d="M7.5 11.5a5.5 5.5 0 1 0 7.8 6.3"/>'),
  lcd: svg('<rect x="3" y="5" width="18" height="11" rx="1.5"/><path d="M8 20h8M12 16v4"/><path d="M7 9h6M7 12h9"/>'),
  blind: svg('<path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>'),
  camera: svg('<rect x="3" y="7" width="13" height="10" rx="1.5"/><path d="m16 11 5-3v8l-5-3"/>'),
  usb: svg('<path d="M12 3v13"/><path d="M9 6l3-3 3 3"/><path d="M12 16a3 3 0 1 0 0 .01"/><path d="M12 12 7 9V7M12 10l5-3V5"/>'),
  trolleybus: svg('<rect x="4" y="7" width="16" height="11" rx="2"/><path d="M4 12h16M9 7 7 2M15 7l2-5"/><circle cx="8" cy="18.5" r="1.3"/><circle cx="16" cy="18.5" r="1.3"/>'),
  bus: svg('<rect x="4" y="4" width="16" height="14" rx="2"/><path d="M4 11h16M8 4v7M16 4v7"/><circle cx="8" cy="18.5" r="1.3"/><circle cx="16" cy="18.5" r="1.3"/>'),
};

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function delayLabel(v) {
  if (v.delay == null) return 'zpoždění neznámé';
  if (v.delay < 0) return `náskok ${v.delayText.replace('-', '')}`;
  if (v.delay < 30) return 'včas';
  return `zpoždění ${v.delayText}`;
}

function agoLabel(updated) {
  if (!updated) return null;
  const t = new Date(updated.replace(' ', 'T'));
  const s = Math.round((Date.now() - t.getTime()) / 1000);
  if (!Number.isFinite(s)) return null;
  if (s < 60) return `před ${Math.max(0, s)} s`;
  return `před ${Math.round(s / 60)} min`;
}

/** Detail vozu. */
export function renderDetails(v) {
  const card = applyTypeColors(h('div', 'card'), v.type);

  const head = h('div', 'card-head');
  const badge = h('div', 'card-line', v.line);
  const title = h('div', 'card-title');
  title.append(h('div', 'card-headsign', v.headsign ? `→ ${v.headsign}` : `Linka ${v.line}`));
  const type = h('div', 'card-type');
  type.innerHTML = ICONS[v.type] ?? '';
  type.append(` ${TYPE_LABELS[v.type] ?? 'Vůz'} · vůz ${v.id}`);
  title.append(type);
  head.append(badge, title);
  card.append(head);

  card.append(h('div', `card-delay delay-${delayLevel(v.delay)}`, delayLabel(v)));

  const grid = h('dl', 'card-grid');
  const add = (label, value) => {
    if (!value) return;
    grid.append(h('dt', null, label), h('dd', null, value));
  };
  add('Zastávka', v.stop);
  add('Služba', v.duty);
  add('Poloha', agoLabel(v.updated));
  card.append(grid);

  const feats = h('div', 'card-features');
  for (const [key, label] of Object.entries(FEATURES)) {
    const has = v.features?.includes(key);
    const f = h('span', `feature${has ? ' on' : ''}`);
    f.title = has ? label : `${label}: ne`;
    f.innerHTML = ICONS[key];
    f.append(h('span', 'feature-label', label));
    feats.append(f);
  }
  card.append(feats);
  return card;
}

/** Seznam zastávek spoje s časy, projeté šedě. */
export function renderTrip(trip, v, { scroll = false } = {}) {
  const box = h('div', 'trip');
  if (!trip) {
    box.append(h('div', 'trip-empty', 'Načítám jízdní řád…'));
    return box;
  }
  if (!trip.length) {
    box.append(h('div', 'trip-empty', 'Jízdní řád spoje není k dispozici.'));
    return box;
  }
  const current = currentTripIndex(trip, v.stop);
  const list = h('ol', 'trip-list');
  trip.forEach((s, i) => {
    const li = h('li', i < current ? 'passed' : i === current ? 'current' : '');
    li.append(h('span', 'trip-time', s.time), h('span', 'trip-name', s.name));
    list.append(li);
  });
  box.append(list);
  // Při otevření posuneme seznam na aktuální zastávku.
  // Posouváme jen seznam, ne celý panel (scrollIntoView by posunul i jeho rodiče).
  if (scroll)
    requestAnimationFrame(() => {
      const li = list.children[Math.max(0, current)];
      const box = li?.closest('.sheet-trip');
      if (!box) return;
      box.scrollTop += li.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 2 + li.offsetHeight / 2;
    });
  return box;
}
