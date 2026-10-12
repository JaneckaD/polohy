// Záložka Spojení: odkud, kam, den a čas → nejbližší spojení s přestupy (i pěšími) → detail spojení.
import { applyTypeColors, applyVehicleColors } from './colors.js';
import { TRAIN_KINDS, trainKind, trainOperator } from './trains.js';
import { networkLabel } from './cities.js';
import { preparePlanner, searchJourneys, findStops, findTowns, nearbyStops, rideStops, distanceMeters } from './planner.js';

const body = document.getElementById('pl-body');
const title = document.getElementById('pl-title');
const backBtn = document.getElementById('pl-back');
const backLabel = document.getElementById('pl-back-label');
const page = body.closest('.page');

body.addEventListener('scroll', () => page.classList.toggle('scrolled', body.scrollTop > 8), { passive: true });

let plannerPromise = null;
let onShowOnMap = () => {};
let getPosition = () => null;

function loadPlanner() {
  plannerPromise ??= fetch('./tt/planner.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d?.trips?.length ? preparePlanner(d) : null))
    .catch(() => null);
  return plannerPromise;
}

// --- pomocné ---------------------------------------------------------------------
function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

const svg = (paths, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const ICON_WALK = svg('<circle cx="13" cy="4" r="2"/><path d="m9 21 3-7 3 3v4M7 12l3-4 4 1 3 3M11 8l-1 6"/>', 16);
const ICON_SWAP = svg('<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>', 20);
const ICON_LOC = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M20.9 3.1a.8.8 0 0 0-.86-.17L3.5 9.6a.8.8 0 0 0 .06 1.5l6.9 2.4 2.4 6.9a.8.8 0 0 0 1.5.06l6.66-16.5a.8.8 0 0 0-.17-.86z"/></svg>';
const ICON_WARN = svg('<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v4M12 17.5v.01"/>', 16);

const pragueDate = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' }).format(d);
const nowMinutes = () => {
  const [hh, mm] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date())
    .split(':')
    .map(Number);
  return hh * 60 + mm;
};
const addDays = (date, n) => new Date(new Date(`${date}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const fmt = (m) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n > 1 && n < 5 ? few : many}`;
const durationText = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`);

// Vlak ve vyhledávání: druh, číslo a dopravce (barvy jako značka vlaku na mapě).
const trainOf = (pat) => ({ type: 'train', code: pat.k, number: pat.n, kind: trainKind(pat.k), operator: trainOperator(pat.o) });

function lineBadge(pat, trip = null) {
  if (pat.y === 'v') {
    const t = trainOf(pat);
    const badge = applyVehicleColors(h('span', 'line-badge train-badge'), t);
    const k = h('span', 'train-kind', t.code);
    badge.append(k, h('span', null, t.number));
    return badge;
  }
  // Spoj DSZO s písmenem z jízdního řádu (8d, 38g…).
  return colorRide(h('span', 'line-badge', `${pat.r}${trip?.mark ?? ''}`), pat);
}

// MHD jiného města (Kroměříž, Valašské Meziříčí) má barvu města.
const colorRide = (el, pat) => (pat.y === 'v' ? applyVehicleColors(el, trainOf(pat)) : pat.c ? applyVehicleColors(el, { city: pat.c }) : applyTypeColors(el, pat.y === 't' ? 'trolleybus' : 'bus'));
const rideKind = (pat) =>
  pat.y === 'v' ? `${TRAIN_KINDS[trainKind(pat.k)]?.long ?? 'Vlak'} · ${trainOperator(pat.o).short}` : pat.c ? `Autobus · ${networkLabel(pat.c)}` : pat.y === 't' ? 'Trolejbus' : 'Autobus';

// --- stav formuláře (pamatuje se mezi návštěvami) -----------------------------------
const MY_LOCATION = { name: 'Moje poloha', here: true };
// Název do pole a výpisu: celý název zastávky (u Zlína s „Zlín,“), jinak název.
const labelOf = (v) => v?.label ?? v?.name ?? '';

// Našeptávač: co na zastávce jezdí (ikona a barva podle nejdůležitějšího), nebo celé město.
const ICON_TRAIN = svg('<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12M9 20l-1.5-4M15 20l1.5-4M9.5 13h.01M14.5 13h.01"/>', 16);
const ICON_MHD = svg('<path d="m9 5-2-3M15 5l2-3"/><rect x="5" y="5" width="14" height="13" rx="3"/><path d="M5 12h14M8 21v-3M16 21v-3"/>', 16);
const ICON_BUS = svg('<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M7 21v-3M17 21v-3M8 14.5h.01M16 14.5h.01"/>', 16);
const ICON_TOWN = svg('<path d="M3 21h18M5 21V9l6-4v16M11 21V11h8v10M8 11v.01M8 15v.01M15 15v.01M15 18v.01"/>', 16);
const ICON_RECENT = svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', 16);
const STOP_KINDS = [
  ['train', 'Vlak', ICON_TRAIN],
  ['mhd', 'MHD', ICON_MHD],
  ['bus', 'Regionální autobus', ICON_BUS],
];

/** Popis volby v našeptávači: { kind (třída barvy), icon, sub }. */
function optionLook(o, P) {
  if (o.here) return { kind: 'loc', icon: ICON_LOC, sub: null };
  if (o.town) {
    const n = P?.towns?.get(o.name)?.stops.length ?? 0;
    return { kind: 'town', icon: ICON_TOWN, sub: `${n >= 8 ? 'Celé město' : 'Celá obec'}${n ? ` · ${plural(n, 'zastávka', 'zastávky', 'zastávek')}` : ''}` };
  }
  const kinds = P?.stops.find((s) => s.name === o.name)?.kinds ?? new Set();
  const list = STOP_KINDS.filter(([k]) => kinds.has(k));
  const [kind, , icon] = list[0] ?? ['bus', '', ICON_BUS];
  return { kind, icon: o.recent ? ICON_RECENT : icon, sub: list.map(([, label]) => label).join(' · ') || null };
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem('mhd.plan')) ?? {};
  } catch {
    return {};
  }
}

const saved = loadState();
const state = {
  from: saved.from ?? null, // { name } nebo MY_LOCATION
  to: saved.to ?? null,
  date: null, // null = dnes
  time: null, // null = teď
  recent: saved.recent ?? [],
  results: null,
};

function persist() {
  try {
    // Zastávku doplněnou podle polohy neukládáme: příště se hledá znovu ta nejbližší.
    localStorage.setItem('mhd.plan', JSON.stringify({ from: state.from?.auto ? null : state.from, to: state.to, recent: state.recent.slice(0, 5) }));
  } catch {
    /* nevadí */
  }
}

// --- navigace mezi obrazovkami -----------------------------------------------------
const stack = [];
function show(screen, push = true) {
  if (push) stack.push({ screen, title: '' });
  const entry = stack.at(-1);
  backBtn.hidden = stack.length <= 1;
  backLabel.textContent = stack.at(-2)?.title || 'Zpět';
  page.classList.toggle('root', stack.length <= 1);
  page.classList.remove('scrolled');
  body.scrollTop = 0;
  entry.screen();
  entry.title = title.textContent;
}

backBtn.addEventListener('click', () => {
  if (stack.length > 1) {
    stack.pop();
    show(null, false);
  }
});

// --- vyhledávání -------------------------------------------------------------------
function renderSearch() {
  title.textContent = 'Spojení';
  const frag = document.createDocumentFragment();
  frag.append(h('h2', 'large-title', 'Spojení'));

  // Odkud / Kam
  const form = h('div', 'plan-form');
  const fields = h('div', 'group plan-fields');
  const fromInput = field(fields, 'from', 'Odkud', 'dot-from');
  const toInput = field(fields, 'to', 'Kam', 'dot-to');
  const swap = h('button', 'plan-swap');
  swap.type = 'button';
  swap.setAttribute('aria-label', 'Prohodit odkud a kam');
  swap.innerHTML = ICON_SWAP;
  swap.addEventListener('click', () => {
    // „Moje poloha“ může být jen odkud.
    [state.from, state.to] = [state.to, state.from?.here ? null : state.from];
    persist();
    fromInput.value = labelOf(state.from);
    toInput.value = labelOf(state.to);
  });
  fields.append(swap);
  form.append(fields);
  const suggest = h('div', 'group plan-suggest');
  suggest.hidden = true;
  form.append(suggest);

  // Datum a čas vedle sebe
  const when = h('div', 'plan-when');
  const today = pragueDate();
  const dateBox = h('label', 'when-field');
  dateBox.append(h('span', 'when-label', 'Datum'));
  const dateInput = h('input', 'when-input');
  dateInput.type = 'date';
  dateInput.min = today;
  dateInput.value = state.date && state.date >= today ? state.date : today;
  loadPlanner().then((P) => {
    if (P?.startDate) dateInput.max = addDays(P.startDate, P.days - 1);
  });
  dateInput.addEventListener('change', () => {
    const d = dateInput.value;
    state.date = !d || d === today ? null : d;
  });
  dateBox.append(dateInput);
  const timeBox = h('label', 'when-field');
  timeBox.append(h('span', 'when-label', 'Odjezd'));
  const timeInput = h('input', 'when-input');
  timeInput.type = 'time';
  timeInput.value = state.time != null ? fmt(state.time) : fmt(nowMinutes());
  timeInput.addEventListener('change', () => {
    const [hh, mm] = timeInput.value.split(':').map(Number);
    state.time = Number.isFinite(hh) ? hh * 60 + mm : null;
  });
  timeBox.append(timeInput);
  const nowBtn = h('button', 'btn small when-now', 'Teď');
  nowBtn.type = 'button';
  nowBtn.addEventListener('click', () => {
    state.time = null;
    state.date = null;
    dateInput.value = today;
    timeInput.value = fmt(nowMinutes());
  });
  when.append(dateBox, timeBox, nowBtn);
  form.append(when);

  const go = h('button', 'btn primary block', 'Vyhledat spojení');
  go.type = 'button';
  form.append(go);
  frag.append(form);

  const results = h('div', 'plan-results');
  frag.append(results);
  body.replaceChildren(frag);

  // Našeptávač zastávek
  let active = null;
  // Výška našeptávače podle místa nad klávesnicí (visualViewport je bez klávesnice).
  const fitSuggest = () => {
    if (suggest.hidden) return;
    const vv = window.visualViewport;
    const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const room = bottom - suggest.getBoundingClientRect().top - 12;
    suggest.style.setProperty('--suggest-max', `${Math.max(150, Math.round(room))}px`);
  };
  window.visualViewport?.addEventListener('resize', fitSuggest);
  const pick = (which, value) => {
    state[which] = value;
    persist();
    (which === 'from' ? fromInput : toInput).value = labelOf(value);
    suggest.hidden = true;
    if (which === 'from' && !state.to) toInput.focus();
    else if (state.from && state.to) search(results);
  };
  const updateSuggest = async (which, input) => {
    active = which;
    const P = await loadPlanner();
    if (active !== which) return;
    suggest.replaceChildren();
    const options = [];
    const q = input.value.trim();
    if (which === 'from' && !q) options.push(MY_LOCATION);
    if (P && q) {
      for (const t of findTowns(P, q, 2)) options.push({ name: t.name, town: true });
      for (const s of findStops(P, q, 12)) options.push({ name: s.name, label: s.full });
    }
    if (!q) {
      for (const r of state.recent) {
        if (r.from === 'Moje poloha' && which === 'from') continue;
        const [name, town] = which === 'from' ? [r.from, !!r.fromTown] : [r.to, !!r.toTown];
        options.push({ name, town, label: town ? undefined : P?.stops.find((x) => x.name === name)?.full, recent: true });
      }
    }
    const seen = new Set();
    for (const o of options) {
      const key = `${o.town ? 'town' : 'stop'}:${o.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const look = optionLook(o, P);
      const b = h('button', 'suggest-item');
      b.type = 'button';
      const icon = h('span', `suggest-icon ${look.kind}`);
      icon.innerHTML = look.icon;
      const text = h('span', 'suggest-text');
      text.append(h('span', 'suggest-name', o.label ?? o.name));
      if (look.sub) text.append(h('span', 'suggest-sub', o.recent ? `Nedávno hledané · ${look.sub}` : look.sub));
      b.append(icon, text);
      // Myší: pole si nechá focus. Výběr až na klepnutí (click), ne už při dotyku:
      // posunutí seznamu prstem tak zastávku nevybere.
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        pick(which, o.here ? MY_LOCATION : o.town ? { name: o.name, town: true } : { name: o.name, label: o.label ?? o.name });
        input.blur();
      });
      suggest.append(b);
      if (suggest.children.length >= 15) break;
    }
    suggest.hidden = !suggest.children.length;
    fitSuggest();
    // Našeptávač pod aktivním polem
    suggest.classList.toggle('under-to', which === 'to');
  };
  for (const [which, input] of [['from', fromInput], ['to', toInput]]) {
    input.addEventListener('focus', () => {
      input.select();
      updateSuggest(which, input);
    });
    input.addEventListener('input', () => {
      state[which] = null;
      updateSuggest(which, input);
    });
    input.addEventListener('blur', () =>
      setTimeout(() => {
        if (active === which) suggest.hidden = true;
        // Napsaný text bez výběru: vezmeme první shodu.
        if (!state[which] && input.value.trim()) {
          loadPlanner().then((P) => {
            const s = P && findStops(P, input.value)[0];
            if (s) pick(which, { name: s.name, label: s.full });
          });
        }
      }, 150),
    );
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        suggest.querySelector('.suggest-item')?.click();
      }
    });
  }
  go.addEventListener('click', () => search(results));
  if (state.results) drawResults(results, state.results);
  if (!state.from) fillNearest(fromInput);
}

function field(container, which, placeholder, dot) {
  const row = h('label', 'plan-field');
  row.append(h('span', `plan-dot ${dot}`));
  const input = h('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.enterKeyHint = which === 'from' ? 'next' : 'search';
  input.value = labelOf(state[which]);
  input.setAttribute('aria-label', placeholder);
  row.append(input);
  container.append(row);
  return input;
}

/** Odkud zatím nic: doplníme nejbližší zastávku podle polohy (ta může přijít až za chvíli). */
async function fillNearest(input) {
  const P = await loadPlanner();
  for (let i = 0; P && i < 20; i++) {
    if (state.from || !input.isConnected || document.activeElement === input || input.value.trim()) return;
    const pos = getPosition();
    if (pos) {
      let best = null;
      for (const s of P.stops) {
        if (s.lat == null) continue;
        const m = distanceMeters(pos[1], pos[0], s.lat, s.lon);
        if (!best || m < best.m) best = { s, m };
      }
      if (best) {
        state.from = { name: best.s.name, label: best.s.full, auto: true };
        input.value = labelOf(state.from);
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function origins(P) {
  if (state.from?.here) {
    const pos = getPosition();
    if (!pos) return { error: 'Poloha zatím není známá. Povol aplikaci přístup k poloze, nebo vyber zastávku.' };
    const near = nearbyStops(P, pos[1], pos[0]);
    if (!near.length) return { error: 'Do 10 minut chůze od tebe není žádná zastávka MHD.' };
    return { list: near };
  }
  // Celé město: odjezd z kterékoli jeho zastávky.
  if (state.from?.town) {
    const town = P.towns?.get(state.from.name);
    if (town) return { list: town.stops.map((i) => ({ stop: i, walk: 0 })) };
  }
  const s = P.stops.find((x) => x.name === state.from?.name);
  return s ? { list: [{ stop: s.i, walk: 0 }] } : { error: 'Vyber zastávku, odkud jedeš.' };
}

/** Cíl hledání: index zastávky, nebo všechny zastávky města (kromě těch, odkud se jede). */
function targetOf(P, origin) {
  if (state.to?.town) {
    const town = P.towns?.get(state.to.name);
    if (town) {
      const from = new Set(origin.map((o) => o.stop));
      const list = town.stops.filter((i) => !from.has(i));
      return list.length ? list : null;
    }
  }
  return P.stops.find((x) => x.name === state.to?.name)?.i ?? null;
}

async function search(results, more = false) {
  if (!state.from || !state.to) {
    results.replaceChildren(h('div', 'empty', 'Vyber, odkud a kam jedeš.'));
    return;
  }
  if (!more) results.replaceChildren(h('div', 'muted pad', 'Hledám spojení…'));
  const P = await loadPlanner();
  if (!P) {
    results.replaceChildren(h('div', 'empty', 'Jízdní řády se nepodařilo načíst. Zkus to prosím později.'));
    return;
  }
  const o = await origins(P);
  if (o.error) {
    results.replaceChildren(h('div', 'empty', o.error));
    return;
  }
  const target = targetOf(P, o.list);
  if (target == null) {
    results.replaceChildren(h('div', 'empty', state.to.town ? 'Už jsi v cílovém městě.' : 'Vyber zastávku, kam jedeš.'));
    return;
  }
  const date = state.date ?? pragueDate();
  let time = state.time ?? nowMinutes();
  let list = more && state.results ? state.results.list : [];
  if (more && list.length) time = list.at(-1).dep + 1;
  const found = searchJourneys(P, { origins: o.list, target, date, time, count: 5 });
  list = more ? [...list, ...found.filter((j) => !list.some((x) => x.dep === j.dep && x.arr === j.arr))] : found;
  state.results = { list, date, P, done: !found.length };
  if (!more) {
    const rec = { from: state.from.name, to: state.to.name, fromTown: !!state.from.town, toTown: !!state.to.town };
    state.recent = [rec, ...state.recent.filter((r) => r.from !== rec.from || r.to !== rec.to || !!r.fromTown !== rec.fromTown || !!r.toTown !== rec.toTown)].slice(0, 5);
    persist();
  }
  drawResults(results, state.results);
}

// Přehled spojení v seznamu: každá jízda na řádku (linka, odjezd, odkud → kam), pěší přesuny mezi nimi.
function legRows(j, P) {
  const el = h('div', 'result-legs');
  j.legs.forEach((l, i) => {
    if (l.type === 'walk') {
      const transfer = i > 0 && i < j.legs.length - 1;
      const row = h('div', `rleg rleg-walk${transfer ? ' transfer' : ''}`);
      const icon = h('span', 'rleg-icon');
      icon.innerHTML = ICON_WALK;
      const to = P.stops[l.to].full;
      row.append(icon, h('span', 'rleg-text', transfer ? `${l.min} min pěšky na zastávku ${to}` : i === 0 ? `${l.min} min pěšky na ${to}` : `${l.min} min pěšky do cíle`));
      el.append(row);
      return;
    }
    if (l.stay) {
      const row = h('div', 'rleg rleg-stay');
      row.append(h('span', 'rleg-icon'), h('span', 'rleg-text', `pokračuje dál jako ${l.trip.pattern.r}, zůstaň ${l.trip.pattern.y === 'v' ? 've vlaku' : 've voze'}`));
      el.append(row);
      return;
    }
    // Konec jízdy: poslední navazující úsek stejné linky
    let end = l;
    for (let k = i + 1; k < j.legs.length && j.legs[k].stay; k++) end = j.legs[k];
    const row = h('div', 'rleg');
    row.append(lineBadge(l.trip.pattern, l.trip));
    const text = h('span', 'rleg-text');
    text.append(h('b', 'rleg-time', fmt(l.dep)), ` ${P.stops[l.from].full} `, h('span', 'rleg-arrow', '→'), ` ${P.stops[end.to].full}`);
    row.append(text);
    el.append(row);
  });
  return el;
}

function drawResults(results, { list, date, P, done }) {
  results.replaceChildren();
  if (!list.length) {
    results.append(h('div', 'empty', 'Pro zvolený čas jsem žádné spojení nenašel. Zkus jiný čas nebo den.'));
    return;
  }
  const today = date === pragueDate();
  const now = nowMinutes();
  results.append(h('h3', 'section-title', today ? 'Nejbližší spojení' : `Spojení ${Number(date.slice(8))}. ${Number(date.slice(5, 7))}.`));
  const group = h('div', 'group result-list');
  const fastest = Math.min(...list.map((j) => j.duration));
  for (const j of list) {
    const b = h('button', 'result');
    b.type = 'button';
    const top = h('div', 'result-top');
    const times = h('span', 'result-times');
    times.append(fmt(j.dep), h('span', 'result-dash', ' → '), fmt(j.arr));
    top.append(times, h('span', 'result-dur', durationText(j.duration)));
    const tags = h('div', 'result-tags');
    if (today && j.dep >= now && j.dep - now < 60) tags.append(h('span', 'tag tag-soon', j.dep === now ? 'odjíždí teď' : `za ${j.dep - now} min`));
    tags.append(h('span', 'tag', j.transfers ? plural(j.transfers, 'přestup', 'přestupy', 'přestupů') : 'přímý spoj'));
    if (j.duration === fastest && list.length > 1) tags.append(h('span', 'tag tag-best', 'nejrychlejší'));
    if (j.walkTransfers) {
      const warn = h('span', 'tag tag-warn');
      warn.innerHTML = ICON_WARN;
      warn.append(' přestup pěšky');
      tags.append(warn);
    }
    b.append(top, tags, legRows(j, P));
    b.append(h('span', 'chevron', '›'));
    b.addEventListener('click', () => show(() => renderDetail(j, P, date)));
    group.append(b);
  }
  results.append(group);
  if (!done) {
    const moreBtn = h('button', 'btn block', 'Pozdější spojení');
    moreBtn.type = 'button';
    moreBtn.addEventListener('click', () => search(results, true));
    results.append(moreBtn);
  }
}

// --- detail spojení ------------------------------------------------------------------
function renderDetail(j, P, date) {
  title.textContent = `${fmt(j.dep)} → ${fmt(j.arr)}`;
  const frag = document.createDocumentFragment();
  const head = h('div', 'detail-head');
  head.append(h('div', 'detail-times', `${fmt(j.dep)} → ${fmt(j.arr)}`));
  head.append(h('div', 'muted', `${durationText(j.duration)} · ${j.transfers ? plural(j.transfers, 'přestup', 'přestupy', 'přestupů') : 'bez přestupu'}`));
  frag.append(head);

  const legsEl = h('div', 'legs');
  j.legs.forEach((l, i) => {
    if (l.type === 'walk') {
      const card = h('div', `leg-walk${i > 0 && i < j.legs.length - 1 ? ' transfer' : ''}`);
      const icon = h('span', 'leg-walk-icon');
      icon.innerHTML = ICON_WALK;
      const text = h('div');
      const fromName = l.from < 0 ? 'Z tvé polohy' : P.stops[l.from].full;
      const toName = P.stops[l.to].full;
      if (i > 0 && i < j.legs.length - 1) {
        text.append(h('div', 'leg-walk-title', `Přejdi pěšky na zastávku ${toName}`));
        text.append(h('div', 'leg-walk-sub', `z ${fromName} · asi ${l.min} min, ${l.m} m. Přestup mezi různými zastávkami.`));
      } else if (i === 0) {
        text.append(h('div', 'leg-walk-title', `Dojdi na zastávku ${toName}`));
        text.append(h('div', 'leg-walk-sub', `${fromName} · asi ${l.min} min, ${l.m} m`));
      } else {
        text.append(h('div', 'leg-walk-title', `Dojdi pěšky na ${toName}`));
        text.append(h('div', 'leg-walk-sub', `z ${fromName} · asi ${l.min} min, ${l.m} m`));
      }
      card.append(icon, text);
      legsEl.append(card);
      return;
    }
    // Přestup na stejné zastávce: čekání
    const prev = j.legs[i - 1];
    if (l.stay) legsEl.append(h('div', 'leg-change', `Spoj pokračuje dál jako linka ${l.trip.pattern.r}, zůstaň ve voze${l.dep - prev.arr ? ` (stojí ${l.dep - prev.arr} min)` : ''}`));
    else if (prev?.type === 'ride') legsEl.append(h('div', 'leg-change', `Přestup na stejné zastávce · čekání ${l.dep - prev.arr} min`));
    else if (prev?.type === 'walk' && l.dep - prev.arr > 0 && i > 1) legsEl.append(h('div', 'leg-change', `Čekání ${l.dep - prev.arr} min`));

    const stops = rideStops(P, l);
    const card = colorRide(h('div', 'leg-ride'), l.trip.pattern);
    const lh = h('div', 'leg-head');
    lh.append(lineBadge(l.trip.pattern, l.trip));
    const lt = h('div');
    lt.append(h('div', 'leg-dir', `směr ${l.trip.pattern.h}`), h('div', 'muted small', `${rideKind(l.trip.pattern)} · ${durationText(l.arr - l.dep)}`));
    const note = l.trip.mark && P.notes?.[l.trip.pattern.r]?.[l.trip.mark];
    if (note) lt.append(h('div', 'muted small', `${l.trip.pattern.r}${l.trip.mark}: ${note}`));
    lh.append(lt);
    card.append(lh);
    const ol = h('ol', 'leg-stops');
    const row = (s, cls) => {
      const li = h('li', cls);
      li.append(h('span', 'leg-time', fmt(s.time)), h('span', 'leg-name', s.full ?? s.name));
      return li;
    };
    ol.append(row(stops[0], 'board'));
    const mids = stops.slice(1, -1);
    if (mids.length) {
      const toggle = h('li', 'leg-more');
      const btn = h('button', null, `${plural(mids.length, 'zastávka', 'zastávky', 'zastávek')} mezi`);
      btn.type = 'button';
      toggle.append(btn);
      ol.append(toggle);
      const midEls = mids.map((s) => row(s, 'mid'));
      btn.addEventListener('click', () => {
        toggle.replaceWith(...midEls);
      });
    }
    ol.append(row(stops.at(-1), 'alight'));
    card.append(ol);
    legsEl.append(card);
  });
  frag.append(legsEl);

  const mapBtn = h('button', 'btn primary block', 'Ukázat na mapě');
  mapBtn.type = 'button';
  mapBtn.addEventListener('click', () => onShowOnMap(j, P, date));
  frag.append(mapBtn);
  body.replaceChildren(frag);
}

// --- veřejné rozhraní -------------------------------------------------------------
export function initPlanner({ showOnMap, position }) {
  onShowOnMap = showOnMap;
  getPosition = position;
  stack.length = 0;
  show(renderSearch);
  loadPlanner();
}

export { loadPlanner, rideStops };
