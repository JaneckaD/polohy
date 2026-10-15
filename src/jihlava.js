// Živé polohy MHD Jihlava (Dopravní podnik města Jihlavy): online mapa města (gis.jihlava-city.cz, vrstva ArcGIS)
// přes proxy /mhd (pole jih). Vůz posílá linku (trolejbusy písmenem), číslo linky v systému dopravce, cíl,
// poslední projetou zastávku, zpoždění v minutách a azimut; spoj (zastávky, časy) se dohledá v datech
// vyhledávání (celostátní jízdní řády) podle licence linky (765 + číslo linky bez první stovky), poslední
// projeté zastávky a cíle.
import { formatDelay } from './dszo.js';
import { cityStopName, setLineName, lineNames } from './cities.js';
import { matchByLastStop, attachTrip } from './odis.js';

const LICENCE = '765';
const STORE = 'mhd.lineNames';

// Písmena trolejbusových linek, která už aplikace viděla, zůstanou i pro odhady podle jízdního řádu.
try {
  for (const [ref, name] of Object.entries(JSON.parse(localStorage.getItem(STORE) ?? '{}'))) setLineName(ref, name);
} catch {}
let saved = '';
function remember(ref, name) {
  setLineName(ref, name);
  try {
    const now = JSON.stringify(lineNames());
    if (now !== saved) localStorage.setItem(STORE, (saved = now));
  } catch {}
}

/** Licence linky MHD Jihlava z čísla linky dopravce: 104 → 765004 (linka 4), 209 → 765109 (trolejbus G). */
export function jihLicence(lineid) {
  const n = Number(lineid);
  return Number.isInteger(n) && n >= 100 && n < 1100 ? `${LICENCE}${String(n - 100).padStart(3, '0')}` : null;
}

/** Vůz z mapy MHD Jihlava → vůz pro mapu, nebo null (bez polohy nebo linky). */
export function parseJih(a, { P = null, date, min } = {}) {
  const lat = Number(a?.latitude);
  const lon = Number(a?.longitude);
  const line = String(a?.linka ?? '').trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !lat || !line) return null;
  const licence = jihLicence(a.lineid);
  if (licence && !/^\d+$/.test(line)) remember(licence, line);
  const delayMin = Number(a.delayinmins);
  const delay = Number.isFinite(delayMin) && Math.abs(delayMin) < 600 ? delayMin * 60 : null;
  const last = a.posledni ? `Jihlava,${a.posledni}` : null;
  const dest = a.konecna ? `Jihlava,${a.konecna}` : null;
  const match = P && date ? matchByLastStop(P, licence, last, dest, date, min, Math.round((delay ?? 0) / 60)) : null;
  const pat = match?.trip.pattern;
  const city = pat?.c ?? 'town';
  const trolley = /trol/i.test(a.typ ?? '') || pat?.y === 't';
  const bearing = Number(a.azimut);
  const v = {
    id: `jih-${a.carnum ?? a.objectid}`,
    type: trolley ? 'trolleybus' : 'bus',
    city,
    line,
    lineRef: pat?.r ?? licence,
    licence,
    lat,
    lon,
    bearing: Number.isFinite(bearing) && (bearing || Number(a.speed) > 0) ? bearing : null,
    stop: a.posledni ? cityStopName(city, a.posledni) : null,
    next: null,
    from: null,
    headsign: a.konecna ? cityStopName(city, a.konecna) : null,
    rawStop: a.posledni || null,
    rawHeadsign: a.konecna || null,
    tripNo: null,
    operatorName: pat?.o ?? 'MHD Jihlava',
    lowFloor: null,
    features: [],
    plate: a.carnum != null ? `ev. č. ${a.carnum}` : null,
    delay,
    delayText: formatDelay(delay),
    updated: null,
    live: 'jih',
  };
  if (match) attachTrip(v, P, match, { next: P.stops[pat.s[match.last + 1]]?.name ?? null, min });
  return v;
}
