// Karta s detaily vozu (při najetí myší) a spodní panel s jízdním řádem spoje (po klepnutí).
import { FEATURES } from './dszo.js';
import { applyVehicleColors, TYPE_LABELS, delayLevel } from './colors.js';
import { currentTripIndex } from './route-match.js';
import { TRAIN_KINDS } from './trains.js';
import { networkLabel, isCoach } from './cities.js';

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
  power: svg('<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0V8z"/><path d="M12 17v4"/>'),
  bike: svg('<circle cx="5.5" cy="16" r="3.5"/><circle cx="18.5" cy="16" r="3.5"/><path d="M5.5 16 9 9h7l2.5 7M9 9l3.5 7H5.5M12.5 16 16 9M8 6h3"/>'),
  food: svg('<path d="M4 9h12v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5c-.8 1 .8 2 0 3M12 3.5c-.8 1 .8 2 0 3"/><path d="M3 21h14"/>'),
  quiet: svg('<path d="M4 10v4h3l5 4V6L7 10H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
  kids: svg('<circle cx="12" cy="5" r="2.2"/><path d="M8 10.5 12 9l4 1.5M12 9v6M9 21l3-6 3 6"/>'),
  first: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M10 9.5 13 8v9"/>'),
  ticket: svg('<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4V8z"/><path d="M14 6v12" stroke-dasharray="2 2"/>'),
  ladies: svg('<circle cx="12" cy="8" r="4.5"/><path d="M12 12.5V21M9 18h6"/>'),
  bed: svg('<path d="M3 6v14M3 16h18v4M21 16v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="12.5" r="1.8"/>'),
  wc: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m6 9 1.3 6L9 10.5 10.7 15 12 9M18 10a2.4 2.4 0 1 0 0 4"/>'),
  trolleybus: svg('<rect x="4" y="7" width="16" height="11" rx="2"/><path d="M4 12h16M9 7 7 2M15 7l2-5"/><circle cx="8" cy="18.5" r="1.3"/><circle cx="16" cy="18.5" r="1.3"/>'),
  bus: svg('<rect x="4" y="4" width="16" height="14" rx="2"/><path d="M4 11h16M8 4v7M16 4v7"/><circle cx="8" cy="18.5" r="1.3"/><circle cx="16" cy="18.5" r="1.3"/>'),
  train: svg('<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14M9 21l1.5-4M15 21l-1.5-4"/><circle cx="9" cy="13.5" r="1" fill="currentColor"/><circle cx="15" cy="13.5" r="1" fill="currentColor"/>'),
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

/** Řádek s výbavou vozu: dlaždice [ikona, popisek, má/nemá] ve stejném vzhledu jako u DSZO. */
function featureRow(items) {
  const feats = h('div', 'card-features');
  for (const [icon, label, has] of items) {
    const f = h('span', `feature${has ? ' on' : ''}`);
    f.title = has ? label : `${label}: ne`;
    f.innerHTML = ICONS[icon];
    f.append(h('span', 'feature-label', label));
    feats.append(f);
  }
  return feats;
}

/**
 * Výbava vlaku podle centrálních poznámek jízdního řádu SŽ (kódy viz scripts/rail-equip.mjs).
 * Wi-Fi, zásuvky, bezbariérovost a kola ukážeme vždy (i když chybí), ostatní jen když vlak má.
 */
export function trainFeatures(codes) {
  if (!codes) return [];
  const has = (...c) => c.some((x) => codes.includes(x));
  const items = [
    ['wifi', 'Wi-Fi', has(40)],
    ['power', 'Zásuvky 230 V', has(30)],
    has(34) && !has(17) ? ['lowlevel', 'Vozík po objednání', true] : ['lowlevel', 'Bezbariérový', has(17)],
    ['bike', has(29) ? 'Kola s místenkou' : 'Jízdní kola', has(22, 28, 29) && !has(36)],
  ];
  if (has(18)) items.push(['food', 'Restaurační vůz', true]);
  else if (has(25)) items.push(['food', 'Bistro', true]);
  else if (has(24)) items.push(['food', 'Občerstvení', true]);
  if (has(10)) items.push(['first', '1. třída', true]);
  if (has(39)) items.push(['quiet', 'Tichý oddíl', true]);
  if (has(33)) items.push(['kids', 'Oddíl pro děti', true]);
  if (has(38)) items.push(['ladies', 'Dámský oddíl', true]);
  if (has(20)) items.push(['ticket', 'Povinná místenka', true]);
  else if (has(19)) items.push(['ticket', 'Místenky', true]);
  if (has(13)) items.push(['bed', 'Lůžkový vůz', true]);
  else if (has(14)) items.push(['bed', 'Lehátkový vůz', true]);
  if (has(46)) items.push(['wc', 'WC', false]);
  return items;
}

/** Detail vlaku: druh, dopravce, odkud a kam, zpoždění, kde právě je. */
function renderTrainDetails(v, trip) {
  const card = applyVehicleColors(h('div', 'card'), v);
  const kind = TRAIN_KINDS[v.kind];

  const head = h('div', 'card-head');
  const badge = h('div', 'card-line train');
  const k = h('span', 'train-kind', v.code);
  badge.append(k, h('span', null, v.number));
  const title = h('div', 'card-title');
  title.append(h('div', 'card-headsign', v.headsign ? `→ ${v.headsign}` : `Vlak ${v.line}`));
  const type = h('div', 'card-type');
  type.innerHTML = ICONS.train;
  type.append(` ${kind?.long ?? 'Vlak'}${v.name ? ` ${v.name}` : ''} · ${v.operator.short}`);
  title.append(type);
  head.append(badge, title);
  card.append(head);

  const pills = h('div', 'card-pills');
  pills.append(h('span', `card-delay delay-${delayLevel(v.delay)}`, delayLabel(v)));
  card.append(pills);

  const feats = trainFeatures(trip?.equip);
  if (feats.length) card.append(featureRow(feats));
  return card;
}

/** Detail vozu (u vlaku s jízdním řádem trip, pokud ho známe). */
export function renderDetails(v, trip = null) {
  if (v.type === 'train') return renderTrainDetails(v, trip);
  const card = applyVehicleColors(h('div', 'card'), v);

  const head = h('div', 'card-head');
  const badge = h('div', 'card-line', `${v.line}${v.mark ?? ''}`);
  const title = h('div', 'card-title');
  title.append(h('div', 'card-headsign', v.headsign ? `→ ${v.headsign}` : `Linka ${v.line}`));
  const type = h('div', 'card-type');
  type.innerHTML = ICONS[v.type] ?? '';
  const label = isCoach(v.city) ? 'Dálkový autobus' : TYPE_LABELS[v.type] ?? 'Vůz';
  type.append(v.city ? ` ${label} · ${networkLabel(v.city)}${v.plate ? ` · ${v.plate}` : ''}` : ` ${label} · vůz ${v.id}`);
  title.append(type);
  head.append(badge, title);
  card.append(head);

  const pills = h('div', 'card-pills');
  if (v.estimated) {
    // RegioJet polohy ani zpoždění nezveřejňuje.
    pills.append(h('span', 'card-ago', 'poloha odhadem podle jízdního řádu'));
  } else {
    pills.append(h('span', `card-delay delay-${delayLevel(v.delay)}`, delayLabel(v)));
    const ago = agoLabel(v.updated);
    if (ago) pills.append(h('span', 'card-ago', `poloha ${ago}`));
  }
  card.append(pills);
  // Písmeno spoje z jízdního řádu DSZO: co znamená.
  if (v.mark && v.markNote) card.append(h('div', 'card-mark', `${v.line}${v.mark}: ${v.markNote}`));
  // V plovoucí kartě (bez seznamu zastávek) aspoň aktuální zastávka.
  if (v.stop) card.append(h('div', 'card-now', `U zastávky ${v.stop}`));

  // U MHD jiných měst a regionálních autobusů víme jen, jestli je vůz nízkopodlažní (v Kroměříži klimatizovaný).
  if (v.city) {
    const items = [];
    if (v.lowFloor != null) items.push(['lowlevel', 'Bezbariérový', v.lowFloor]);
    if (v.aircon != null) items.push(['ac', 'Klimatizace', v.aircon]);
    if (items.length) card.append(featureRow(items));
    return card;
  }
  card.append(featureRow(Object.entries(FEATURES).map(([key, label]) => [key, label, !!v.features?.includes(key)])));
  return card;
}

const nowMinutes = () => {
  const [hh, mm] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date())
    .split(':')
    .map(Number);
  return hh * 60 + mm;
};
const hhmm = (m) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
const toMinutes = (t) => {
  const [hh, mm] = t.split(':').map(Number);
  return hh * 60 + mm;
};

/**
 * Trasa spoje jako časová osa: projeté zastávky sbalené, poloha vozu, příští zastávka
 * zvýrazněná a u každé další zastávky odpočet (s aktuálním zpožděním).
 */
/** Vlak: výchozí stanice, kde právě je, příští zastávka a cíl (celý jízdní řád vlaku nemáme). */
function renderTrainTrip(v) {
  const box = h('div', 'trip');
  const list = h('ol', 'timeline');
  const delayMin = v.delay > 0 ? Math.round(v.delay / 60) : 0;
  const row = (cls, name, sub, time, puck = false) => {
    const li = h('li', `tl-stop ${cls}`);
    li.append(puck ? h('span', 'tl-puck', v.code) : h('span', 'tl-dot'));
    const text = h('div', 'tl-text');
    text.append(h('span', 'tl-name', name));
    if (sub) text.append(h('span', 'tl-sub', sub));
    li.append(text);
    const right = h('div', 'tl-right');
    if (time) right.append(h('span', 'tl-time', time));
    li.append(right);
    list.append(li);
  };
  const same = (a, b) => a && b && a.trim() === b.trim();
  if (v.from && !same(v.from, v.stop)) row('passed', v.from, 'výchozí stanice', null);
  if (v.stop) {
    const at = v.stopReal && v.stopPlanned && v.stopReal !== v.stopPlanned ? `${v.stopPlanned} → ${v.stopReal}` : v.stopReal ?? v.stopPlanned;
    row('current', v.stop, 'naposledy projel', at, true);
  }
  if (v.next && !same(v.next, v.stop)) {
    const left = v.nextArr ? toMinutes(v.nextArr) + delayMin - nowMinutes() : null;
    row(`next${same(v.next, v.headsign) ? ' terminus' : ''}`, v.next, left != null && left >= 0 && left < 120 ? `příští zastávka · ${left === 0 ? 'teď' : `za ${left} min`}` : 'příští zastávka', v.nextArr);
  }
  if (v.headsign && !same(v.headsign, v.next) && !same(v.headsign, v.stop)) row('upcoming terminus', v.headsign, 'cílová stanice', null);
  box.append(list);
  return box;
}

export function renderTrip(trip, v, { scroll = false, showPassed = false, onTogglePassed, atStop = true, current: knownCurrent } = {}) {
  const train = v.type === 'train';
  // Vlak bez jízdního řádu (např. data ještě nejsou): jen odkud, kudy a kam.
  if (train && trip && !trip.length) return renderTrainTrip(v);
  const box = h('div', 'trip');
  if (!trip) {
    box.append(h('div', 'trip-empty', 'Načítám zastávky spoje…'));
    return box;
  }
  if (!trip.length) {
    box.append(h('div', 'trip-empty', 'Zastávky spoje nejsou k dispozici.'));
    return box;
  }
  const current = knownCurrent ?? currentTripIndex(trip, v.stop);
  const puckText = train ? v.code : v.line;
  const delayMin = v.delay > 0 ? Math.round(v.delay / 60) : 0;
  const now = nowMinutes();
  const list = h('ol', 'timeline');

  if (current > 0) {
    const li = h('li', `tl-toggle${showPassed ? ' open' : ''}`);
    const b = h('button', null, showPassed ? 'Skrýt projeté zastávky' : `${current} ${current === 1 ? 'projetá zastávka' : current < 5 ? 'projeté zastávky' : 'projetých zastávek'}`);
    b.type = 'button';
    b.addEventListener('click', () => onTogglePassed?.());
    li.append(b);
    list.append(li);
  }

  // Vůz je mezi zastávkami (od poslední ohlášené zastávky už odjel): ukážeme ho mezi nimi.
  const between = !atStop && current >= 0 && current < trip.length - 1;
  trip.forEach((s, i) => {
    if (i < current && !showPassed) return;
    const cls = i < current || (between && i === current) ? 'passed' : i === current ? 'current' : i === current + 1 ? 'next' : 'upcoming';
    const li = h('li', `tl-stop ${cls}${i === trip.length - 1 ? ' terminus' : ''}${between && i === current ? ' last-passed' : ''}`);
    if (i === current && !between) li.append(h('span', 'tl-puck', puckText));
    else li.append(h('span', 'tl-dot'));
    const text = h('div', 'tl-text');
    text.append(h('span', 'tl-name', s.name));
    if (i === current && !between) text.append(h('span', 'tl-sub', train ? 'vlak stojí ve stanici' : 'vůz je v zastávce'));
    else if (i === current + 1) text.append(h('span', 'tl-sub', 'příští zastávka'));
    else if (i === trip.length - 1) text.append(h('span', 'tl-sub', train ? 'cílová stanice' : 'konečná'));
    li.append(text);
    const right = h('div', 'tl-right');
    // Vlak: do stanice přijíždí (arr), odjíždí později (time).
    const shown = train && i > current && s.arr ? s.arr : s.time;
    if (i > current && delayMin > 0) {
      // Se zpožděním: plánovaný čas přeškrtnutý, vedle očekávaný.
      const row = h('span', 'tl-time');
      row.append(h('s', 'tl-planned', shown), ' ', h('b', 'tl-real', hhmm(toMinutes(shown) + delayMin)));
      right.append(row);
    } else right.append(h('span', 'tl-time', shown));
    if (i > current) {
      const left = toMinutes(shown) + delayMin - now;
      if (left >= 0 && left < 120) right.append(h('span', 'tl-eta', left === 0 ? 'teď' : `za ${left} min`));
    }
    li.append(right);
    list.append(li);
    if (between && i === current) {
      // Mezi zastávkami jen značka vozu, bez textu.
      const mid = h('li', 'tl-between current');
      mid.setAttribute('aria-label', `mezi ${s.name} a ${trip[i + 1].name}`);
      mid.append(h('span', 'tl-puck', puckText));
      list.append(mid);
    }
  });
  box.append(list);
  // Při otevření posuneme seznam na polohu vozu (jen seznam, ne celý panel).
  if (scroll)
    requestAnimationFrame(() => {
      const li = list.querySelector('.current') ?? list.firstElementChild;
      const sc = li?.closest('.sheet-trip');
      if (!sc) return;
      sc.scrollTop += li.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8;
    });
  return box;
}
