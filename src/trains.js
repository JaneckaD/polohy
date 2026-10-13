// Vlaky v oblasti (Zlínský, Jihomoravský, Olomoucký a Moravskoslezský kraj): polohy všech osobních vlaků od Správy železnic
// (mapy.spravazeleznic.cz), přes stejnou proxy jako data DSZO. Souřadnice jsou v S-JTSK, na mapě jen vlaky
// uvnitř oblasti. Náhradní zdroje (mapy IDZK, ODIS a IDS JMK) posílají rovnou lat/lon; vlaky z mapy IDS JMK
// nemají číslo, to dohledá identifyTrain v train-trip.js.
import { krovakToWgs } from './krovak.js';
import { regionContains } from './region.js';

export const TRAIN_REFRESH_MS = 20000;

/** Druhy vlaků podle zkratky v datech. */
export const TRAIN_KINDS = {
  os: { label: 'Osobní', long: 'Osobní vlak', color: '#6c6c70' },
  sp: { label: 'Spěšný', long: 'Spěšný vlak', color: '#1f8a3b' },
  r: { label: 'Rychlík', long: 'Rychlík', color: '#d12d2d' },
  int: { label: 'Mezinárodní', long: 'Mezinárodní vlak', color: '#7b3fa8' },
};

const KIND_OF = {
  Os: 'os', TL: 'os', Ok: 'os',
  Sp: 'sp',
  R: 'r', RJ: 'r', LE: 'r', IC: 'r', SC: 'r', Ex: 'r', TLX: 'r', AEx: 'r',
  EC: 'int', EN: 'int', rj: 'int', ICE: 'int', NJ: 'int', RGJ: 'int', ECE: 'int',
};

export function trainKind(code) {
  return KIND_OF[code] ?? (/^[A-Z]{2,3}$/.test(code ?? '') ? 'r' : 'os');
}

/** Dopravci: krátký název a barva značky vlaku (text na ní). */
const OPERATORS = [
  [/^(České dráhy|ČD\b)/i, 'ČD', '#1d4f91', '#ffffff'],
  [/^RegioJet/i, 'RegioJet', '#f2c300', '#1c1c1e'],
  [/^(Leo Express|LE$)/i, 'Leo Express', '#1c1c1e', '#ffc94a'],
  [/^ARRIVA/i, 'Arriva', '#00788a', '#ffffff'],
  [/^GW Train/i, 'GW Train', '#2e7d32', '#ffffff'],
  [/Länderbahn/i, 'Länderbahn', '#5b2a86', '#ffffff'],
  [/^KŽC/i, 'KŽC', '#8a4b1c', '#ffffff'],
  [/^AŽD/i, 'AŽD', '#455a64', '#ffffff'],
  [/^Railway Capital/i, 'Railway Capital', '#37474f', '#ffffff'],
  [/^(ŽSSK|ZSSK)|Železničná spoločnosť/i, 'ZSSK', '#c62828', '#ffffff'],
  [/^CityRail/i, 'CityRail', '#3949ab', '#ffffff'],
  [/^MBM rail/i, 'MBM rail', '#6d4c41', '#ffffff'],
  [/^DB Regio|^DB\b/i, 'DB', '#ec0016', '#ffffff'],
  [/^ÖBB/i, 'ÖBB', '#c8102e', '#ffffff'],
];

export function trainOperator(name = '') {
  for (const [re, short, color, text] of OPERATORS) if (re.test(name)) return { name, short, color, text };
  const short = name.replace(/,?\s*(a\.\s?s\.|s\.\s?r\.\s?o\.|SE|AG|GmbH.*)$/i, '').trim() || 'Dopravce';
  return { name, short, color: '#636366', text: '#ffffff' };
}

// Zpoždění v minutách (de); prázdné = neznámé.
const minutesOf = (value) => (value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value));

/** Záznam z proxy → vůz pro mapu (nebo null, když je mimo kraj). */
export function parseTrain(t, region) {
  // Od SŽ souřadnice S-JTSK (x, y), z mapy IDZK (náhrada, když SŽ neodpoví) rovnou lat, lon.
  const wgs = Number.isFinite(t.lat) && Number.isFinite(t.lon) ? [t.lon, t.lat] : Number.isFinite(t.x) && Number.isFinite(t.y) ? krovakToWgs(t.x, t.y) : null;
  if (!wgs) return null;
  const [lon, lat] = wgs;
  if (region && !regionContains(region, lon, lat)) return null;
  const code = String(t.tt ?? '').trim();
  const delayMin = minutesOf(t.de);
  const op = t.d ? trainOperator(t.d) : null;
  const jmk = t.src === 'jmk';
  return {
    id: jmk ? `vlak-jmk-${t.vid}` : `vlak-${code}-${t.tn}`,
    type: 'train',
    source: jmk ? 'jmk' : null,
    lineName: t.line || null, // linka IDS JMK (S3, R12…), když vlak známe jen z mapy IDS JMK
    line: jmk ? `${code} ${t.line}` : `${code} ${t.tn}`,
    code,
    number: String(t.tn ?? ''),
    kind: trainKind(code),
    name: t.na || null,
    operator: op ?? { name: '', short: 'Dopravce', color: '#636366', text: '#ffffff' },
    lat,
    lon,
    bearing: t.a !== '' && t.a != null && Number.isFinite(Number(t.a)) ? ((Number(t.a) % 360) + 360) % 360 : null,
    from: t.fn || null,
    headsign: t.ln || null,
    stop: t.cna || null,
    stopPlanned: t.cp || null,
    stopReal: t.cr || null,
    next: t.nsn || null,
    nextArr: t.nst || null,
    nextDep: t.nsp || null,
    delay: delayMin != null ? delayMin * 60 : null,
    delayText: delayMin != null ? `${Math.abs(delayMin)} min` : null,
  };
}

export async function fetchTrains(proxy, region) {
  const res = await fetch(`${proxy}/trains`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`/trains: HTTP ${res.status}`);
  const data = await res.json();
  return (data.trains ?? []).map((t) => parseTrain(t, region)).filter(Boolean);
}
