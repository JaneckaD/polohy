import { parseVehiclesPage, parseTable, mergeVehicles, parseTrip } from './dszo.js';
import { fetchTrains } from './trains.js';
import { fetchCityBuses } from './cities.js';
import { fetchCoaches, fetchCoachSegments } from './coaches.js';

// DSZO obnovuje data zhruba každých 15 s.
export const REFRESH_MS = 15000;

// DSZO neposílá CORS hlavičky, takže stránka na github.io si data sama nepřečte.
// Při vývoji jde přes proxy dev serveru Vite (/dszo), na webu přes vlastní proxy
// (Cloudflare Worker v proxy/worker.js), jejíž adresu dává proměnná VITE_DSZO_PROXY.
const PROXY = (import.meta.env.VITE_DSZO_PROXY || (import.meta.env.DEV ? '/dszo' : '')).replace(/\/$/, '');

export const proxyConfigured = Boolean(PROXY);

async function getText(path) {
  const res = await fetch(`${PROXY}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

export async function fetchVehicles() {
  if (!PROXY) throw new Error('Není nastavená proxy pro živá data (VITE_DSZO_PROXY).');
  const [page, table] = await Promise.all([
    getText('/online/'),
    // Tabulka se směrem jízdy je jen doplněk, bez ní mapa funguje dál.
    getText('/online/tabs2.php').catch(() => ''),
  ]);
  return mergeVehicles(parseVehiclesPage(page), parseTable(table));
}

/** Jízdní řád spoje, ve kterém vůz právě jede. Při chybě vrací prázdný seznam. */
export async function fetchTrip(v) {
  if (!PROXY) return [];
  const params = new URLSearchParams({
    vuz: v.id,
    zast: v.stationId ?? '',
    zpozdeni: String(v.delay ?? 0),
    nizkopodlazni: v.lowFloor ? '1' : '0',
  });
  try {
    return parseTrip(await getText(`/online/spoj.php?${params}`));
  } catch {
    return [];
  }
}

/** Vozy MHD Kroměříže a Valašského Meziříčí (mapa IDZK přes proxy). */
export function fetchCityVehicles() {
  if (!PROXY) return Promise.resolve([]);
  return fetchCityBuses(PROXY);
}

/** Dálkové autobusy (FlixBus) uvnitř kraje. */
export function fetchRegionCoaches(region) {
  if (!PROXY) return Promise.resolve([]);
  return fetchCoaches(PROXY, region);
}

/** Trasa dálkového autobusu po silnicích po úsecích mezi zastávkami (null, když není). */
export function fetchCoachRoute(v) {
  if (!PROXY) return Promise.resolve(null);
  return fetchCoachSegments(PROXY, v);
}

/** Vlaky uvnitř kraje (region = hranice kraje z region.json). */
export function fetchRegionTrains(region) {
  if (!PROXY) return Promise.resolve([]);
  return fetchTrains(PROXY, region);
}
