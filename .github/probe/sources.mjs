const UA = { 'User-Agent': 'polohy-probe (github.com/JaneckaD/polohy)' };
const get = async (u) => (await fetch(u, { headers: UA, signal: AbortSignal.timeout(60000) })).text();
const cfg = await get('https://web.archive.org/web/2026id_/https://www.cestujok.cz/idspublic/config/config.js');
console.log('=== config.js head\n' + cfg.split('\n').slice(0, 70).join('\n'));
const app = await get('https://web.archive.org/web/2026id_/https://www.cestujok.cz/idspublic/app.js');
for (const re of [/serviceUrl/g, /stationsUrl/g, /\.SERVICES\b/g, /services\.api\}`/g, /refreshInterval|setInterval/g, /isServiceVisibleOnMap/g]) {
  let n = 0;
  for (const m of app.matchAll(re)) { console.log(`--- ${re} @${m.index}: ${app.slice(Math.max(0, m.index - 300), m.index + 300).replace(/\s+/g, ' ')}`); if (++n >= 6) break; }
}
