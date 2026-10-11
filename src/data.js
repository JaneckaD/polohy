import { parseVehiclesPage, parseTable, mergeVehicles } from './dszo.js';

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
  if (!PROXY) throw new Error('Není nastavená proxy pro data DSZO (VITE_DSZO_PROXY).');
  const [page, table] = await Promise.all([
    getText('/online/'),
    // Tabulka se směrem jízdy je jen doplněk, bez ní mapa funguje dál.
    getText('/online/tabs2.php').catch(() => ''),
  ]);
  return mergeVehicles(parseVehiclesPage(page), parseTable(table));
}
