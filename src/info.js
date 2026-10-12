// Okno „Informace“ (ikonka i vlevo dole): odkud aplikace bere data, licence a autorská práva.
// Nahrazuje rozbalovací popisek mapy, který zabíral místo na mapě.
const sheet = document.getElementById('info-sheet');
const body = document.getElementById('info-body');

function h(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function link(text, href) {
  const a = h('a', null, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

/** Řádek: název tučně, pod ním popis; parts = text nebo odkazy [text, url]. */
function row(title, ...parts) {
  const r = h('div', 'info-row');
  r.append(h('b', null, title));
  const p = h('small');
  for (const part of parts) p.append(Array.isArray(part) ? link(...part) : part);
  r.append(p);
  return r;
}

function group(title, rows) {
  const g = h('div', 'legend-group');
  g.append(h('div', 'filter-label', title));
  const list = h('div', 'legend-list');
  list.append(...rows);
  g.append(list);
  return g;
}

function render() {
  body.replaceChildren(
    h('p', 'info-lead', 'Doprava živě ukazuje, kde právě jedou autobusy, trolejbusy, tramvaje a vlaky ve Zlínském a Jihomoravském kraji, a hledá spojení. Data se stahují jen při otevřené aplikaci.'),
    group('Polohy vozidel', [
      row('MHD Zlín – Otrokovice', 'Veřejná mapa DSZO ', ['dszo.cz/online', 'https://www.dszo.cz/online/'], ', obnova asi po 15 s.'),
      row('Zlínský kraj', 'Mapa IDZK ', ['mpvnet.cz', 'https://mpvnet.cz/zlin/map'], ' (regionální autobusy a MHD měst), MHD Kroměříž z ', ['kromeriz.mhdonline.cz', 'https://kromeriz.mhdonline.cz'], '.'),
      row('Jihomoravský kraj', 'Polohy vozidel IDS JMK, zdroj ', ['KORDIS JMK', 'https://www.idsjmk.cz'], ', otevřená data ', ['data.brno.cz', 'https://data.brno.cz'], ', licence ', ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/deed.cs'], '.'),
      row('Vlaky', 'Mapa vlaků ', ['Správy železnic', 'https://mapy.spravazeleznic.cz/vlaky'], ', náhradou mapy IDZK a IDS JMK.'),
      row('Dálkové autobusy', 'Sledování spojů ', ['FlixBus', 'https://www.flixbus.cz/track'], '. Ostatní dálkové a regionální linky bez živých poloh odhadem podle jízdního řádu (v detailu vozu je to napsané).'),
    ]),
    group('Jízdní řády a vyhledávání', [
      row('Zlínský kraj', 'GTFS IDZK a papírové jízdní řády DSZO (písmena u spojů).'),
      row('Jihomoravský kraj', ['GTFS KORDIS JMK', 'https://kordis-jmk.cz/gtfs/'], '.'),
      row('Celostátní autobusy', 'Jízdní řády CIS JŘ převedené do GTFS (', ['data.jr.ggu.cz', 'https://data.jr.ggu.cz'], '), RegioJet z ', ['regiojet.cz', 'https://regiojet.cz'], '.'),
      row('Vlaky', 'Celostátní jízdní řád ', ['CIS JŘ', 'https://portal.cisjr.cz'], ' (časy, výbava vlaků).'),
    ]),
    group('Mapa', [
      row('Podklad', 'Dlaždice ', ['OpenFreeMap', 'https://openfreemap.org'], ', data © ', ['přispěvatelé OpenStreetMap', 'https://www.openstreetmap.org/copyright'], '.'),
      row('Trasy a koleje', 'Trasy linek po silnicích spočítané nad ', ['OpenStreetMap', 'https://www.openstreetmap.org/copyright'], ' (OSRM), železniční tratě z OpenStreetMap.'),
      row('Knihovna mapy', ['MapLibre GL JS', 'https://maplibre.org'], '.'),
    ]),
    h('p', 'info-foot', 'Polohy a zpoždění jsou orientační, rozhodující je jízdní řád a informace dopravce.'),
  );
}

export function initInfo() {
  document.getElementById('info-open').addEventListener('click', () => {
    render();
    sheet.hidden = false;
  });
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) sheet.hidden = true;
  });
}
