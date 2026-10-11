import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { Map, Marker, AttributionControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { mapStyle } from './style.js';
import { VehicleLayer } from './vehicles.js';
import { fetchVehicles, fetchTrip, fetchRegionTrains, fetchCityVehicles, proxyConfigured, REFRESH_MS } from './data.js';
import { cityTrip } from './cities.js';
import { renderDetails, renderTrip } from './card.js';
import { applyVehicleColors, trainColors, TYPE_COLORS } from './colors.js';
import { computeRoute, drawRoute, clearRoute, loadRoutes, drawLineRoutes, drawJourney, clearJourney } from './route.js';
import { drawRegion, loadRegion } from './region.js';
import { TRAIN_REFRESH_MS } from './trains.js';
import { matchJourneyVehicles } from './journey-vehicles.js';
import { snapVehicle } from './snap.js';
import { store, matchesFilter } from './store.js';
import { initFilter, setKnownLines } from './filter.js';
import { initPlanner, loadPlanner } from './plannerview.js';
import { trainTrip, trainPosition } from './train-trip.js';
import { initInstall } from './install.js';

// MapLibre 6 si worker hledá vedle sebe, po sestavení Vitem ho musíme předat ručně.
setWorkerUrl(workerUrl);

const ZLIN = [17.6679, 49.2265];

const map = new Map({
  container: 'map',
  style: mapStyle,
  center: ZLIN,
  zoom: 13,
  minZoom: 9,
  maxZoom: 18,
  attributionControl: false,
  dragRotate: false,
  pitchWithRotate: false,
});
map.touchZoomRotate.disableRotation();
map.keyboard.disableRotation();
map.addControl(new AttributionControl({ compact: true }), 'bottom-left');

const statusEl = document.getElementById('status');
function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

// --- Záložky -------------------------------------------------------------------
const views = { map: document.getElementById('view-map'), plan: document.getElementById('view-plan') };
let plannerInitialized = false;

function showView(name) {
  for (const [key, el] of Object.entries(views)) {
    el.hidden = key !== name;
    el.classList.toggle('active', key === name);
  }
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.view === name);
  if (name === 'map') map.resize();
  if (name === 'plan' && !plannerInitialized) {
    plannerInitialized = true;
    initPlanner({ showOnMap: showJourneyOnMap, position: () => myPosition });
  }
}

for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => showView(tab.dataset.view));

// --- Spojení na mapě ------------------------------------------------------------
const journeyBar = document.getElementById('journey-bar');
const fmtMin = (m) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// Zobrazené spojení: na mapě je jen ono a vozy, kterými se pojede; ostatní vozy a trasy se skryjí.
let journeyFocus = null; // { journey, P, date, ids }

const pragueNow = () => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, min: Number(parts.hour) * 60 + Number(parts.minute) };
};

function journeyVehicleIds() {
  if (!journeyFocus) return null;
  const { journey, P, date } = journeyFocus;
  const now = pragueNow();
  // Vozy hledáme jen pro dnešní spojení, které už brzy jede nebo právě jede.
  const ids = date === now.date && now.min >= journey.dep - 60 && now.min <= journey.arr + 5 ? matchJourneyVehicles(journey, P, [...store.vehicles, ...store.cityBuses, ...store.trains], now.min) : [];
  journeyFocus.ids = ids;
  return new Set(ids.filter(Boolean));
}

function updateJourneyBar() {
  if (!journeyFocus) return;
  const { journey } = journeyFocus;
  const rides = journey.legs.filter((l) => l.type === 'ride' && !l.stay).length;
  const found = (journeyFocus.ids ?? []).filter(Boolean).length;
  const text = journeyBar.querySelector('.jb-text');
  const sub = journeyBar.querySelector('.jb-sub');
  text.textContent = `Spojení ${fmtMin(journey.dep)} → ${fmtMin(journey.arr)}`;
  sub.textContent = found ? `na mapě ${found === rides ? (rides === 1 ? 'tvůj vůz' : 'tvoje vozy') : `${found} z ${rides} vozů`}` : 'vozy se ukážou, až vyjedou';
}

async function showJourneyOnMap(journey, P, date) {
  deselect();
  showView('map');
  journeyFocus = { journey, P, date, ids: [] };
  const bounds = await drawJourney(map, journey, P);
  journeyBar.replaceChildren();
  const label = document.createElement('span');
  label.className = 'jb-label';
  const text = document.createElement('span');
  text.className = 'jb-text';
  const sub = document.createElement('span');
  sub.className = 'jb-sub';
  label.append(text, sub);
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Zavřít';
  close.addEventListener('click', hideJourney);
  journeyBar.append(label, close);
  journeyBar.hidden = false;
  if (map.getLayer('filter-routes')) map.setLayoutProperty('filter-routes', 'visibility', 'none');
  render();
  if (bounds) map.fitBounds(bounds, { padding: { top: 120, bottom: 130, left: 40, right: 100 }, maxZoom: 16 });
}

function hideJourney() {
  if (!journeyFocus) return;
  journeyFocus = null;
  journeyBar.hidden = true;
  clearJourney(map);
  if (map.getLayer('filter-routes')) map.setLayoutProperty('filter-routes', 'visibility', 'visible');
  render();
}

// --- Moje poloha -------------------------------------------------------------
const meEl = document.createElement('div');
meEl.className = 'me';
const meMarker = new Marker({ element: meEl });
let myPosition = null;
let meShown = false;
let followMe = true;

if ('geolocation' in navigator) {
  navigator.geolocation.watchPosition(
    (pos) => {
      myPosition = [pos.coords.longitude, pos.coords.latitude];
      meMarker.setLngLat(myPosition);
      if (!meShown) {
        meMarker.addTo(map);
        meShown = true;
      }
      if (followMe) {
        map.easeTo({ center: myPosition, zoom: Math.max(map.getZoom(), 14) });
        followMe = false;
      }
    },
    (err) => console.warn('Poloha nedostupná:', err.message),
    { enableHighAccuracy: true, maximumAge: 10000 },
  );
}

document.getElementById('locate').addEventListener('click', () => {
  if (myPosition) map.easeTo({ center: myPosition, zoom: Math.max(map.getZoom(), 15) });
  else followMe = true;
});

// --- Detail vozu při najetí myší ----------------------------------------------
const hoverEl = document.getElementById('hover-card');

function showHover(v, markerEl) {
  hoverEl.replaceChildren(renderDetails(v));
  const box = markerEl.getBoundingClientRect();
  const mapBox = map.getContainer().getBoundingClientRect();
  hoverEl.hidden = false;
  const w = hoverEl.offsetWidth;
  const hgt = hoverEl.offsetHeight;
  let left = box.left - mapBox.left + box.width / 2 - w / 2;
  let top = box.top - mapBox.top - hgt - 14;
  if (top < 8) top = box.bottom - mapBox.top + 14;
  left = Math.max(8, Math.min(left, mapBox.width - w - 8));
  hoverEl.style.transform = `translate(${left}px, ${top}px)`;
}

function hideHover() {
  hoverEl.hidden = true;
}

// --- Vybraný vůz: trasa a jízdní řád --------------------------------------------
const sheetEl = document.getElementById('sheet');
let selected = null; // { id, trip, token }

/** Všechny zastávky vlaku z jízdních řádů (data vyhledávání spojení); [] když vlak nenajdeme. */
async function fetchTrainTrip(v) {
  const P = await loadPlanner();
  const { date, min } = pragueNow();
  return trainTrip(P, v.number, date, min) ?? [];
}

/** Spoj vozu MHD Kroměříže nebo Valašského Meziříčí z jízdních řádů IDZK. */
async function fetchCityTrip(v) {
  const P = await loadPlanner();
  const { date, min } = pragueNow();
  return cityTrip(P, v, date, min);
}

async function updateSelected(first = false) {
  if (!selected) return;
  const v = vehicles.get(selected.id);
  if (!v) return deselect();
  applyVehicleColors(sheetEl, v);
  sheetEl.querySelector('.sheet-details').replaceChildren(renderDetails(v, selected.trip));
  const tripEl = sheetEl.querySelector('.sheet-trip');
  const keep = tripEl.scrollTop;
  // Vlak: kde je vůči zastávkám, podle posledního projetého bodu a jízdního řádu.
  const pos = v.type === 'train' && selected.trip?.length ? trainPosition(selected.trip, v, pragueNow().min) : null;
  tripEl.replaceChildren(
    renderTrip(selected.trip, v, {
      scroll: first,
      showPassed: selected.showPassed,
      current: pos?.current,
      atStop: pos ? pos.atStop : (selected.atStop ?? true),
      onTogglePassed: () => {
        selected.showPassed = !selected.showPassed;
        updateSelected();
      },
    }),
  );
  if (!first) tripEl.scrollTop = keep;
  const token = selected.token;
  const route = await computeRoute(v, selected.trip ?? [], pos?.current);
  if (!selected || selected.token !== token) return;
  if (route) drawRoute(map, route, v.type, v.type === 'train' ? trainColors(v.operator) : v.city ? TYPE_COLORS[v.city] : null);
  else clearRoute(map);
  if (pos) return; // u vlaku poloha vůči zastávkám už je známá
  // Poloha vůči zastávkám je známá až z trasy: když vůz už odjel ze zastávky, překreslíme seznam.
  const atStop = route?.atStop ?? true;
  if (atStop !== (selected.atStop ?? true)) {
    selected.atStop = atStop;
    updateSelected();
  }
}

const isWide = () => matchMedia('(min-width: 720px)').matches;

function sheetPadding() {
  return isWide()
    ? { left: sheetEl.getBoundingClientRect().right, top: 0, right: 0, bottom: 0 }
    : { bottom: map.getContainer().clientHeight - sheetEl.getBoundingClientRect().top + 8, top: 60, left: 0, right: 0 };
}

// Tažení panelu za horní okraj: nahoru = celá výška, dolů = menší výška, nebo zavřít.
(() => {
  let start = null;
  const handle = sheetEl.querySelector('.sheet-handle');
  const details = sheetEl.querySelector('.sheet-details');
  const begin = (e) => {
    if (isWide() || e.target.closest('button')) return;
    start = { y: e.clientY, t: Date.now() };
    sheetEl.classList.add('dragging');
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (!start) return;
    const dy = e.clientY - start.y;
    // Nahoru jen s odporem (panel se pak roztáhne), dolů za prstem.
    sheetEl.style.transform = `translateY(${dy > 0 ? dy : dy * 0.35}px)`;
  };
  const end = (e) => {
    if (!start) return;
    const dy = e.clientY - start.y;
    const fast = Math.abs(dy) / Math.max(1, Date.now() - start.t) > 0.5;
    start = null;
    sheetEl.classList.remove('dragging');
    sheetEl.style.transform = '';
    if (dy < -40 || (fast && dy < -10)) sheetEl.classList.add('expanded');
    else if (dy > 60 || (fast && dy > 10)) {
      if (sheetEl.classList.contains('expanded')) sheetEl.classList.remove('expanded');
      else deselect();
    } else if (Math.abs(dy) < 5 && e.currentTarget === handle) sheetEl.classList.toggle('expanded');
  };
  for (const el of [handle, details]) {
    el.addEventListener('pointerdown', begin);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
})();

async function select(v) {
  hideHover();
  // Vůz ze zobrazeného spojení: spojení necháme na mapě.
  if (!journeyFocus?.ids?.includes(v.id)) hideJourney();
  const token = Symbol();
  // Vlak: hned celý jízdní řád včetně projetých stanic (dají se skrýt).
  selected = { id: v.id, trip: null, token, showPassed: v.type === 'train' };
  vehicles.select(v.id);
  sheetEl.hidden = false;
  // Vůz posuneme do volné části mapy vedle panelu.
  map.easeTo({ center: [v.lon, v.lat], padding: sheetPadding() });
  updateSelected(true);
  const trip = v.type === 'train' ? await fetchTrainTrip(v) : v.city ? await fetchCityTrip(v) : await fetchTrip(v);
  if (!selected || selected.token !== token) return;
  selected.trip = trip;
  updateSelected(true);
}

function deselect() {
  if (!selected) return;
  map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 } });
  selected = null;
  vehicles.select(null);
  sheetEl.hidden = true;
  sheetEl.classList.remove('expanded');
  clearRoute(map);
}

sheetEl.querySelector('.sheet-close').addEventListener('click', deselect);
map.on('click', deselect);
document.addEventListener('keydown', (e) => e.key === 'Escape' && deselect());

// --- Vozidla -----------------------------------------------------------------
const vehicles = new VehicleLayer(map, { onHover: showHover, onLeave: hideHover, onSelect: select });
let routes = [];
let timer = null;
let trainTimer = null;

let lastUpdate = null;
function render() {
  const mine = journeyVehicleIds();
  const all = [...store.vehicles, ...store.cityBuses, ...store.trains];
  const shown = mine ? all.filter((v) => mine.has(v.id)) : all.filter((v) => matchesFilter(v, store.filter));
  const visible = selected && !shown.some((v) => v.id === selected.id) ? [...shown, ...all.filter((v) => v.id === selected.id)] : shown;
  vehicles.update(visible);
  updateJourneyBar();
  updateSelected();
  drawRegion(map);
  if (lastUpdate) {
    const total = store.vehicles.length + store.cityBuses.length;
    const buses = shown.filter((v) => v.type !== 'train').length;
    const trains = shown.length - buses;
    const parts = [buses === total ? `${total} vozů` : `${buses} z ${total} vozů`];
    if (trains) parts.push(`${trains} ${trains === 1 ? 'vlak' : trains < 5 ? 'vlaky' : 'vlaků'}`);
    setStatus(`${parts.join(' · ')} · ${lastUpdate}`);
  }
}

async function refresh() {
  try {
    const list = await fetchVehicles();
    lastUpdate = new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
    store.setVehicles(list.map((v) => snapVehicle(map, routes, v)));
  } catch (err) {
    console.error(err);
    setStatus(navigator.onLine ? 'Data DSZO se nepodařilo načíst' : 'Bez připojení', true);
  }
}

async function refreshTrains() {
  try {
    store.setTrains(await fetchRegionTrains(await loadRegion()));
  } catch (err) {
    // Vlaky jsou doplněk: bez nich mapa MHD funguje dál (např. starší proxy bez /trains).
    console.warn('Vlaky se nepodařilo načíst:', err.message);
  }
}

async function refreshCities() {
  try {
    store.setCityBuses(await fetchCityVehicles());
  } catch (err) {
    // MHD dalších měst je doplněk (starší proxy bez /mhd): Zlín funguje dál.
    console.warn('MHD dalších měst se nepodařilo načíst:', err.message);
  }
}

let lastFilter = '';
store.subscribe(() => {
  render();
  const key = JSON.stringify(store.filter);
  if (key !== lastFilter) {
    lastFilter = key;
    // Vybrané linky ukážeme na mapě i s trasou.
    if (map.isStyleLoaded()) drawLineRoutes(map, routes.filter((r) => store.filter.lines.includes(r.ref)));
  }
});

function start() {
  if (!proxyConfigured) {
    setStatus('Chybí proxy pro data DSZO', true);
    return;
  }
  if (timer) return;
  refresh();
  refreshTrains();
  refreshCities();
  timer = setInterval(() => {
    refresh();
    refreshCities();
  }, REFRESH_MS);
  trainTimer = setInterval(refreshTrains, TRAIN_REFRESH_MS);
}

function stop() {
  clearInterval(timer);
  clearInterval(trainTimer);
  timer = null;
  trainTimer = null;
}

// Když je aplikace na pozadí, data nestahujeme.
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

// Vozy načítáme hned, nečekáme na mapu: když se nenačtou podklady mapy, polohy vozů se ukážou i tak.
const cached = store.cachedVehicles();
if (cached) store.setVehicles(cached);
start();
loadRoutes().then((data) => {
  routes = data.routes;
  if (map.isStyleLoaded()) drawLineRoutes(map, routes.filter((r) => store.filter.lines.includes(r.ref)));
});
map.on('load', () => {
  drawLineRoutes(map, routes.filter((r) => store.filter.lines.includes(r.ref)));
  drawRegion(map);
});

initFilter();
initInstall();
fetch('./tt/index.json')
  .then((r) => (r.ok ? r.json() : { lines: [] }))
  .catch(() => ({ lines: [] }))
  .then((index) => setKnownLines(index.lines ?? []));

// Obnovit: stáhne novou verzi aplikace (i na ploše) a čerstvé jízdní řády, pak stránku načte znovu,
// takže se obnoví i polohy všech vozů.
document.getElementById('reload').addEventListener('click', async (e) => {
  e.currentTarget.classList.add('spinning');
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    const keys = (await globalThis.caches?.keys()) ?? [];
    await Promise.all(keys.filter((k) => !k.includes('tiles')).map((k) => caches.delete(k)));
  } catch (err) {
    console.warn('Obnovení aplikace:', err.message);
  }
  location.reload();
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Aplikace na ploše se po přepnutí zpět jen probudí a běží dál stará verze.
  // Při návratu proto zkontrolujeme novou verzi, a když se nainstaluje, stránku jednou obnovíme.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  });
}
