// Parser veřejných dat DSZO z https://www.dszo.cz/online/
//
// DSZO nemá JSON API s polohami. Stránka /online/ vypisuje každé vozidlo přímo jako
// JavaScript pro OpenLayers, například:
//   var vuz417 = new ol.Feature({geometry: new ol.geom.Point(ol.proj.fromLonLat([17.66,49.22])),
//     name: '417', line: '2', delay: '41', lowlevel: '1', station: '5601',
//     infow: '<div class="infowindow">… Aktualizace: 2026-10-11 12:01:12<br /><img src="img/ico-ac.png">…</div>'});
//   var style417 = new ol.style.Style({ image: new ol.style.Icon({ ..., rotation: 228 * Math.PI/180, ...
// Směr jízdy (konečná) a název zastávky jsou jen v tabulce /online/tabs2.php (JSON):
//   {"data": [["417","2","00:15","Náměstí Míru","Otrokovice,žel.st.","4/2","2506"], ...]}
// Jízdní řád konkrétního spoje vrací /online/spoj.php?vuz=…&zast=…&zpozdeni=…&nizkopodlazni=…

const FEATURE_RE = /var\s+vuz(\w+)\s*=\s*new\s+ol\.Feature\(/g;
const COORDS_RE = /fromLonLat\(\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]\)/;

// Výbava vozu podle ikon v infookně DSZO.
export const FEATURES = {
  wifi: 'Wi-Fi',
  ac: 'Klimatizace',
  lowlevel: 'Bezbariérový',
  lcd: 'Informační LCD',
  blind: 'Pro nevidomé',
  camera: 'Kamera',
  usb: 'USB nabíjení',
};

function field(chunk, name) {
  const m = chunk.match(new RegExp(`\\b${name}\\s*:\\s*'([^']*)'`));
  return m ? m[1] : null;
}

function rotationOf(html, id) {
  const re = new RegExp(`var\\s+style${id}\\s*=\\s*new\\s+ol\\.style\\.Style\\([\\s\\S]{0,600}?rotation\\s*:\\s*(-?[\\d.]+)`);
  const m = html.match(re);
  return m ? ((Number(m[1]) % 360) + 360) % 360 : null;
}

function featuresOf(infow, lowFloor) {
  const found = new Set();
  for (const m of infow.matchAll(/ico-([a-z]+)\.(?:png|svg|gif)/gi)) found.add(m[1].toLowerCase());
  if (/wi-?fi/i.test(infow)) found.add('wifi');
  if (lowFloor) found.add('lowlevel');
  return Object.keys(FEATURES).filter((k) => found.has(k));
}

/**
 * Trolejbus nebo autobus. DSZO to v datech neuvádí, rozlišujeme podle evidenčního čísla:
 * trolejbusy mají čísla 2xx a 4xx, autobusy 6xx, 7xx a 9xx.
 */
export function vehicleType(id) {
  const n = parseInt(id, 10);
  return n >= 200 && n < 500 ? 'trolleybus' : 'bus';
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
    const chunk = html.slice(m.index, Math.min(end, m.index + 6000));
    const coords = chunk.match(COORDS_RE);
    const line = field(chunk, 'line');
    if (!coords || !line) return;

    const lon = Number(coords[1]);
    const lat = Number(coords[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return;

    const id = field(chunk, 'name') || m[1];
    const delay = Number(field(chunk, 'delay'));
    const lowFloor = field(chunk, 'lowlevel') === '1';
    const infow = field(chunk, 'infow') || '';
    const updated = infow.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);

    vehicles.push({
      id,
      line,
      type: vehicleType(id),
      lat,
      lon,
      bearing: rotationOf(html, m[1]),
      delay: Number.isFinite(delay) ? delay : null,
      lowFloor,
      stationId: field(chunk, 'station'),
      features: featuresOf(infow, lowFloor),
      updated: updated ? updated[1] : null,
    });
  });

  return vehicles;
}

/** Tabulka /online/tabs2.php -> Map(číslo vozu -> { stop, headsign, duty }). */
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
    const [vehicle, , , stop, headsign, duty] = row.map((v) => String(v ?? '').trim());
    if (vehicle) result.set(vehicle, { stop: stop || null, headsign: headsign || null, duty: duty || null });
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
      duty: extra.duty ?? null,
      delayText: v.delay != null ? formatDelay(v.delay) : null,
    };
  });
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/**
 * Jízdní řád spoje z /online/spoj.php -> [{ time: '11:48', name: 'Bartošova Čtvrť A' }].
 * Formát je HTML fragment, proto ho bereme po řádcích textu „čas název“.
 */
export function parseTrip(html) {
  const text = decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(tr|div|li|p|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
  const stops = [];
  for (const raw of text.split('\n')) {
    const m = raw.replace(/\s+/g, ' ').trim().match(/^(\d{1,2}:\d{2})\s+(.+)$/);
    if (m) stops.push({ time: m[1], name: m[2].trim() });
  }
  return stops;
}
