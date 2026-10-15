// Kraj Vysočina (2): obsah mapy VDV a detail vozu.
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36';
const H = { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://mapavdv.kr-vysocina.cz/' };
const base = 'https://mapavdv.kr-vysocina.cz';
const r = await fetch(`${base}/Ajax/GetPoints`, { headers: H });
console.log('GetPoints', r.status, r.headers.get('set-cookie'));
const pts = await r.json();
const tally = (f) => JSON.stringify(Object.entries(pts.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]));
console.log('count', pts.length, 'keys', JSON.stringify(Object.keys(pts[0])));
console.log('traction', tally((x) => x.traction));
console.log('prefix', tally((x) => String(x.text).slice(0, 3)));
console.log('text samples', [...new Set(pts.map((x) => x.text))].slice(0, 80).join(' '));
console.log('non-bus', JSON.stringify(pts.filter((x) => x.traction !== 'BUS').slice(0, 15)));
console.log('jihlava', JSON.stringify(pts.filter((x) => /^(587|56|5870)/.test(String(x.text)) || /Jihlava/.test(x.finalStopName)).slice(0, 12)));
for (const f of ['js/InfoWindow.js', 'js/PointsProvider.js', 'js/InFlowMap.js', 'js/InFlow.js', 'js/MapPoint.js']) {
  const js = await (await fetch(`${base}/${f}`, { headers: { 'User-Agent': UA } })).text();
  const urls = [...new Set([...js.matchAll(/["'`]([^"'`]*(?:Ajax|api|Get)[^"'`]*)["'`]/g)].map((m) => m[1]))];
  console.log(`\n${f} (${js.length})`, urls.join(' | '));
  if (f === 'js/InfoWindow.js') console.log(js.slice(0, 5000));
}
const id = pts.find((x) => x.delay > -1000)?.id;
for (const path of [`/Ajax/GetPointDetail?id=${id}`, `/Ajax/GetPointInfo?id=${id}`, `/Ajax/GetDetail?id=${id}`, `/Ajax/GetInfo?id=${id}`, `/Ajax/GetTrip?id=${id}`, `/Ajax/GetConnection?id=${id}`]) {
  const x = await fetch(base + path, { headers: H });
  console.log(path, x.status, (await x.text()).slice(0, 1500));
}
