// Živé polohy Olomouckého kraje (IDSOK): mapa spojů CestujOK (cestujok.cz/idspublic) přes proxy /idsok.
// Mapa posílá spoj (linku a číslo spoje, výchozí a cílovou zastávku s časy, zpoždění, dopravce) a polohu;
// spoj se dohledá v datech vyhledávání (celostátní jízdní řády) podle licence a čísla spoje, jinak podle
// licence a odjezdu z výchozí zastávky.
import { formatDelay } from './dszo.js';
import { cityStopName, lineLabel, carrierName } from './cities.js';
import { matchOdisTrip, matchByDeparture, attachTrip } from './odis.js';
import { krajOf } from './region.js';

const TRAIN = /^(?:Os|Sp|R|Rx|Ex|EC|EN|IC|ICE|RJ|LE|AEx|SC|TL|Mv|Sv)\s*\d/;
const hm = (s) => {
  const m = /(\d{1,2}):(\d{2})/.exec(String(s ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
const text = (x) => (x == null ? '' : String(x).trim());

/** Licence linky a číslo spoje z názvu spoje („895002 / 12“, „Bus 780402, spoj 5“, „12 (895012)“). */
export function idsokNumbers(name) {
  const s = text(name);
  const licence = /(?<!\d)(\d{6})(?!\d)/.exec(s)?.[1] ?? null;
  const rest = licence ? s.replace(licence, ' ') : s;
  const trip = /(?:\/|spoj|#)\s*(\d{1,5})(?!\d)/i.exec(rest)?.[1] ?? null;
  const line = licence ? lineLabel(licence) : (/(?<![\d:])(\d{1,3}|[A-Z]\d{0,2})(?![\d:])/.exec(rest)?.[1] ?? null);
  return { licence, trip, line };
}

const isTrain = (s) => /vlak|train|rail/i.test(text(s.vehicleType)) || TRAIN.test(text(s.name));
const isTram = (s) => /tram/i.test(text(s.vehicleType));

/** Spoj z mapy IDSOK → vůz pro mapu (stejný tvar jako vozy ODIS), nebo null (vlak, spoj mimo kraj, bez polohy). */
export function parseIdsok(s, { P = null, region = null, date, min } = {}) {
  const lat = Number(s?.lat);
  const lon = Number(s?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !lat || isTrain(s)) return null;
  // Spoje do sousedních krajů ukazují jejich vlastní mapy (IDZK, ODIS, IDS JMK).
  if (region && krajOf(region, lon, lat) !== 'olk') return null;
  const { licence, trip, line } = idsokNumbers(s.name);
  if (!line && !licence) return null;
  const delayMin = Number(s.delay);
  const delay = Number.isFinite(delayMin) && delayMin > -60 ? delayMin * 60 : null;
  const match = P && date ? (matchOdisTrip(P, licence, trip, date, min, Math.round((delay ?? 0) / 60)) ?? matchByDeparture(P, licence, text(s.dep), hm(s.depTime), date, min)) : null;
  const pat = match?.trip.pattern;
  const city = pat?.c ?? (/^(?:895|785|925|926|936|93523)/.test(licence ?? '') ? 'town' : 'other');
  const type = pat?.y === 'r' || isTram(s) ? 'tram' : pat?.y === 't' ? 'trolleybus' : 'bus';
  const v = {
    id: `idsok-${s.id ?? `${licence}-${trip}`}`,
    type,
    city,
    line: line ?? lineLabel(licence),
    licence,
    lat,
    lon,
    bearing: null,
    stop: null,
    next: null,
    from: s.dep ? cityStopName(city, text(s.dep)) : null,
    headsign: s.dest ? cityStopName(city, text(s.dest)) : null,
    rawStop: null,
    rawHeadsign: text(s.dest) || null,
    tripNo: trip,
    operatorName: pat?.c === 'town' ? pat.o : carrierName(text(s.operator)),
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
