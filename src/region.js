// Oblast aplikace (Zlínský a Jihomoravský kraj) a železniční tratě.
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

function ringContains(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Leží bod [lon, lat] uvnitř oblasti? */
export function regionContains(region, lon, lat) {
  const ring = region?.geometry?.coordinates?.[0];
  return ring ? ringContains(ring, lon, lat) : true;
}

/** Kraj oblasti, ve kterém bod leží ('zlk', 'jmk'), nebo null. */
export function krajOf(region, lon, lat) {
  const parts = region?.properties?.parts ?? {};
  for (const [key, ring] of Object.entries(parts)) if (ringContains(ring, lon, lat)) return key;
  return null;
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
  const g = c.getContext('2d');
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
  if (!map.isStyleLoaded()) {
    // Styl ještě není (nebo se nenačetly dlaždice a 'load' nepřijde): zkusíme to za chvíli znovu.
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
