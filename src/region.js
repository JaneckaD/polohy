// Oblast aplikace (Zlínský, Jihomoravský, Olomoucký, Moravskoslezský, Pardubický kraj a Vysočina) a železniční tratě.
// Vlaky a koleje jsou v celé oblasti (dřív jen ve Zlínském a Jihomoravském kraji: properties.rail, když ho region.json má).
// Vše mimo oblast je šrafované, tam aplikace zatím nesahá.
// Obrys oblasti: sjednocené hranice obou krajů z dat ČÚZK (github.com/siwekm/czech-geojson), viz public/region.json
// (properties.parts = obrysy jednotlivých krajů, podle nich filtr pozná kraj vozu);
// hranice všech krajů (jen čáry, lehce) ze stejných dat v public/kraje.json.

const empty = { type: 'FeatureCollection', features: [] };
const fetchJson = (url) =>
  fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

let regionPromise = null;

/** Hranice oblasti (GeoJSON Feature), načtená jednou. */
export function loadRegion() {
  regionPromise ??= fetchJson('./region.json');
  return regionPromise;
}

// Obrys kraje má tisíce vrcholů. Hrany si rozdělíme do vodorovných pásů podle zeměpisné šířky:
// test bodu pak prochází jen hrany ve svém pásu (výsledek je stejný jako přes celý obrys).
const BANDS = 512;
const ringIndexes = new WeakMap();
function ringIndex(ring) {
  let idx = ringIndexes.get(ring);
  if (!idx) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const h = (maxY - minY) / BANDS || 1;
    const bands = Array.from({ length: BANDS }, () => []);
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const a = Math.max(0, Math.min(BANDS - 1, Math.floor((Math.min(yi, yj) - minY) / h)));
      const b = Math.max(0, Math.min(BANDS - 1, Math.floor((Math.max(yi, yj) - minY) / h)));
      for (let k = a; k <= b; k++) bands[k].push(xi, yi, xj, yj);
    }
    idx = { box: [minX, minY, maxX, maxY], h, bands };
    ringIndexes.set(ring, idx);
  }
  return idx;
}

function ringContains(ring, lon, lat) {
  const { box, h, bands } = ringIndex(ring);
  if (lon < box[0] || lat < box[1] || lon > box[2] || lat > box[3]) return false;
  const e = bands[Math.max(0, Math.min(BANDS - 1, Math.floor((lat - box[1]) / h)))];
  let inside = false;
  for (let k = 0; k < e.length; k += 4) {
    const xi = e[k], yi = e[k + 1], xj = e[k + 2], yj = e[k + 3];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Leží bod [lon, lat] uvnitř oblasti? */
export function regionContains(region, lon, lat) {
  const ring = region?.geometry?.coordinates?.[0];
  return ring ? ringContains(ring, lon, lat) : true;
}

/** Oblast vlaků a kolejí (celá oblast, nebo properties.rail) jako GeoJSON Feature. */
export function railArea(region) {
  const ring = region?.properties?.rail;
  return ring ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } } : region;
}

/** Obrys jednoho kraje oblasti ('zlk', …) jako GeoJSON Feature. */
export function krajArea(region, key) {
  const ring = region?.properties?.parts?.[key];
  return ring ? { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } } : region;
}

/** Kraj oblasti, ve kterém bod leží ('zlk', 'jmk', 'olk', 'msk'), nebo null. */
// Vozy, které stojí nebo se vrátí na stejné místo, se ptají na kraj znovu: odpovědi pro přesné polohy si pamatujeme.
const krajCache = new Map();
export function krajOf(region, lon, lat) {
  const parts = region?.properties?.parts ?? {};
  const key = `${lon},${lat}`;
  const hit = krajCache.get(key);
  if (hit && hit.parts === parts) return hit.kraj;
  let kraj = null;
  for (const [k, ring] of Object.entries(parts)) {
    if (ringContains(ring, lon, lat)) {
      kraj = k;
      break;
    }
  }
  if (krajCache.size > 50000) krajCache.clear();
  krajCache.set(key, { parts, kraj });
  return kraj;
}
/**
 * Jde do mapy přidávat zdroje a vrstvy? map.isStyleLoaded() čeká i na všechny dlaždice, a na velké
 * obrazovce (počítač) se dlaždice načítají skoro pořád, takže by se koleje a trasy nenakreslily.
 */
export function styleReady(map) {
  return Boolean(map.style?._loaded ?? map.isStyleLoaded());
}

let railsPromise = null;

/** Tratě s osobní dopravou (rails.json), načtené jednou. */
export function loadRails() {
  railsPromise ??= fetchJson('./rails.json');
  return railsPromise;
}

// Plocha s otvorem: obrys kraje musí být opačně orientovaný než vnější obdélník.
const signedArea = (ring) => ring.reduce((a, [x, y], i) => {
  const [nx, ny] = ring[(i + 1) % ring.length];
  return a + (x * ny - nx * y);
}, 0);

function maskFeature(region) {
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  let hole = region.geometry.coordinates[0];
  if (Math.sign(signedArea(hole)) === Math.sign(signedArea(world))) hole = hole.slice().reverse();
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [world, hole] } };
}

function hatchImage() {
  const size = 16;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  // Obrázek se hned čte zpátky: kreslení bez grafické karty je tu rychlejší.
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = 'rgba(232, 232, 236, 0.72)';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = 'rgba(120, 120, 128, 0.32)';
  g.lineWidth = 1.5;
  g.beginPath();
  // Šikmé čáry přes okraje, aby navazovaly.
  for (const o of [-size, 0, size]) {
    g.moveTo(o, size);
    g.lineTo(o + size, 0);
  }
  g.stroke();
  return g.getImageData(0, 0, size, size);
}

// Vrstvy oblasti a tratí jdou nad podklad mapy, ale pod trasy linek a spojení.
const beforeId = (map) => ['filter-routes', 'route-casing', 'journey-casing'].find((id) => map.getLayer(id));

let retry = null;

export function drawRegion(map) {
  if (map.getSource('rails')) return;
  if (!styleReady(map)) {
    // Styl mapy ještě není načtený: zkusíme to za chvíli znovu.
    retry ??= setTimeout(() => {
      retry = null;
      drawRegion(map);
    }, 500);
    return;
  }
  map.addSource('rails', { type: 'geojson', data: empty });
  map.addSource('region-mask', { type: 'geojson', data: empty });
  map.addSource('kraje', { type: 'geojson', data: new URL('./kraje.json', location.href).href });
  let hatch = map.hasImage('hatch');
  try {
    if (!hatch) map.addImage('hatch', hatchImage(), { pixelRatio: 2 });
    hatch = true;
  } catch {
    // Bez šrafy aspoň šedá plocha; koleje se nakreslí tak jako tak.
  }
  const before = beforeId(map);
  // Koleje: tmavá čára s bílými čárkami za sebou, ať jsou vidět i z dálky.
  map.addLayer(
    {
      id: 'rails-casing',
      type: 'line',
      source: 'rails',
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': '#48484f',
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 3, 11, 4.5, 16, 8],
      },
    },
    before,
  );
  map.addLayer(
    {
      id: 'rails-dash',
      type: 'line',
      source: 'rails',
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.2, 11, 2.2, 16, 4.5],
        'line-dasharray': [3, 3],
      },
    },
    before,
  );
  map.addLayer(
    { id: 'region-mask', type: 'fill', source: 'region-mask', paint: hatch ? { 'fill-pattern': 'hatch' } : { 'fill-color': '#e8e8ec', 'fill-opacity': 0.7 } },
    before,
  );
  // Hranice všech krajů: jen lehce, ať je poznat, kde kraj končí.
  map.addLayer(
    {
      id: 'kraje-border',
      type: 'line',
      source: 'kraje',
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': '#6e6e73',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 12, 1.6],
        'line-opacity': 0.6,
        'line-dasharray': [3, 2],
      },
    },
    before,
  );
  map.addLayer(
    {
      id: 'region-border',
      type: 'line',
      source: 'region-mask',
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': '#8e8e93',
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1, 12, 2],
        'line-opacity': 0.7,
      },
    },
    before,
  );

  loadRails();
  loadRegion().then((region) => {
    if (region?.geometry) map.getSource('region-mask')?.setData(maskFeature(region));
  });
  railsPromise.then((rails) => {
    if (!rails?.lines?.length) return;
    map.getSource('rails')?.setData({
      type: 'FeatureCollection',
      features: rails.lines.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })),
    });
  });
}
