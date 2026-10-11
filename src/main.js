import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { Map, Marker, AttributionControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { mapStyle } from './style.js';
import { VehicleLayer } from './vehicles.js';
import { fetchVehicles, fetchTrip, proxyConfigured, REFRESH_MS } from './data.js';
import { renderDetails, renderTrip } from './card.js';
import { applyTypeColors } from './colors.js';
import { computeRoute, drawRoute, clearRoute, loadRoutes, drawLineRoutes } from './route.js';
import { snapVehicle } from './snap.js';
import { store, matchesFilter } from './store.js';
import { initFilter, setKnownLines } from './filter.js';
import { initTimetables, openLine, loadIndex, refreshIndex } from './ttview.js';
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
const views = { map: document.getElementById('view-map'), lines: document.getElementById('view-lines') };
let ttInitialized = false;

function showView(name) {
  for (const [key, el] of Object.entries(views)) {
    el.hidden = key !== name;
    el.classList.toggle('active', key === name);
  }
  for (const tab of document.querySelectorAll('.tab')) tab.classList.toggle('active', tab.dataset.view === name);
  if (name === 'map') map.resize();
  if (name === 'lines') {
    if (!ttInitialized) {
      ttInitialized = true;
      initTimetables({ showOnMap });
    } else refreshIndex();
  }
}

for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => showView(tab.dataset.view));

function showOnMap(ref) {
  store.setFilter({ lines: [ref] });
  showView('map');
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
  following = null;
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
const followBtn = document.getElementById('sheet-follow');
let selected = null; // { id, trip, token }
let following = null; // id sledovaného vozu

async function updateSelected(first = false) {
  if (!selected) return;
  const v = vehicles.get(selected.id);
  if (!v) return deselect();
  applyTypeColors(sheetEl, v.type);
  sheetEl.querySelector('.sheet-details').replaceChildren(renderDetails(v));
  sheetEl.querySelector('.sheet-trip').replaceChildren(renderTrip(selected.trip, v, { scroll: first }));
  followBtn.textContent = following === v.id ? 'Sledováno' : 'Sledovat';
  followBtn.classList.toggle('following', following === v.id);
  followBtn.setAttribute('aria-pressed', String(following === v.id));
  if (following === v.id) map.easeTo({ center: [v.lon, v.lat], duration: 1000 });
  const token = selected.token;
  const route = await computeRoute(v, selected.trip ?? []);
  if (!selected || selected.token !== token) return;
  if (route) drawRoute(map, route, v.type);
  else clearRoute(map);
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
  const token = Symbol();
  selected = { id: v.id, trip: null, token };
  if (following !== v.id) following = null;
  vehicles.select(v.id);
  sheetEl.hidden = false;
  // Vůz posuneme do volné části mapy vedle panelu.
  map.easeTo({ center: [v.lon, v.lat], padding: sheetPadding() });
  updateSelected(true);
  const trip = await fetchTrip(v);
  if (!selected || selected.token !== token) return;
  selected.trip = trip;
  updateSelected(true);
}

function deselect() {
  if (!selected) return;
  map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 } });
  selected = null;
  following = null;
  vehicles.select(null);
  sheetEl.hidden = true;
  sheetEl.classList.remove('expanded');
  clearRoute(map);
}

sheetEl.querySelector('.sheet-close').addEventListener('click', deselect);
followBtn.addEventListener('click', () => {
  if (!selected) return;
  following = following === selected.id ? null : selected.id;
  updateSelected();
});
document.getElementById('sheet-timetable').addEventListener('click', () => {
  const v = selected && vehicles.get(selected.id);
  if (!v) return;
  openLine(v.line, v.headsign);
  ttInitialized = true;
  showView('lines');
});
map.on('click', deselect);
map.on('dragstart', () => (following = null));
document.addEventListener('keydown', (e) => e.key === 'Escape' && deselect());

// --- Vozidla -----------------------------------------------------------------
const vehicles = new VehicleLayer(map, { onHover: showHover, onLeave: hideHover, onSelect: select });
let routes = [];
let timer = null;

let lastUpdate = null;
function render() {
  const shown = store.vehicles.filter((v) => matchesFilter(v, store.filter));
  const visible = selected && !shown.some((v) => v.id === selected.id) ? [...shown, ...store.vehicles.filter((v) => v.id === selected.id)] : shown;
  vehicles.update(visible);
  updateSelected();
  if (lastUpdate) {
    const total = store.vehicles.length;
    setStatus(shown.length === total ? `${total} vozů · ${lastUpdate}` : `${shown.length} z ${total} vozů · ${lastUpdate}`);
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
  timer = setInterval(refresh, REFRESH_MS);
}

function stop() {
  clearInterval(timer);
  timer = null;
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
map.on('load', () => drawLineRoutes(map, routes.filter((r) => store.filter.lines.includes(r.ref))));

initFilter();
initInstall();
loadIndex().then((index) => setKnownLines(index.lines));

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js');
}
