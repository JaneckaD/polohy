const KEY = 'apiKey=7781b8fa-07cf-4ab7-8b62-1f3178523ba0';
const H = { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'cs' };
const show = async (label, url) => { try { const r = await fetch(url, { headers: H }); const t = await r.text(); console.log(label, r.status, t.slice(0, 2500)); return t; } catch (e) { console.log(label, 'ERR', e.message); return ''; } };
const iso = (ms) => new Date(ms).toISOString();
const now = Date.now();
await show('TT', `https://global.api.flixbus.com/gis/v2/timetable/dcc3cb3d-9603-11e6-9066-549f350fcb0c/departures?from=${iso(now - 3 * 3600e3)}&to=${iso(now + 3 * 3600e3)}&${KEY}`);
for (const q of ['Jihlava', 'Pardubice', 'Havlíčkův Brod', 'Velké Meziříčí', 'Humpolec', 'Třebíč', 'Žďár nad Sázavou', 'Pelhřimov']) {
  const t = await show(`AC ${q}`, `https://global.api.flixbus.com/search/autocomplete/cities?q=${encodeURIComponent(q)}&lang=cs&country=cz&flixbus_cities_only=false&stations=true&popular_stations=true`);
}
await show('ST1', `https://global.api.flixbus.com/gis/v1/stations?${KEY}&city=Jihlava`);
await show('ST2', `https://global.api.flixbus.com/search/autocomplete/stations?q=Jihlava&lang=cs`);
