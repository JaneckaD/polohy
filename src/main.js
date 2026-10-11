import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { Map, Marker, AttributionControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { mapStyle } from './style.js';
import { VehicleLayer } from './vehicles.js';
import { fetchVehicles, fetchTrip, proxyConfigured, REFRESH_MS } from './data.js';
import { renderDetails, renderTrip } from './card.js';
import { TYPE_COLORS } from './colors.js';
import { computeRoute, drawRoute, clearRoute, loadRoutes } from './route.js';

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

async function updateSelected(first = false) {
  if (!selected) return;
  const v = vehicles.get(selected.id);
  if (!v) return deselect();
  sheetEl.style.setProperty('--trip-color', (TYPE_COLORS[v.type] ?? TYPE_COLORS.bus).main);
  sheetEl.querySelector('.sheet-details').replaceChildren(renderDetails(v));
  sheetEl.querySelector('.sheet-trip').replaceChildren(renderTrip(selected.trip, v, { scroll: first }));
  const token = selected.token;
  const route = await computeRoute(v, selected.trip ?? []);
  if (!selected || selected.token !== token) return;
  if (route) drawRoute(map, route, v.type);
  else clearRoute(map);
}

async function select(v) {
  hideHover();
  const token = Symbol();
  selected = { id: v.id, trip: null, token };
  vehicles.select(v.id);
  sheetEl.hidden = false;
  // Vůz posuneme do volné části mapy vedle panelu (na počítači vlevo, na mobilu dole až 58 % výšky).
  const wide = matchMedia('(min-width: 720px)').matches;
  map.easeTo({
    center: [v.lon, v.lat],
    padding: wide
      ? { left: sheetEl.getBoundingClientRect().right, top: 0, right: 0, bottom: 0 }
      : { bottom: map.getContainer().clientHeight * 0.58, top: 0, left: 0, right: 0 },
  });
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
  vehicles.select(null);
  sheetEl.hidden = true;
  clearRoute(map);
}

sheetEl.querySelector('.sheet-close').addEventListener('click', deselect);
map.on('click', deselect);
document.addEventListener('keydown', (e) => e.key === 'Escape' && deselect());

// --- Vozidla -----------------------------------------------------------------
const vehicles = new VehicleLayer(map, { onHover: showHover, onLeave: hideHover, onSelect: select });
let timer = null;

async function refresh() {
  try {
    const list = await fetchVehicles();
    vehicles.update(list);
    updateSelected();
    const time = new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setStatus(`${list.length} vozidel · ${time}`);
  } catch (err) {
    console.error(err);
    setStatus('Data DSZO se nepodařilo načíst', true);
  }
}

function start() {
  if (!proxyConfigured) {
    setStatus('Chybí proxy pro data DSZO (viz README)', true);
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
map.on('load', () => {
  start();
  loadRoutes();
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js');
}
