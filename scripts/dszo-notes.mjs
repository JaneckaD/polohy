// Písmena u spojů DSZO (např. 8d = „končí v zast. Baťova nem.“, 38g = „jede na Otrokovice, prům. areál“).
// Strojová data (GTFS IDZK) je nemají, jsou jen v PDF jízdních řádech DSZO (balík dszo_jr_*.zip).
// Text PDF vytáhne pdftotext (poppler-utils) se zachováním rozložení:
//   - nahoře číslo linky, vlevo seznam zastávek s jízdní dobou (0 = zastávka, pro kterou je stránka),
//   - uprostřed řádky „hodina  minuty…“ (minuta může mít písmeno: „52d“), vpravo informace pro cestující,
//   - dole „Poznámky u spojů:“ s vysvětlením písmen („d - končí v zast. Baťova nem.“).
import { execFileSync } from 'node:child_process';

/** Název zastávky pro porovnání (bez obce Zlín, diakritiky, mezer a interpunkce). */
export const normStop = (name) =>
  String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^zlin\s*,\s*/, '')
    .replace(/[^a-z0-9]/g, '');

const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/** Jedna stránka textu → { line, stop, marks: [[čas, písmeno]], notes: { písmeno: text } }. */
export function parsePage(text) {
  // Piktogramy (bezbariérová zastávka, automat…) jsou znaky ze soukromé oblasti Unicode: místo nich mezera,
  // ať sedí sloupce.
  const rows = text.replace(/[\uE000-\uF8FF]/g, ' ').split('\n');
  const line = /^\s*(\S+)\s{5,}Platnost/.exec(rows.find((r) => /Platnost/.test(r)) ?? '')?.[1] ?? null;
  let stop = null;
  const marks = [];
  const notes = {};
  let inNotes = false;
  for (const row of rows) {
    // Zastávka, pro kterou je stránka: jízdní doba 0 (sloupců jízdních dob může být víc: „0 0 Jaroslavice,náves“).
    const s = /^\s*((?:(?:\d+|<)\s+){1,3})(\p{L}.*?)(?=\s{2,}|$)/u.exec(row);
    if (s && !stop && s[1].trim().split(/\s+/).includes('0')) stop = s[2].trim();
    if (/Poznámky u spojů/.test(row)) inNotes = true;
    if (inNotes || /\s[a-zA-Z] - \S/.test(row)) {
      for (const m of row.matchAll(/(?:^|\s)(\p{L}) - (\S.*?)(?=\s{3,}|$)/gu)) {
        // Vlevo jsou poznámky u zastávek (x = na znamení), ty nechceme.
        if (m[1] === 'x' || m.index < 25) continue;
        notes[m[1]] = m[2].trim();
      }
    }
    // Řádek hodin: dvoumístná hodina zhruba ve 30.–60. sloupci (podle šířky názvů), za ní minuty
    // (v pravém sloupci jsou informace pro cestující).
    const hour = /^(.{30,60}?)\s(\d{2})(?=\s|$)/.exec(row);
    if (!hour) continue;
    const h = Number(hour[2]);
    if (h > 24) continue;
    const start = hour[1].length + 3;
    for (const m of row.slice(start).matchAll(/(?<=\s|^)(\d{2})(\p{L}?)(?=\s|$)/gu)) {
      if (start + m.index > 120) break;
      if (m[2]) marks.push([hhmm(h, Number(m[1])), m[2]]);
    }
  }
  return { line, stop, marks, notes };
}

/**
 * Písmena spojů ze všech PDF v balíku: { notes: { linka: { písmeno: text } }, marks: Map(„linka|zastávka|HH:MM“ → písmeno) }.
 * files = { 'cesta.pdf': Uint8Array }; bez pdftotext vrací null.
 */
export function dszoMarks(files, tmpDir) {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'ignore' });
  } catch {
    console.warn('Písmena spojů DSZO: chybí pdftotext (poppler-utils).');
    return null;
  }
  const notes = {};
  const marks = new Map();
  let pages = 0;
  for (const [name, bytes] of Object.entries(files)) {
    if (!name.toLowerCase().endsWith('.pdf')) continue;
    let text;
    try {
      text = execFileSync('pdftotext', ['-layout', '-', '-'], { input: bytes, maxBuffer: 64 << 20 }).toString('utf8');
    } catch {
      continue;
    }
    for (const page of text.split('\f')) {
      const p = parsePage(page);
      if (!p.line) continue;
      pages++;
      if (Object.keys(p.notes).length) notes[p.line] = { ...notes[p.line], ...p.notes };
      if (!p.stop) continue;
      for (const [time, letter] of p.marks) marks.set(`${p.line}|${normStop(p.stop)}|${time}`, letter);
    }
  }
  console.log(`Písmena spojů DSZO: ${pages} stránek, ${marks.size} časů s písmenem, poznámky u linek ${Object.keys(notes).join(', ')}.`);
  return { notes, marks };
}

/**
 * Doplní do dat vyhledávání písmena spojů DSZO: planner.marks = { index spoje: písmeno },
 * planner.notes = { linka: { písmeno: text } } (jen použitá písmena).
 */
export function applyMarks(planner, dszo) {
  if (!dszo) return;
  const out = {};
  const used = {};
  planner.trips.forEach((trip, i) => {
    const pat = planner.patterns[trip[0]];
    if (pat.c || pat.y === 'v') return;
    let t = trip[2];
    for (let k = 0; k < pat.s.length; k++) {
      if (k > 0) t += trip[2 + k];
      const key = `${pat.r}|${normStop(planner.stops[pat.s[k]][0])}|${hhmm(Math.floor((t % 1440) / 60), t % 60)}`;
      const letter = dszo.marks.get(key);
      if (letter && dszo.notes[pat.r]?.[letter]) {
        out[i] = letter;
        (used[pat.r] ??= {})[letter] = dszo.notes[pat.r][letter];
        return;
      }
    }
  });
  planner.marks = out;
  planner.notes = used;
  console.log(`Písmena spojů DSZO: ${Object.keys(out).length} spojů (${Object.entries(used).map(([l, n]) => `${l}${Object.keys(n).join('/')}`).join(', ')}).`);
}
