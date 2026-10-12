// Filtr vozidel: druh dopravy, druh vlaku, kraj, město (MHD) a dopravce.
// V každé skupině nic nevybráno = všechno; vůz se ukáže, když vyhoví všem skupinám, které se ho týkají.
import { CITIES, CARRIERS, COACHES, isCoach } from './cities.js';
import { TRAIN_KINDS } from './trains.js';
import { krajOf } from './region.js';

/** Druhy dopravy (barvy jako na mapě). */
export const KINDS = {
  trolleybus: { label: 'Trolejbusy', color: '#ffcc00', text: '#1c1c1e' },
  mhd: { label: 'MHD autobusy', color: '#0a66d8', text: '#ffffff' },
  regional: { label: 'Regionální autobusy', color: '#e8710a', text: '#ffffff' },
  coach: { label: 'Dálkové autobusy', color: '#00838f', text: '#ffffff' },
  train: { label: 'Vlaky', color: '#3a3a3c', text: '#ffffff' },
};
const MHD_KINDS = ['trolleybus', 'mhd'];

/** Kraje, ve kterých aplikace ukazuje dopravu (další přibudou). */
export const REGIONS = {
  zlk: { name: 'Zlínský kraj' },
  jmk: { name: 'Jihomoravský kraj' },
};

// Obrys oblasti s kraji (region.json), podle něj se pozná kraj vlaků, regionálních a dálkových autobusů.
let region = null;
export function setFilterRegion(r) {
  region = r;
}
const krajAt = (v) => (region && Number.isFinite(v.lon) && Number.isFinite(v.lat) ? (krajOf(region, v.lon, v.lat) ?? 'zlk') : 'zlk');

/** Města s MHD: Zlín–Otrokovice (DSZO) a ostatní podle IDZK. */
export const NETWORK_NAMES = { zl: 'Zlín–Otrokovice', ...Object.fromEntries(Object.entries(CITIES).map(([k, c]) => [k, c.name])) };

/** Dopravci autobusů, které aplikace zná (vlakoví dopravci přibydou podle vlaků na mapě). */
export const BUS_CARRIERS = [
  { name: 'DSZO', color: KINDS.mhd.color, text: '#ffffff' },
  ...Object.values(CARRIERS)
    .filter((c) => c.code)
    .map((c) => ({ name: c.short, color: c.main, text: c.text })),
  ...Object.values(COACHES).map((c) => ({ name: c.short, color: c.main, text: c.text })),
];

export const EMPTY_FILTER = { kinds: [], trainKinds: [], regions: [], networks: [], carriers: [] };

/** Druh dopravy, město, dopravce a kraj vozu. */
export function describe(v) {
  if (v.type === 'train') return { kind: 'train', network: null, carrier: v.operator?.short ?? null, region: krajAt(v) };
  if (isCoach(v.city)) return { kind: 'coach', network: null, carrier: COACHES[v.city].short, region: krajAt(v) };
  if (v.city && CARRIERS[v.city]) return { kind: 'regional', network: null, carrier: CARRIERS[v.city].short, region: krajAt(v) };
  const kind = v.type === 'trolleybus' ? 'trolleybus' : 'mhd';
  if (v.city) return { kind, network: v.city, carrier: v.operator ?? null, region: 'zlk' };
  return { kind, network: 'zl', carrier: 'DSZO', region: 'zlk' };
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

/** Druhy dopravy, které filtr ukazuje: vybrané, nebo jen MHD, když je vybrané město. */
export function effectiveKinds(f) {
  if (f.kinds.length) return f.kinds;
  return f.networks.length ? MHD_KINDS : [];
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
  if (d.network && f.networks.length && !f.networks.includes(d.network)) return false;
  return true;
}

/** Krátký popis filtru do lišty nad mapou. */
export function describeFilter(f) {
  const parts = [];
  if (f.kinds.length) parts.push(f.kinds.map((k) => KINDS[k]?.label.toLowerCase() ?? k).join(', '));
  if (f.trainKinds.length) parts.push(f.trainKinds.map((k) => TRAIN_KINDS[k]?.label.toLowerCase() ?? k).join(', '));
  if (f.regions.length) parts.push(f.regions.map((k) => REGIONS[k]?.name ?? k).join(', '));
  if (f.networks.length) parts.push(`MHD ${f.networks.map((k) => NETWORK_NAMES[k] ?? k).join(', ')}`);
  if (f.carriers.length) parts.push(f.carriers.join(', '));
  return parts.join(' · ');
}
