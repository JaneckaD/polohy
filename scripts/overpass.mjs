// Společné stahování z Overpass API (OpenStreetMap) a záloha z posledního nasazení.

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Vrací odpověď Overpass jako JSON, nebo null, když žádný server neodpoví. */
export async function overpass(query) {
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'mhd-zlin-live (github.com/JaneckaD/polohy)',
          },
          body: 'data=' + encodeURIComponent(query),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        console.warn(`Overpass ${url} selhal: ${err.message}`);
      }
    }
    await sleep(15000);
  }
  return null;
}

/** Soubor z posledního nasazení na GitHub Pages (PAGES_URL), když ho sestavení nedokáže vytvořit znovu. */
export async function previousDeploy(file) {
  if (!process.env.PAGES_URL) return null;
  try {
    const res = await fetch(new URL(file, process.env.PAGES_URL));
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
