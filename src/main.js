import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { Map, Marker, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { mapStyle } from './style.js';
import { VehicleLayer } from './vehicles.js';
import { fetchVehicles, fetchTrip, fetchRegionTrains, fetchCityVehicles, fetchRegionCoaches, fetchCoachRoute, fetchJmkSnapshot, proxyConfigured, REFRESH_MS } from './data.js';
import { coachTrip, coachPosition, COACH_REFRESH_MS } from './coaches.js';
import { cityTrip, timeTripPosition, isCoach } from './cities.js';
import { loadRegioJet, regioJetVehicles } from './regiojet.js';
import { estimatedVehicles, setBusRoutes, hasBusRoutes, segmentsOf, setJmkDown, setLiveTrips, setLiveKraje } from './estimated.js';
import { setOdisSegments } from './odis.js';
import { JmkLive, setJmkSegments } from './jmk.js';
import { currentTripIndex } from './route-match.js';
import { renderDetails, renderTrip } from './card.js';
import { applyVehicleColors, vehicleColors } from './colors.js';
import { computeRoute, drawRoute, clearRoute, loadRoutes, loadBusRoutes, drawLineRoutes, drawJourney, clearJourney } from './route.js';
import { drawRegion, loadRegion, railArea, krajArea } from './region.js';
import { TRAIN_REFRESH_MS } from './trains.js';
import { matchJourneyVehicles } from './journey-vehicles.js';
import { snapVehicle } from './snap.js';
import { store, matchesFilter } from './store.js';
import { setFilterRegion } from './filtering.js';
import { initFilter } from './filter.js';
import { initLegend } from './legend.js';
import { initInfo } from './info.js';
import { initModals } from './modal.js';
import { vehicleMark } from './dszo-marks.js';
import { initPlanner, loadPlanner } from './plannerview.js';
import { trainTrip, trainPosition, completeTrains } from './train-trip.js';
import { initInstall } from './install.js';

// MapLibre 6 si worker hledá vedle sebe, po sestavení Vitem ho musíme předat ručně.
setWorkerUrl(workerUrl);

const ZLIN = [17.6679, 49.2265];

const map = new Map({
  container: 'map',
  style: mapStyle,
  center: ZLIN,
  zoom: 13,
  minZoom: 7, // celá oblast (čtyři moravské a slezské kraje) na jedné obrazovce
  maxZoom: 18,
  attributionControl: false,
  dragRotate: false,
  pitchWithRotate: false,
});
map.touchZoomRotate.disableRotation();
// Pro automatické testy vzhledu (?debug).
if (new URLSearchParams(location.search).has('debug')) window.__map = map;
map.keyboard.disableRotation();
// Autorská práva a zdroje dat (i licence CC BY poloh IDS JMK) jsou v okně Informace (ikonka i vlevo dole).

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
  const ids = date === now.date && now.min >= journey.dep - 60 && now.min <= journey.arr + 5 ? matchJourneyVehicles(journey, P, store.allVehicles(), now.min) : [];
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

/** Dálkový autobus: zastávky nese už vůz, trasu po silnicích stáhneme (RegioJet ji má s jízdním řádem). */
async function fetchCoachTrip(v) {
  const trip = coachTrip(v);
  const segments = v.segments ?? (v.city === 'flix' ? await fetchCoachRoute(v) : null);
  if (segments) trip.segments = segments;
  return trip;
}

async function updateSelected(first = false) {
  if (!selected) return;
  const v = vehicles.get(selected.id);
  if (!v) return deselect();
  // Živý vůz IDS JMK přejel na další spoj (nebo se spoj teprve dohledal): zastávky nového spoje.
  if (v.calls && v.tripId != null && selected.trip && v.tripId !== selected.tripId) {
    selected.tripId = v.tripId;
    selected.trip = coachTrip(v);
    if (v.segments) selected.trip.segments = v.segments;
  }
  applyVehicleColors(sheetEl, v);
  sheetEl.querySelector('.sheet-details').replaceChildren(renderDetails(v, selected.trip));
  const tripEl = sheetEl.querySelector('.sheet-trip');
  const keep = tripEl.scrollTop;
  // Vlak: kde je vůči zastávkám, podle posledního projetého bodu a jízdního řádu.
  // Dálkový autobus: dopravce hlásí příští zastávku a jestli v ní stojí.
  // MHD jiných měst, když název zastávky ve spoji nenajdeme: podle jízdního řádu a zpoždění.
  const pos = !selected.trip?.length
    ? null
    : v.type === 'train'
      ? trainPosition(selected.trip, v, pragueNow().min)
      : v.calls || isCoach(v.city)
        ? coachPosition(v)
        : v.city && currentTripIndex(selected.trip, v.stop) < 0
          ? timeTripPosition(selected.trip, v.delay, pragueNow().min)
          : null;
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
  if (route) drawRoute(map, route, v.type, vehicleColors(v));
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
  let trip = v.type === 'train' ? await fetchTrainTrip(v) : v.calls || isCoach(v.city) ? await fetchCoachTrip(v) : v.city ? await fetchCityTrip(v) : await fetchTrip(v);
  // DSZO: když stránka spoje neodpoví, spoj z jízdních řádů (data vyhledávání).
  if (!trip?.length && v.type !== 'train' && !v.city) trip = await fetchCityTrip(v).catch(() => []);
  if (!selected || selected.token !== token) return;
  selected.trip = trip;
  selected.tripId = v.tripId ?? null;
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
let coachTimer = null;

let lastUpdate = null;
function render() {
  const mine = journeyVehicleIds();
  const all = store.allVehicles();
  const shown = mine ? all.filter((v) => mine.has(v.id)) : all.filter((v) => matchesFilter(v, store.filter));
  const visible = selected && !shown.some((v) => v.id === selected.id) ? [...shown, ...all.filter((v) => v.id === selected.id)] : shown;
  vehicles.update(visible);
  updateJourneyBar();
  // Panel vybraného vozu jen když se jeho data změnila (živé polohy chodí po částech každé 3 s).
  const sel = selected && visible.find((v) => v.id === selected.id);
  if (!selected || sel !== selected.src) {
    if (selected) selected.src = sel;
    updateSelected();
  }
  drawRegion(map);
  if (lastUpdate) {
    const total = store.vehicles.length + store.cityBuses.length + store.jmk.length + store.coaches.length + store.estimated.length;
    const buses = shown.filter((v) => v.type !== 'train').length;
    const trains = shown.length - buses;
    const parts = [buses === total ? `${total} vozů` : `${buses} z ${total} vozů`];
    if (trains) parts.push(`${trains} ${trains === 1 ? 'vlak' : trains < 5 ? 'vlaky' : 'vlaků'}`);
    setStatus(`${parts.join(' · ')} · ${lastUpdate}`);
  }
}

// Písmena spojů DSZO (8d…) a čísla vlaků z mapy IDS JMK potřebují data vyhledávání:
// načteme je chvíli po startu, ať nebrzdí mapu.
let marksPlanner = null;
let rawTrains = [];
setTimeout(() => {
  loadPlanner()
    .then((P) => {
      marksPlanner = P;
      if (store.vehicles.length) store.setVehicles(withMarks(store.vehicles));
      if (rawTrains.length) setTrains(rawTrains);
    })
    .catch(() => {});
}, 0);

function withMarks(list) {
  if (!marksPlanner?.notes) return list;
  const { date, min } = pragueNow();
  return list.map((v) => {
    const m = vehicleMark(marksPlanner, v, date, min);
    return { ...v, mark: m?.mark ?? null, markNote: m?.note ?? null };
  });
}

async function refresh() {
  try {
    const list = await fetchVehicles();
    lastUpdate = new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
    store.setVehicles(withMarks(list.map((v) => snapVehicle(map, routes, v))));
  } catch (err) {
    console.error(err);
    setStatus(navigator.onLine ? 'Polohy vozů se nepodařilo načíst' : 'Bez připojení', true);
  }
}

function setTrains(list) {
  rawTrains = list;
  const { date, min } = pragueNow();
  store.setTrains(completeTrains(marksPlanner, list, date, min));
}

async function refreshTrains() {
  try {
    // Vlaky v celé oblasti.
    setTrains(await fetchRegionTrains(railArea(await loadRegion())));
  } catch (err) {
    // Vlaky jsou doplněk: bez nich mapa MHD funguje dál (např. starší proxy bez /trains).
    console.warn('Vlaky se nepodařilo načíst:', err.message);
    // Ještě žádné vlaky na mapě: zkusíme to brzy znovu, ne až s další obnovou.
    if (!store.trains.length && trainTimer) setTimeout(refreshTrains, 5000);
  }
}

async function refreshCities() {
  try {
    const list = await fetchCityVehicles({ P: jmkPlanner, region: jmkRegion, ...pragueNow() });
    // Spoje ODIS, IDSOK, IREDO a MHD Pardubice, které jedou živě, se neukážou ještě jednou odhadem podle jízdního řádu.
    const live = list.filter((v) => v.live === 'odis' || v.live === 'idsok' || v.live === 'iredo' || v.live === 'vdv' || v.live === 'pce');
    setLiveTrips(new Set(live.filter((v) => v.tripId != null).map((v) => v.tripId)));
    const count = (src) => list.filter((v) => v.live === src).length;
    const kraje = [];
    if (count('odis') > 20) kraje.push('msk');
    if (count('idsok') > 20) kraje.push('olk');
    if (count('iredo') > 20) kraje.push('pak');
    if (count('vdv') > 20) kraje.push('vys');
    setLiveKraje(kraje, count('pce') > 10 ? ['MHD Pardubice'] : []);
    store.setCityBuses(list);
  } catch (err) {
    // MHD dalších měst je doplněk (starší proxy bez /mhd): Zlín funguje dál.
    console.warn('MHD dalších měst se nepodařilo načíst:', err.message);
  }
}

// FlixBus: polohy ze sledování spojů. RegioJet: odhad podle jízdního řádu, přepočítáme s každou obnovou.
let flixBuses = [];
async function refreshCoaches() {
  try {
    // FlixBus a RegioJet mají vlastní polohy jen ve Zlínském kraji, jinde je odhad podle jízdního řádu (src/estimated.js).
    flixBuses = await fetchRegionCoaches(krajArea(await loadRegion(), 'zlk'));
  } catch (err) {
    // Dálkové autobusy jsou doplněk (starší proxy bez /flix).
    console.warn('Dálkové autobusy se nepodařilo načíst:', err.message);
  }
  await refreshRegioJet();
}

async function refreshRegioJet() {
  const [data, region] = await Promise.all([loadRegioJet(), loadRegion()]);
  const now = new Date();
  const { date, min } = pragueNow();
  store.setCoaches([...flixBuses, ...regioJetVehicles(data, krajArea(region, 'zlk'), date, min + now.getSeconds() / 60)]);
}

// Autobusy bez živé polohy: odhad podle jízdního řádu ze stejných dat jako vyhledávání spojení.
let busRoutesRequested = false;
async function refreshEstimated() {
  let P, region;
  try {
    [P, region] = await Promise.all([loadPlanner(), loadRegion()]);
  } catch {
    return; // bez jízdních řádů odhad nejde
  }
  if (!busRoutesRequested) {
    // Trasy po silnicích se stáhnou na pozadí; do té doby jedou odhadované vozy po přímce mezi zastávkami.
    busRoutesRequested = true;
    loadBusRoutes().then((routes) => {
      setBusRoutes(routes);
      if (hasBusRoutes()) refreshEstimated();
    });
  }
  const now = new Date();
  const { date, min } = pragueNow();
  jmkWasDown = jmk.down;
  setJmkDown(jmkWasDown);
  store.setEstimated(estimatedVehicles(P, region, date, min + now.getSeconds() / 60));
}

// Živé polohy IDS JMK (tramvaje, trolejbusy, autobusy): spoje se dohledají v datech vyhledávání spojení.
let jmkPlanner = null;
let jmkRegion = null;
let jmkWasDown = true;
const jmk = new JmkLive({
  onChange: (list) => {
    store.setJmk(list);
    // První živá dávka (nebo výpadek proudu): odhadované vozy IDS JMK hned vystřídají živé (nebo naopak).
    if (jmk.down !== jmkWasDown) refreshEstimated();
  },
  context: () => ({ P: jmkPlanner, region: jmkRegion, ...pragueNow() }),
  snapshot: fetchJmkSnapshot,
});
if (window.__map) window.__dbg = { store, jmk, select, selected: () => selected, planner: () => jmkPlanner };
setJmkSegments(segmentsOf);
setOdisSegments(segmentsOf);
// Data vyhledávání (spoje vozů IDS JMK a ODIS) hned po prvním vykreslení mapy, ne až po chvíli.
const afterPaint = new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
Promise.all([loadRegion().catch(() => null), afterPaint.then(loadPlanner).catch(() => null)]).then(([region, P]) => {
  jmkRegion = region;
  jmkPlanner = P;
  jmk.rebuild();
  if (P && timer) refreshCities();
});

store.subscribe(render);
// Kraj vozu (filtr Kraj) se pozná podle obrysů krajů v region.json.
loadRegion().then((r) => {
  setFilterRegion(r);
  render();
});

function start() {
  if (!proxyConfigured) {
    setStatus('Chybí proxy pro živá data', true);
    return;
  }
  if (timer) return;
  jmk.start();
  refresh();
  refreshTrains();
  refreshCities();
  refreshCoaches();
  refreshEstimated();
  timer = setInterval(() => {
    refresh();
    refreshCities();
    refreshRegioJet();
    refreshEstimated();
  }, REFRESH_MS);
  trainTimer = setInterval(refreshTrains, TRAIN_REFRESH_MS);
  coachTimer = setInterval(refreshCoaches, COACH_REFRESH_MS);
}

function stop() {
  jmk.stop();
  clearInterval(timer);
  clearInterval(trainTimer);
  clearInterval(coachTimer);
  timer = null;
  trainTimer = null;
  coachTimer = null;
}

// Když je aplikace na pozadí, data nestahujeme.
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));

// Vozy načítáme hned, nečekáme na mapu: když se nenačtou podklady mapy, polohy vozů se ukážou i tak.
const cached = store.cachedVehicles();
if (cached) store.setVehicles(cached);
start();
loadRoutes().then((data) => {
  routes = data.routes;
});
map.on('load', () => {
  // Vrstva tras linek zůstává (prázdná): podle ní se řadí vrstvy oblasti a tratí.
  drawLineRoutes(map, []);
  drawRegion(map);
});

initFilter();
initLegend();
initInfo();
initModals();
initInstall();

// Obnovit: stáhne novou verzi aplikace (i na ploše) a čerstvé jízdní řády, pak stránku načte znovu,
// takže se obnoví i polohy všech vozů.
document.getElementById('reload').addEventListener('click', async (e) => {
  e.currentTarget.classList.add('spinning');
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    const keys = (await globalThis.caches?.keys()) ?? [];
    await Promise.all(keys.filter((k) => !k.includes('tiles')).map((k) => caches.delete(k)));
    // Stránku stáhneme znovu mimo mezipaměť prohlížeče (GitHub Pages ji jinak 10 minut drží),
    // aby se po obnovení načetly nové skripty.
    await Promise.all(['./', './index.html'].map((u) => fetch(u, { cache: 'reload' }).catch(() => null)));
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
