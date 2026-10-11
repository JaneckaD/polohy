// Karta s detaily vozu (při najetí myší) a spodní panel s jízdním řádem spoje (po klepnutí).
import { FEATURES } from './dszo.js';
import { applyTypeColors, applyVehicleColors, TYPE_LABELS, delayLevel } from './colors.js';
import { currentTripIndex } from './route-match.js';
import { TRAIN_KINDS } from './trains.js';

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

/** Detail vlaku: druh, dopravce, odkud a kam, zpoždění, kde právě je. */
function renderTrainDetails(v, trip) {
  const card = applyVehicleColors(h('div', 'card'), v);
  const kind = TRAIN_KINDS[v.kind];

  const head = h('div', 'card-head');
  const badge = h('div', 'card-line train');
  const k = h('span', 'train-kind', v.code);
  k.style.background = kind?.color ?? '#6c6c70';
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

  // Přehled: odkud kam, linka, kde naposledy projel a kdy bude v příští zastávce.
  const facts = h('dl', 'card-facts');
  const fact = (label, value) => {
    if (!value) return;
    facts.append(h('dt', null, label), h('dd', null, value));
  };
  const delayMin = v.delay > 0 ? Math.round(v.delay / 60) : 0;
  const expected = (t) => (t && delayMin ? `${t} → ${hhmm(toMinutes(t) + delayMin)}` : t);
  fact('Trasa', v.from && v.headsign ? `${v.from} → ${v.headsign}` : v.headsign);
  fact('Linka', trip?.line);
  if (v.stop) fact('Naposledy projel', `${v.stop}${v.stopReal ? ` v ${v.stopReal}` : ''}${v.stopPlanned && v.stopReal && v.stopPlanned !== v.stopReal ? ` (podle plánu ${v.stopPlanned})` : ''}`);
  if (v.next) fact('Příští zastávka', `${v.next}${v.nextArr ? `, příjezd ${expected(v.nextArr)}` : ''}`);
  if (trip?.length) fact('Zastávek celkem', String(trip.length));
  fact('Dopravce', v.operator.name);
  card.append(facts);
  return card;
}

/** Detail vozu (u vlaku s jízdním řádem trip, pokud ho známe). */
export function renderDetails(v, trip = null) {
  if (v.type === 'train') return renderTrainDetails(v, trip);
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

  const pills = h('div', 'card-pills');
  pills.append(h('span', `card-delay delay-${delayLevel(v.delay)}`, delayLabel(v)));
  const ago = agoLabel(v.updated);
  if (ago) pills.append(h('span', 'card-ago', `poloha ${ago}`));
  card.append(pills);
  // V plovoucí kartě (bez seznamu zastávek) aspoň aktuální zastávka.
  if (v.stop) card.append(h('div', 'card-now', `U zastávky ${v.stop}`));

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
