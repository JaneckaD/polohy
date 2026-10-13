const UA = { 'User-Agent': 'polohy-probe (github.com/JaneckaD/polohy)' };
const get = async (u) => (await fetch(u, { headers: UA, signal: AbortSignal.timeout(60000) })).text();
const app = await get('https://web.archive.org/web/2026id_/https://www.cestujok.cz/idspublic/app.js');
console.log('len', app.length);
for (const re of [/position/g, /vehicleType/g, /lineNumber|lineName|serviceNumber|connectionNumber|tripNumber/g, /depTime|destTime/g, /PRIMESTSKA/g, /servicedetail/g]) {
  let n = 0;
  for (const m of app.matchAll(re)) { console.log(`--- ${re} @${m.index}: ${app.slice(Math.max(0, m.index - 500), m.index + 500).replace(/\s+/g, ' ')}`); if (++n >= 8) break; }
}
for (const u of ['https://web.archive.org/web/2026id_/https://www.cestujok.cz/idspublicservices/api/service/position', 'https://web.archive.org/web/2025id_/https://www.cestujok.cz/idspublicservices/api/service/position']) {
  try { const t = await get(u); console.log('=== wayback position', u, t.slice(0, 3000)); } catch (e) { console.log('ERR', u, e.message); }
}
