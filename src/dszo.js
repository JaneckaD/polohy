// Parser veřejných dat DSZO z https://www.dszo.cz/online/
//
// DSZO nemá JSON API s polohami. Stránka /online/ vypisuje každé vozidlo přímo jako
// JavaScript pro OpenLayers, například:
//   var vuz417 = new ol.Feature({geometry: new ol.geom.Point(ol.proj.fromLonLat([17.66,49.22])),
//     name: '417', line: '2', delay: '41', lowlevel: '1', station: '5601', infow: '...'});
//   var style417 = new ol.style.Style({ image: new ol.style.Icon({ ..., rotation: 228 * Math.PI/180, ...
// Směr jízdy (konečná) a název zastávky jsou jen v tabulce /online/tabs2.php (JSON):
//   {"data": [["417","2","00:15","Náměstí Míru","Otrokovice,žel.st.","4/2","2506"], ...]}

const FEATURE_RE = /var\s+vuz(\w+)\s*=\s*new\s+ol\.Feature\(/g;
const COORDS_RE = /fromLonLat\(\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]\)/;

function field(chunk, name) {
  const m = chunk.match(new RegExp(`\\b${name}\\s*:\\s*'([^']*)'`));
  return m ? m[1] : null;
}

function rotationOf(html, id) {
  const re = new RegExp(`var\\s+style${id}\\s*=\\s*new\\s+ol\\.style\\.Style\\([\\s\\S]{0,600}?rotation\\s*:\\s*(-?[\\d.]+)`);
  const m = html.match(re);
  return m ? ((Number(m[1]) % 360) + 360) % 360 : null;
}

export function formatDelay(seconds) {
  if (!Number.isFinite(seconds)) return null;
  const sign = seconds < 0 ? '-' : '';
  const s = Math.abs(Math.round(seconds));
  return `${sign}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Vytáhne vozidla z HTML stránky /online/. */
export function parseVehiclesPage(html) {
  const starts = [...html.matchAll(FEATURE_RE)];
  const vehicles = [];

  starts.forEach((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : html.length;
    const chunk = html.slice(m.index, Math.min(end, m.index + 4000));
    const coords = chunk.match(COORDS_RE);
    const line = field(chunk, 'line');
    if (!coords || !line) return;

    const lon = Number(coords[1]);
    const lat = Number(coords[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return;

    const delay = Number(field(chunk, 'delay'));
    vehicles.push({
      id: field(chunk, 'name') || m[1],
      line,
      lat,
      lon,
      bearing: rotationOf(html, m[1]),
      delay: Number.isFinite(delay) ? delay : null,
      lowFloor: field(chunk, 'lowlevel') === '1',
      stationId: field(chunk, 'station'),
    });
  });

  return vehicles;
}

/** Tabulka /online/tabs2.php -> Map(číslo vozu -> { stop, headsign }). */
export function parseTable(text) {
  const result = new Map();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return result;
  }
  for (const row of json?.data ?? []) {
    if (!Array.isArray(row)) continue;
    const [vehicle, , , stop, headsign] = row.map((v) => String(v ?? '').trim());
    if (vehicle) result.set(vehicle, { stop: stop || null, headsign: headsign || null });
  }
  return result;
}

/** Spojí polohy se směrem jízdy podle čísla vozu. */
export function mergeVehicles(vehicles, table) {
  return vehicles.map((v) => {
    const extra = table.get(v.id) ?? {};
    return {
      ...v,
      stop: extra.stop ?? null,
      headsign: extra.headsign ?? null,
      delayText: v.delay != null ? `zpoždění ${formatDelay(v.delay)}` : null,
    };
  });
}
