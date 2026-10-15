const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36';
const H = { 'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://mapavdv.kr-vysocina.cz/' };
const base = 'https://mapavdv.kr-vysocina.cz';
const page = await (await fetch(base + '/', { headers: { 'User-Agent': UA } })).text();
const scripts = [...page.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]).filter((s) => !/^http/.test(s));
console.log('scripts', scripts.join(' '));
for (const s of scripts) {
  const js = await (await fetch(new URL(s, base), { headers: { 'User-Agent': UA } })).text();
  const i = js.search(/loadTimetable|GetVehiclesByLine|vehicleNumber|currentStopId/);
  if (i >= 0) console.log(`\n== ${s}\n`, js.slice(Math.max(0, i - 2500), i + 1500));
}
const pts = await (await fetch(`${base}/Ajax/GetPoints`, { headers: H })).json();
const pick = [pts.find((x) => x.traction === 'BUS' && x.delay > -1000), pts.find((x) => x.traction === 'UNKNOWN'), pts.find((x) => x.traction === 'TRAIN')];
console.log('trains', JSON.stringify(pts.filter((x) => x.traction === 'TRAIN')));
for (const p of pick) {
  for (const q of [`vehicleNumber=${p.id}&currentStopId=0`, `vehicleNumber=${p.text}&currentStopId=0`, `vehicleNumber=${p.id}`]) {
    const x = await fetch(`${base}/Ajax/GetTimetable?${q}`, { headers: H });
    const t = await x.text();
    console.log('\n## GetTimetable', JSON.stringify(p), q, x.status, t.length, t.replace(/\s+/g, ' ').slice(0, 4000));
  }
}
const x = await fetch(`${base}/Ajax/GetVehiclesByLine?line=${pick[0].text}`, { headers: H });
console.log('\nbyline', x.status, (await x.text()).slice(0, 1500));
