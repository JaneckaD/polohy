// Živé polohy Olomouckého kraje (IDSOK): mapa spojů CestujOK (cestujok.cz/idspublic) přes proxy /idsok.
// Mapa posílá spoj (linku a číslo spoje, výchozí a cílovou zastávku s časy, zpoždění, dopravce) a polohu;
// spoj se dohledá v datech vyhledávání (celostátní jízdní řády) podle licence a čísla spoje, jinak podle
// licence a odjezdu z výchozí zastávky.
import { formatDelay } from './dszo.js';
import { cityStopName, lineLabel, carrierName } from './cities.js';
import { matchOdisTrip, matchByDeparture, matchByEnds, attachTrip } from './odis.js';
import { krajOf } from './region.js';

const TRAIN = /^(?:Os|Sp|R|Rx|Ex|EC|EN|IC|ICE|RJ|LE|AEx|SC|TL|Mv|Sv)\s*\d/;
const hm = (s) => {
  const m = /(\d{1,2}):(\d{2})/.exec(String(s ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const text = (x) => (x == null ? '' : String(x).trim());

// Slovo na začátku názvu spoje, které jen říká druh vozu („Bus 12“, „Tram 2“, „Trol 25“).
const KIND_WORD = /^(?:bus|autobus|tram|tramvaj|trol|trolejbus|mhd|linka)\b\.?\s*/i;

/** Licence linky a číslo spoje z názvu spoje („895002 / 12“, „Bus 780402, spoj 5“, „Tram 2“, „12 (895012)“). */
export function idsokNumbers(name) {
  const s = text(name).replace(KIND_WORD, '');
  const licence = /(?<!\d)(\d{6})(?!\d)/.exec(s)?.[1] ?? null;
  const rest = licence ? s.replace(licence, ' ') : s;
  const trip = /(?:\/|spoj|#)\s*(\d{1,5})(?!\d)/i.exec(rest)?.[1] ?? null;
  const line = licence ? lineLabel(licence) : (/(?<![\d:\w])(\d{1,3}|[A-Z]{1,2}\d{1,3}|[A-Z])(?![\d:\w])/.exec(rest.replace(/(?:\/|spoj|#)\s*\d+/gi, ' '))?.[1] ?? null);
  return { licence, trip, line };
}

// Druh vozu: mapa posílá kód (A autobus, E tramvaj, T trolejbus, V vlak) nebo slovo.
const vtype = (s) => text(s.vehicleType).toUpperCase();
const isTrain = (s) => vtype(s) === 'V' || /VLAK|TRAIN|RAIL/.test(vtype(s)) || TRAIN.test(text(s.name));
const isTram = (s) => vtype(s) === 'E' || /TRAM/.test(vtype(s)) || /^tram/i.test(text(s.name));
const isTrolley = (s) => vtype(s) === 'T' || /TROL/.test(vtype(s)) || /^trol/i.test(text(s.name));

/** Spoj z mapy IDSOK → vůz pro mapu (stejný tvar jako vozy ODIS), nebo null (vlak, spoj mimo kraj, bez polohy). */
export function parseIdsok(s, { P = null, region = null, date, min } = {}) {
  const lat = Number(s?.lat);
  const lon = Number(s?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !lat || isTrain(s)) return null;
  // Spoje do sousedních krajů ukazují jejich vlastní mapy (IDZK, ODIS, IDS JMK).
  if (region && krajOf(region, lon, lat) !== 'olk') return null;
  // Mapa posílá licenci linky (lineNumber) a číslo spoje (serviceNumber); z názvu jen když chybí.
  const parsed = idsokNumbers(s.name);
  const licence = /^\d{6}$/.test(text(s.lineNumber)) ? text(s.lineNumber) : parsed.licence;
  const trip = Number.isFinite(Number(s.serviceNumber)) && text(s.serviceNumber) ? String(Number(s.serviceNumber)) : parsed.trip;
  const line = licence ? lineLabel(licence) : parsed.line;
  const delayMin = Number(s.delay);
  const delay = Number.isFinite(delayMin) && delayMin > -60 ? delayMin * 60 : null;
  // Spoj v jízdních řádech: podle licence a čísla spoje, podle licence a odjezdu, jinak podle výchozí
  // a cílové zastávky s časy (ty mapa posílá vždy, i když z názvu linku nepoznáme).
  const match =
    P && date
      ? (matchOdisTrip(P, licence, trip, date, min, Math.round((delay ?? 0) / 60)) ??
        matchByDeparture(P, licence, text(s.dep), hm(s.depTime), date, min) ??
        matchByEnds(P, { dep: text(s.dep), depMin: hm(s.depTime), dest: text(s.dest), destMin: hm(s.destTime), line, tram: isTram(s) }, date, min))
      : null;
  const pat = match?.trip.pattern;
  // lineType A = městská linka (MHD), V/Z/D = regionální, mezikrajská, dálková.
  const town = text(s.lineType).toUpperCase() === 'A' || isTram(s) || isTrolley(s) || /^(?:895|785|925|926|936|93523)/.test(licence ?? '');
  const city = pat?.c ?? (town ? 'town' : 'other');
  const type = pat ? (pat.y === 'r' ? 'tram' : pat.y === 't' ? 'trolleybus' : 'bus') : isTram(s) ? 'tram' : isTrolley(s) ? 'trolleybus' : 'bus';
  const label = pat ? lineLabel(pat.r) : (line ?? (licence ? lineLabel(licence) : null));
  if (!label) return null;
  const v = {
    id: `idsok-${s.id ?? `${licence}-${trip}`}`,
    type,
    city,
    line: label,
    lineRef: pat?.r ?? licence ?? null,
    licence,
    lat,
    lon,
    bearing: Number.isFinite(Number(s.angle)) && s.angle !== '' && s.angle != null ? Number(s.angle) : null,
    stop: null,
    next: null,
    from: s.dep ? cityStopName(city, text(s.dep)) : null,
    headsign: s.dest ? cityStopName(city, text(s.dest)) : null,
    rawStop: null,
    rawHeadsign: text(s.dest) || null,
    tripNo: trip,
    operatorName: pat?.o ?? (carrierName(text(s.operator)) || null),
    lowFloor: null,
    features: [],
    plate: null,
    delay,
    delayText: formatDelay(delay),
    updated: null,
    live: 'idsok',
  };
  if (match) attachTrip(v, P, match, { min });
  return v;
}
