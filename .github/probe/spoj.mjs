// Porovnání: regionální linky a MHD v OK/MSK v celostátních datech vs. Spojenka (příznak is_regional).
import { readFileSync } from 'node:fs';
import { readGtfsFiles } from '../../scripts/gtfs-lib.mjs';
import { nationalTrips, spojenkaTrips, cisRelation, NATIONAL_GTFS_URL, SPOJENKA_GTFS_URL } from '../../scripts/area-buses.mjs';
import { krajOf } from '../../src/region.js';
const region = JSON.parse(readFileSync('public/region.json', 'utf8'));
const dl = async (u) => new Uint8Array(await (await fetch(u, { headers: { 'User-Agent': 'polohy-probe (github.com/JaneckaD/polohy)' } })).arrayBuffer());
const startDate = new Date().toISOString().slice(0, 10);
const [ggu, spoj] = await Promise.all([dl(NATIONAL_GTFS_URL), dl(SPOJENKA_GTFS_URL)]);
const inK = (t) => t.stops.filter(([, la, lo]) => la != null && ['olk', 'msk'].includes(krajOf(region, lo, la))).length * 2 >= t.stops.length;
const G = nationalTrips(ggu, { startDate, days: 2, region, log: () => {} }).filter(inK);
console.log('GGU OK/MSK spojů', G.length, 'podle sítě', JSON.stringify(G.reduce((c, t) => ((c[t.city] = (c[t.city] ?? 0) + 1), c), {})));
const gLic = new Map(); for (const t of G) { const e = gLic.get(t.ref) ?? { n: 0, city: t.city, op: t.operator }; e.n++; gLic.set(t.ref, e); }
const S = spojenkaTrips(spoj, { startDate, days: 2, region, log: (m) => console.log(m.slice(0, 600)) });
const sLic = new Map(); for (const t of S) { const e = sLic.get(t.ref) ?? { n: 0, city: t.city, op: t.operator, type: t.type }; e.n++; sLic.set(t.ref, e); }
// is_regional podle licence ve Spojence
const routes = new Map(); const agencies = new Map();
readGtfsFiles(spoj, { 'routes.txt': (r) => routes.set(r.route_id, r), 'agency.txt': (r) => agencies.set(r.agency_id, r.agency_name) });
const licReg = new Map();
readGtfsFiles(spoj, { 'trips.txt': (r) => { const [lic] = cisRelation(r.relations); if (lic && !licReg.has(lic)) { const ro = routes.get(r.route_id); licReg.set(lic, `${ro?.route_type}/${ro?.is_regional}/${ro?.route_short_name}/${agencies.get(ro?.agency_id)}`); } } });
const cmp = {}; let missing = 0, missingN = 0; const miss = [];
for (const [lic, g] of gLic) {
  const s = sLic.get(lic);
  const k = `${g.city}→${s ? s.city : 'CHYBÍ'}`; cmp[k] = (cmp[k] ?? 0) + 1;
  if (!s) { missing++; missingN += g.n; if (miss.length < 25) miss.push(`${lic} ${g.op} ggu ${g.n} spoj ${licReg.get(lic) ?? '-'}`); }
}
console.log('licence GGU→Spojenka', JSON.stringify(cmp), 'chybí licencí', missing, 'spojů', missingN);
for (const m of miss) console.log('  chybí', m);
const isReg = {}; for (const [lic, g] of gLic) { const v = (licReg.get(lic) ?? '-/-').split('/').slice(0, 2).join('/'); const k = `${g.city} ${v}`; isReg[k] = (isReg[k] ?? 0) + 1; }
console.log('GGU síť × Spojenka route_type/is_regional', JSON.stringify(isReg));
const sOnly = [...sLic].filter(([l]) => !gLic.has(l)); 
console.log('jen ve Spojence licencí', sOnly.length, 'spojů', sOnly.reduce((a, [, e]) => a + e.n, 0), sOnly.slice(0, 20).map(([l, e]) => `${l}:${e.op}:${e.type}:${e.n}`).join(' | '));
const routeReg = {}; for (const r of routes.values()) { const k = `${r.route_type}/${r.is_regional}`; routeReg[k] = (routeReg[k] ?? 0) + 1; } console.log('Spojenka routes type/is_regional', JSON.stringify(routeReg));
