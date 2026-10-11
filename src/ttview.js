// Záložka Jízdní řády: seznam linek → linka (směr, zastávky) → odjezdy ze zastávky.
import { TYPE_COLORS, TYPE_LABELS } from './colors.js';
import { store, sortLines } from './store.js';
import { nameSimilarity } from './names.js';

const body = document.getElementById('tt-body');
const title = document.getElementById('tt-title');
const backBtn = document.getElementById('tt-back');

let indexPromise = null;
const lineCache = new Map();
const stack = []; // historie obrazovek: funkce, které obrazovku vykreslí
let onShowOnMap = () => {};

export function loadIndex() {
  indexPromise ??= fetch('./tt/index.json')
    .then((r) => (r.ok ? r.json() : { lines: [] }))
    .catch(() => ({ lines: [] }));
  return indexPromise;
}

function loadLine(ref) {
  if (!lineCache.has(ref)) {
    lineCache.set(
      ref,
      fetch(`./tt/${encodeURIComponent(ref)}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  }
  return lineCache.get(ref);
}

// --- pomocné ---------------------------------------------------------------------
function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

const pragueDate = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(d);
const nowMinutes = () => {
  const [hh, mm] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date())
    .split(':')
    .map(Number);
  return hh * 60 + mm;
};
const addDays = (date, n) => new Date(new Date(`${date}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const dayIndex = (start, date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
const fmt = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const DAY_NAMES = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];

function lineBadge(ref, type, size = '') {
  const b = h('span', `line-badge ${size}`, ref);
  b.style.background = (TYPE_COLORS[type] ?? TYPE_COLORS.bus).main;
  return b;
}

function show(screen, push = true) {
  if (push) stack.push(screen);
  backBtn.hidden = stack.length <= 1;
  body.scrollTop = 0;
  screen();
}

backBtn.addEventListener('click', () => {
  if (stack.length > 1) {
    stack.pop();
    show(stack.at(-1), false);
  }
});

// --- obrazovky ---------------------------------------------------------------------
async function renderIndex() {
  title.textContent = 'Linky';
  body.replaceChildren(h('div', 'muted pad', 'Načítám…'));
  const index = await loadIndex();
  if (!index.lines.length) {
    body.replaceChildren(h('div', 'empty', 'Jízdní řády se nepodařilo načíst. Zkus to prosím později.'));
    return;
  }
  const live = new Map();
  for (const v of store.vehicles) live.set(v.line, (live.get(v.line) ?? 0) + 1);

  const frag = document.createDocumentFragment();
  for (const type of ['trolleybus', 'bus']) {
    const lines = index.lines.filter((l) => l.type === type);
    if (!lines.length) continue;
    frag.append(h('h2', 'section-title', type === 'trolleybus' ? 'Trolejbusy' : 'Autobusy'));
    const list = h('div', 'line-list');
    for (const ref of sortLines(lines.map((l) => l.ref))) {
      const l = lines.find((x) => x.ref === ref);
      const item = h('button', 'line-item');
      item.type = 'button';
      item.append(lineBadge(l.ref, l.type));
      const text = h('div', 'line-item-text');
      const a = l.directions[0];
      text.append(h('div', 'line-item-route', a ? `${a.from} – ${a.headsign}` : ''));
      const n = live.get(l.ref) ?? 0;
      text.append(h('div', 'line-item-meta', n ? `${n} ${n === 1 ? 'vůz' : n < 5 ? 'vozy' : 'vozů'} na trase` : 'teď nejede'));
      item.append(text, h('span', 'chevron', '›'));
      item.addEventListener('click', () => show(() => renderLine(l.ref)));
      list.append(item);
    }
    frag.append(list);
  }
  body.replaceChildren(frag);
}

async function renderLine(ref, dirId) {
  title.textContent = `Linka ${ref}`;
  body.replaceChildren(h('div', 'muted pad', 'Načítám…'));
  const line = await loadLine(ref);
  if (!line) {
    body.replaceChildren(h('div', 'empty', 'Jízdní řád této linky není k dispozici.'));
    return;
  }
  let dir = line.directions.find((d) => d.id === dirId) ?? line.directions[0];
  const color = (TYPE_COLORS[line.type] ?? TYPE_COLORS.bus).main;

  const draw = () => {
    const frag = document.createDocumentFragment();
    const head = h('div', 'line-head');
    head.append(lineBadge(line.ref, line.type, 'big'));
    const ht = h('div');
    ht.append(h('div', 'line-head-type', TYPE_LABELS[line.type] ?? ''), h('div', 'line-head-route', `${dir.stops[0]} → ${dir.headsign}`));
    head.append(ht);
    frag.append(head);

    if (line.directions.length > 1) {
      const seg = h('div', 'segmented wide');
      for (const d of line.directions) {
        const b = h('button', d === dir ? 'active' : '', `→ ${d.headsign}`);
        b.type = 'button';
        b.addEventListener('click', () => {
          dir = d;
          draw();
        });
        seg.append(b);
      }
      frag.append(seg);
    }

    const mapBtn = h('button', 'btn block', 'Ukázat linku na mapě');
    mapBtn.type = 'button';
    mapBtn.addEventListener('click', () => onShowOnMap(line.ref));
    frag.append(mapBtn);

    const list = h('ol', 'stop-list');
    list.style.setProperty('--trip-color', color);
    dir.stops.forEach((name, i) => {
      const li = h('li');
      const btn = h('button', 'stop-item');
      btn.type = 'button';
      btn.append(h('span', 'stop-name', name));
      const next = nextDepartures(line, dir, i, 2);
      btn.append(h('span', 'stop-next', i === dir.stops.length - 1 ? 'konečná' : next.length ? next.map(fmt).join(', ') : '—'));
      btn.addEventListener('click', () => show(() => renderStop(line, dir.id, i)));
      li.append(btn);
      list.append(li);
    });
    frag.append(list);
    body.replaceChildren(frag);
  };
  draw();
}

function departures(line, dir, stopIdx, date) {
  const di = dayIndex(line.startDate, date);
  if (di < 0 || di >= line.days) return null;
  const result = [];
  for (const trip of dir.trips) {
    const t = trip.t[stopIdx];
    if (t == null || dir.masks[trip.d][di] !== '1') continue;
    // Na konečné spoje jen přijíždí.
    const later = trip.t.slice(stopIdx + 1).some((x) => x != null);
    if (!later) continue;
    result.push(t);
  }
  return result.sort((a, b) => a - b);
}

function nextDepartures(line, dir, stopIdx, count) {
  const today = departures(line, dir, stopIdx, pragueDate()) ?? [];
  const now = nowMinutes();
  return today.filter((t) => t >= now).slice(0, count);
}

function renderStop(line, dirId, stopIdx) {
  const dir = line.directions.find((d) => d.id === dirId);
  const name = dir.stops[stopIdx];
  title.textContent = name;
  let date = pragueDate();

  const draw = () => {
    const frag = document.createDocumentFragment();
    const top = h('div', 'stop-top');
    const head = h('div', 'line-head');
    head.append(lineBadge(line.ref, line.type, 'big'));
    const ht = h('div');
    ht.append(h('div', 'line-head-type', `Linka ${line.ref}`), h('div', 'line-head-route', `směr ${dir.headsign}`));
    head.append(ht);
    top.append(head);
    frag.append(top);

    // Výběr dne: dnes a dalších 6 dní.
    const days = h('div', 'day-chips');
    for (let i = 0; i < 7; i++) {
      const d = addDays(pragueDate(), i);
      const wd = DAY_NAMES[new Date(`${d}T12:00:00Z`).getUTCDay()];
      const label = i === 0 ? 'Dnes' : i === 1 ? 'Zítra' : `${wd} ${Number(d.slice(8))}. ${Number(d.slice(5, 7))}.`;
      const b = h('button', `day-chip${d === date ? ' active' : ''}`, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        date = d;
        draw();
      });
      days.append(b);
    }
    top.append(days);

    const deps = departures(line, dir, stopIdx, date);
    if (!deps) {
      frag.append(h('div', 'empty', 'Pro tento den jízdní řád zatím nemám.'));
    } else if (!deps.length) {
      frag.append(h('div', 'empty', 'Tento den odsud linka nejede.'));
    } else {
      const isToday = date === pragueDate();
      const now = nowMinutes();
      const next = isToday ? deps.find((t) => t >= now) : null;
      const table = h('div', 'departures');
      const byHour = new Map();
      for (const t of deps) {
        const hr = Math.floor(t / 60) % 24;
        if (!byHour.has(hr)) byHour.set(hr, []);
        byHour.get(hr).push(t);
      }
      let nextEl = null;
      for (const [hr, list] of byHour) {
        const row = h('div', 'dep-row');
        row.append(h('div', 'dep-hour', String(hr)));
        const mins = h('div', 'dep-mins');
        for (const t of list) {
          const m = h('span', `dep-min${isToday && t < now ? ' past' : ''}${t === next ? ' next' : ''}`, String(t % 60).padStart(2, '0'));
          if (t === next) nextEl = m;
          mins.append(m);
        }
        row.append(mins);
        table.append(row);
      }
      if (next != null) top.append(h('div', 'next-dep', `Nejbližší odjezd ${fmt(next)} (za ${next - now} min)`));
      frag.append(table);
      // Posuneme na nejbližší odjezd, hlavička s výběrem dne zůstává nahoře.
      if (nextEl) requestAnimationFrame(() => (body.scrollTop = Math.max(0, nextEl.closest('.dep-row').offsetTop - top.offsetHeight - 60)));
    }
    body.replaceChildren(frag);
  };
  draw();
}

// --- veřejné rozhraní -------------------------------------------------------------
export function initTimetables({ showOnMap }) {
  onShowOnMap = showOnMap;
  stack.length = 0;
  show(renderIndex);
}

/** Otevře jízdní řád linky (např. z detailu vozu). */
export function openLine(ref, headsign) {
  stack.length = 0;
  stack.push(renderIndex);
  loadLine(ref).then((line) => {
    // Směr podle cílové zastávky vozu (názvy se mohou mírně lišit).
    const dir = headsign && line?.directions.length
      ? line.directions.reduce((best, d) => (nameSimilarity(d.headsign, headsign) > nameSimilarity(best.headsign, headsign) ? d : best))
      : line?.directions[0];
    show(() => renderLine(ref, dir?.id));
  });
}

/** Překreslí seznam linek, když se změní počty vozů (jen pokud je zrovna vidět). */
export function refreshIndex() {
  if (stack.length === 1) renderIndex();
}
