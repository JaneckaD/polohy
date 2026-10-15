// Filtr vozidel: druh dopravy, druh vlaku, kraj a dopravce (obecně, bez výčtu měst).
// V každé skupině nic nevybráno = všechno; vůz se ukáže, když vyhoví všem skupinám, které se ho týkají.
import { CARRIERS, COACHES, isCoach } from './cities.js';
import { TRAIN_KINDS } from './trains.js';
import { krajOf } from './region.js';

/** Druhy dopravy (barvy jako na mapě). */
export const KINDS = {
  tram: { label: 'Tramvaje', color: '#c4122f', text: '#ffffff' },
  trolleybus: { label: 'Trolejbusy', color: '#ffcc00', text: '#1c1c1e' },
  mhd: { label: 'MHD autobusy', color: '#0a66d8', text: '#ffffff' },
  regional: { label: 'Regionální autobusy', color: '#e8710a', text: '#ffffff' },
  coach: { label: 'Dálkové autobusy', color: '#00838f', text: '#ffffff' },
  train: { label: 'Vlaky', color: '#3a3a3c', text: '#ffffff' },
};

/** Kraje, ve kterých aplikace ukazuje dopravu (další přibudou). */
export const REGIONS = {
  zlk: { name: 'Zlínský kraj' },
  jmk: { name: 'Jihomoravský kraj' },
  olk: { name: 'Olomoucký kraj' },
  msk: { name: 'Moravskoslezský kraj' },
  pak: { name: 'Pardubický kraj' },
};

// Obrys oblasti s kraji (region.json), podle něj se pozná kraj vlaků, regionálních a dálkových autobusů.
let region = null;
export function setFilterRegion(r) {
  region = r;
}
// Kraj se počítá jednou pro každou polohu vozu (filtr se vyhodnocuje při každém překreslení).
const krajCache = new WeakMap();
function krajAt(v) {
  if (!region || !Number.isFinite(v.lon) || !Number.isFinite(v.lat)) return 'zlk';
  let k = krajCache.get(v);
  if (k === undefined) {
    k = krajOf(region, v.lon, v.lat) ?? 'zlk';
    krajCache.set(v, k);
  }
  return k;
}

/** Krátké vysvětlení druhů dopravy do filtru (obecně, bez výčtu měst a linek). */
export const KIND_HINTS = [
  ['MHD', 'tramvaje, trolejbusy a autobusy městské dopravy'],
  ['Regionální', 'linky mezi obcemi, živě nebo odhadem podle jízdního řádu'],
  ['Dálkové', 'linky přes celou republiku i do zahraničí'],
];

export const EMPTY_FILTER = { kinds: [], trainKinds: [], regions: [], carriers: [] };

/** Barva dopravce ve filtru: podle druhu dopravy, kterou provozuje. */
export function carrierColor(v) {
  if (v.type === 'train') return { color: v.operator?.color ?? '#636366', text: v.operator?.text ?? '#ffffff' };
  const k = KINDS[describe(v).kind] ?? KINDS.regional;
  return { color: k.color, text: k.text };
}

/** Druh dopravy, dopravce a kraj vozu. U MHD dopravce neřešíme (filtruje se druhem). */
export function describe(v) {
  if (v.type === 'train') return { kind: 'train', carrier: v.operator?.short ?? null, region: krajAt(v) };
  if (isCoach(v.city)) return { kind: 'coach', carrier: v.operatorName ?? COACHES[v.city].short, region: krajAt(v) };
  if (v.city && CARRIERS[v.city]) return { kind: 'regional', carrier: v.operatorName ?? CARRIERS[v.city].short, region: krajAt(v) };
  return { kind: v.type === 'trolleybus' || v.type === 'tram' ? v.type : 'mhd', carrier: null, region: krajAt(v) };
}

/** Uložený filtr (i ze starší verze s typem a dopravci vlaků) → současný tvar. */
export function normalizeFilter(raw) {
  if (!raw || typeof raw !== 'object') raw = {};
  const f = { ...EMPTY_FILTER };
  for (const k of Object.keys(EMPTY_FILTER)) if (Array.isArray(raw[k])) f[k] = raw[k].map(String);
  if (raw.type && raw.type !== 'all' && !raw.kinds) f.kinds = raw.type === 'trolleybus' ? ['trolleybus'] : raw.type === 'train' ? ['train'] : ['mhd', 'regional', 'coach'];
  if (Array.isArray(raw.operators) && !raw.carriers) f.carriers = raw.operators.map(String);
  return f;
}

/** Druhy dopravy, které filtr ukazuje (nic nevybráno = všechny). */
export function effectiveKinds(f) {
  return f.kinds;
}

export function filterActive(f) {
  return Object.keys(EMPTY_FILTER).some((k) => f[k]?.length > 0);
}

export function filterCount(f) {
  return Object.keys(EMPTY_FILTER).reduce((n, k) => n + (f[k]?.length ?? 0), 0);
}

export function matchesFilter(v, f) {
  const d = describe(v);
  const kinds = effectiveKinds(f);
  if (kinds.length && !kinds.includes(d.kind)) return false;
  if (f.regions.length && !f.regions.includes(d.region)) return false;
  if (f.carriers.length && !f.carriers.includes(d.carrier)) return false;
  if (d.kind === 'train' && f.trainKinds.length && !f.trainKinds.includes(v.kind)) return false;
  return true;
}

/** Krátký popis filtru do lišty nad mapou. */
export function describeFilter(f) {
  const parts = [];
  if (f.kinds.length) parts.push(f.kinds.map((k) => KINDS[k]?.label.toLowerCase() ?? k).join(', '));
  if (f.trainKinds.length) parts.push(f.trainKinds.map((k) => TRAIN_KINDS[k]?.label.toLowerCase() ?? k).join(', '));
  if (f.regions.length) parts.push(f.regions.map((k) => REGIONS[k]?.name ?? k).join(', '));
  if (f.carriers.length) parts.push(f.carriers.join(', '));
  return parts.join(' · ');
}
