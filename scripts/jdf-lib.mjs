// Zpracování jízdních řádů DSZO ve formátu JDF (Jednotný datový formát CIS JŘ, verze 1.10/1.11).
// Balík je ZIP s textovými soubory v kódování windows-1250, každý řádek je "pole","pole",...;
//
// Používané soubory:
//   Zastavky.txt  číslo, obec, část obce, bližší místo, blízká obec, stát, kódy…
//   Linky.txt     číslo linky, název, IČ, typ linky, dopravní prostředek (A/T/…), …
//   Spoje.txt     číslo linky, číslo spoje, pevné kódy 1–10, skupina spojů, rozlišení
//   Zasspoje.txt  číslo linky, číslo spoje, tarifní číslo, číslo zastávky, označník, stanoviště,
//                 kódy 1–3, km, příjezd, odjezd, [1.11: min/max…], rozlišení
//   Pevnykod.txt  číslo pevného kódu, symbol (X, +, 1–7, …)
//   Caskody.txt   číslo linky, číslo spoje, číslo kódu, označení, typ, od, do, poznámka, rozlišení

export function parseJdfFile(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    if (fields.length) rows.push(fields);
  }
  return rows;
}

/** Načte soubory z rozbaleného ZIPu (mapa název -> Uint8Array), názvy bez ohledu na velikost písmen. */
export function readJdf(files) {
  const decoder = new TextDecoder('windows-1250');
  const byName = {};
  for (const [path, bytes] of Object.entries(files)) {
    const name = path.split('/').pop().toLowerCase();
    if (name.endsWith('.txt')) byName[name] = parseJdfFile(decoder.decode(bytes));
  }
  return byName;
}

// --- Kalendář ---------------------------------------------------------------

function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const ymd = (d) => d.toISOString().slice(0, 10);

/** Státní svátky ČR (včetně Velkého pátku a Velikonočního pondělí). */
export function czechHolidays(year) {
  const fixed = ['01-01', '05-01', '05-08', '07-05', '07-06', '09-28', '10-28', '11-17', '12-24', '12-25', '12-26'];
  const set = new Set(fixed.map((md) => `${year}-${md}`));
  const easter = easterSunday(year).getTime();
  set.add(ymd(new Date(easter - 2 * 86400000)));
  set.add(ymd(new Date(easter + 86400000)));
  return set;
}

function parseDate(ddmmyyyy) {
  const m = /^(\d{2})(\d{2})(\d{4})$/.exec(ddmmyyyy ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Jede spoj v daný den? symbols = symboly pevných kódů spoje, codes = časové kódy spoje.
 * Typy časových kódů: 1 jede, 2 jede také, 3 jede jen, 4 nejede (5–8 sudé/liché týdny ignorujeme).
 */
export function runsOn(dateStr, symbols, codes, holidays) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const dow = ((date.getUTCDay() + 6) % 7) + 1; // 1 = pondělí … 7 = neděle
  const holiday = holidays.has(dateStr);
  const inRange = (c) => c.from && dateStr >= c.from && dateStr <= (c.to ?? c.from);

  if (codes.some((c) => c.type === '4' && inRange(c))) return false;
  if (codes.some((c) => c.type === '2' && inRange(c))) return true;
  const only = codes.filter((c) => c.type === '3');
  if (only.length) return only.some(inRange);
  const runs = codes.filter((c) => c.type === '1');
  if (runs.length && !runs.some(inRange)) return false;

  const daySymbols = symbols.filter((s) => /^[X+1-7]$/.test(s));
  if (!daySymbols.length) return true;
  return daySymbols.some((s) => {
    if (s === 'X') return dow <= 5 && !holiday;
    if (s === '+') return dow === 7 || holiday;
    // Číselné symboly platí i ve svátek, pokud není výslovně uvedeno jinak.
    return Number(s) === dow && !(holiday && dow <= 5 && !symbols.includes('+'));
  });
}

// --- Linky, spoje, zastávky ---------------------------------------------------

function stopDisplayName([, obec, cast, misto]) {
  const local = misto || cast || obec;
  if (/^zlín$/i.test(obec)) return local;
  return local && local !== obec ? `${obec},${local}` : obec;
}

function lineRef(number, name) {
  const m = /(\d{1,3})\s*$/.exec(name ?? '');
  if (/^\d{6}$/.test(number)) return String(parseInt(number.slice(3), 10));
  if (m) return String(parseInt(m[1], 10));
  return String(number);
}

const toMinutes = (t) => (/^\d{3,4}$/.test(t) ? Math.floor(Number(t) / 100) * 60 + (Number(t) % 100) : null);

/**
 * Z JDF tabulek sestaví linky: pro každou směry s pořadím zastávek a spoji (časy v minutách).
 * startDate (YYYY-MM-DD) a days určují, pro které dny se předpočítá, kdy který spoj jede.
 */
export function buildTimetables(jdf, { startDate, days = 120 } = {}) {
  const stopRows = jdf['zastavky.txt'] ?? [];
  const stopsById = new Map(stopRows.map((r) => [r[0], stopDisplayName(r)]));

  const symbolsByCode = new Map((jdf['pevnykod.txt'] ?? []).map((r) => [r[0], r[1]]));
  const lines = new Map();
  for (const r of jdf['linky.txt'] ?? []) {
    const key = `${r[0]}|${r.at(-1)}`;
    const vehicle = r[4];
    lines.set(key, {
      number: r[0],
      ref: lineRef(r[0], r[1]),
      name: r[1],
      type: vehicle === 'T' ? 'trolleybus' : 'bus',
      validFrom: parseDate(r[13]),
      validTo: parseDate(r[14]),
    });
  }

  const tripKey = (r, last) => `${r[0]}|${r[1]}|${last}`;
  const trips = new Map();
  for (const r of jdf['spoje.txt'] ?? []) {
    const symbols = r.slice(2, 12).filter(Boolean).map((c) => symbolsByCode.get(c) ?? c);
    trips.set(tripKey(r, r.at(-1)), { line: `${r[0]}|${r.at(-1)}`, number: Number(r[1]), symbols, codes: [], stops: [] });
  }
  for (const r of jdf['caskody.txt'] ?? []) {
    trips.get(tripKey(r, r.at(-1)))?.codes.push({ type: r[4], from: parseDate(r[5]), to: parseDate(r[6]) || parseDate(r[5]) });
  }
  for (const r of jdf['zasspoje.txt'] ?? []) {
    const trip = trips.get(tripKey(r, r.at(-1)));
    if (!trip) continue;
    // 1.10: příjezd [10], odjezd [11]; 1.11 přidává další sloupce, ale tyto dva zůstávají na místě.
    const arr = toMinutes(r[10]);
    const dep = toMinutes(r[11]);
    const time = dep ?? arr;
    if (time == null) continue; // projíždí (|) nebo jede jinudy (<)
    trip.stops.push({ tariff: Number(r[2]), stop: r[3], time });
  }

  // Předpočítané dny provozu: pro každou kombinaci kódů řetězec 0/1 od startDate.
  const dates = [];
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const holidays = new Set();
  for (let i = 0; i < days; i++) {
    const d = ymd(new Date(start + i * 86400000));
    dates.push(d);
  }
  for (const y of new Set(dates.map((d) => Number(d.slice(0, 4))))) for (const h of czechHolidays(y)) holidays.add(h);

  const result = new Map(); // ref -> { ref, type, name, directions }
  const stopIndex = new Map();
  const stopNames = [];
  const idx = (id) => {
    if (!stopIndex.has(id)) {
      stopIndex.set(id, stopNames.length);
      stopNames.push(stopsById.get(id) ?? id);
    }
    return stopIndex.get(id);
  };

  for (const trip of trips.values()) {
    const line = lines.get(trip.line);
    if (!line || trip.stops.length < 2) continue;
    // Lichá čísla spojů jedou směrem A (vzestupně podle tarifních čísel), sudá směrem B (sestupně).
    const dir = trip.number % 2 ? 'A' : 'B';
    trip.stops.sort((a, b) => (dir === 'A' ? a.tariff - b.tariff : b.tariff - a.tariff));
    // Spoje přes půlnoc: čas nesmí klesat.
    for (let i = 1; i < trip.stops.length; i++) {
      while (trip.stops[i].time < trip.stops[i - 1].time) trip.stops[i].time += 1440;
    }
    const entry = result.get(line.ref) ?? { ref: line.ref, type: line.type, name: line.name, dirs: { A: [], B: [] } };
    result.set(line.ref, entry);
    const valid = (d) => (!line.validFrom || d >= line.validFrom) && (!line.validTo || d <= line.validTo);
    const mask = dates.map((d) => (valid(d) && runsOn(d, trip.symbols, trip.codes, holidays) ? '1' : '0')).join('');
    if (!mask.includes('1')) continue;
    entry.dirs[dir].push({ number: trip.number, stops: trip.stops.map((s) => idx(s.stop)), times: trip.stops.map((s) => s.time), mask });
  }

  const out = [];
  for (const entry of result.values()) {
    const directions = [];
    for (const [dir, list] of Object.entries(entry.dirs)) {
      if (!list.length) continue;
      // Varianty trasy podle posloupnosti zastávek, nejčastější první.
      const patterns = new Map();
      for (const t of list) {
        const key = t.stops.join(',');
        const p = patterns.get(key) ?? { stops: t.stops, count: 0 };
        p.count++;
        patterns.set(key, p);
      }
      const variants = [...patterns.values()].sort((a, b) => b.count - a.count);
      const main = variants[0].stops;
      const headsign = stopNames[main.at(-1)];
      // Seznam zastávek směru: hlavní varianta, ostatní zastávky vložené podle pořadí.
      const order = [...main];
      for (const v of variants.slice(1)) {
        v.stops.forEach((s, i) => {
          if (order.includes(s)) return;
          const prev = v.stops.slice(0, i).reverse().find((x) => order.includes(x));
          order.splice(prev == null ? 0 : order.indexOf(prev) + 1, 0, s);
        });
      }
      const masks = [];
      const maskIdx = (m) => {
        let i = masks.indexOf(m);
        if (i < 0) { masks.push(m); i = masks.length - 1; }
        return i;
      };
      const trips = list
        .map((t) => {
          const times = order.map((s) => {
            const i = t.stops.indexOf(s);
            return i < 0 ? null : t.times[i];
          });
          return { d: maskIdx(t.mask), t: times };
        })
        .sort((a, b) => (a.t.find((x) => x != null) ?? 0) - (b.t.find((x) => x != null) ?? 0));
      directions.push({ id: dir, headsign, stops: order, variants: variants.map((v) => ({ stops: v.stops, count: v.count })), masks, trips });
    }
    out.push({ ref: entry.ref, type: entry.type, name: entry.name, directions });
  }
  out.sort((a, b) => Number(a.ref) - Number(b.ref) || a.ref.localeCompare(b.ref));
  return { startDate, days, stopNames, lines: out };
}
