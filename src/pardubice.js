// Živé polohy MHD Pardubice (Dopravní podnik města Pardubic): mapa online.dpmp.cz (api.mhdonline.cz) přes
// proxy /mhd (pole pce). Vůz posílá linku, cíl, poslední a příští zastávku, zpoždění a klimatizaci;
// spoj (zastávky, časy, trolejbus nebo autobus) se dohledá v datech vyhledávání (celostátní jízdní řády)
// podle licence linky (655 + číslo linky) a čísla spoje, jinak podle příští zastávky a cíle.
import { formatDelay } from './dszo.js';
import { cityStopName } from './cities.js';
import { matchOdisTrip, matchOdisByStop, attachTrip } from './odis.js';

const LICENCE = '655';
const TYPES = { r: 'tram', t: 'trolleybus' };

/** Zpoždění ve tvaru ISO 8601 („PT4M53S“, „-PT1M11S“) → sekundy. */
export function isoDelay(text) {
  const m = /^(-)?PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(text ?? ''));
  if (!m) return null;
  const s = Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
  return Math.round(m[1] ? -s : s);
}

/** Vůz z mapy MHD Pardubice → vůz pro mapu, nebo null (bez polohy nebo linky). */
export function parsePce(b, { P = null, date, min } = {}) {
  const lat = Number(b?.gpsLat);
  const lon = Number(b?.gpsLon);
  const line = String(b?.lineId ?? '').trim();
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !lat || !line) return null;
  const licence = /^\d{1,3}$/.test(line) ? `${LICENCE}${line.padStart(3, '0')}` : null;
  const delay = b.currentDelay != null ? isoDelay(b.currentDelay) : null;
  const delayMin = Math.round((delay ?? 0) / 60);
  const tripNo = b.connectionId != null ? String(b.connectionId) : null;
  const next = b.nextStopName || null;
  const match =
    P && date
      ? (matchOdisTrip(P, licence, tripNo, date, min, delayMin) ?? matchOdisByStop(P, line, next, b.destinationName, date, min, delayMin))
      : null;
  const pat = match?.trip.pattern;
  const city = pat?.c ?? 'town';
  const ac = typeof b.airConditioning === 'boolean' ? b.airConditioning : null;
  const v = {
    id: `pce-${b.vid ?? `${line}-${tripNo}`}`,
    type: TYPES[pat?.y] ?? 'bus',
    city,
    line,
    lineRef: pat?.r ?? licence,
    licence,
    lat,
    lon,
    bearing: null,
    stop: b.lastStopName ? cityStopName(city, b.lastStopName) : null,
    next: next ? cityStopName(city, next) : null,
    from: null,
    headsign: b.destinationName ? cityStopName(city, b.destinationName) : null,
    rawStop: b.lastStopName || null,
    rawHeadsign: b.destinationName || null,
    tripNo,
    operatorName: pat?.o ?? 'MHD Pardubice',
    lowFloor: null,
    aircon: ac,
    features: ac ? ['ac'] : [],
    plate: b.vid ? `ev. č. ${b.vid}` : null,
    delay,
    delayText: formatDelay(delay),
    updated: null,
    live: 'pce',
  };
  if (match) attachTrip(v, P, match, { next, standing: !!b.onStation, min });
  return v;
}
