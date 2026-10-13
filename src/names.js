// Porovnávání názvů zastávek z DSZO a z OpenStreetMap, které se liší diakritikou,
// zkratkami a čárkami („Otrokovice,žel.st.“ vs. „Otrokovice, železniční stanice“).

const normCache = new Map();

export function normalizeName(name) {
  const key = String(name ?? '');
  let n = normCache.get(key);
  if (n === undefined) {
    if (normCache.size > 100000) normCache.clear();
    n = key
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    normCache.set(key, n);
  }
  return n;
}

// Stejné názvy se porovnávají při každé obnově poloh znovu a znovu: výsledky si pamatujeme.
const MAX_CACHE = 100000;
const tokenCache = new Map();
// Podobnost: první název → (druhý název → podobnost); bez skládání klíčů z řetězců při každém dotazu.
const similarityCache = new Map();
let similarityCount = 0;

export function nameTokens(name) {
  const key = String(name ?? '');
  let tokens = tokenCache.get(key);
  if (!tokens) {
    if (tokenCache.size > MAX_CACHE) tokenCache.clear();
    tokens = normalizeName(key).split(' ').filter(Boolean);
    tokenCache.set(key, tokens);
  }
  return tokens;
}

/** Zastávky DSZO mají na konci písmeno nástupiště („Zborovská A“), to pro porovnání nepotřebujeme. */
export function stripPlatform(name) {
  return String(name ?? '').replace(/\s+[A-Z]$/, '').trim();
}

/** Delší slova, která se liší jedním písmenem (překlep „Hygenická“ v jízdním řádu proti „Hygienická“). */
function oneTypo(a, b) {
  if (Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/**
 * Podobnost dvou názvů 0–1. Slova se shodují, když je jedno předponou druhého,
 * takže „zel st“ odpovídá „zeleznicni stanice“, nebo když se delší slova liší jedním písmenem.
 */
export function nameSimilarity(a, b) {
  const ka = a ?? '';
  const kb = b ?? '';
  let row = similarityCache.get(ka);
  if (!row) {
    if (similarityCount > 4 * MAX_CACHE) {
      similarityCache.clear();
      similarityCount = 0;
    }
    row = new Map();
    similarityCache.set(ka, row);
  }
  let sim = row.get(kb);
  if (sim === undefined) {
    sim = similarity(a, b);
    row.set(kb, sim);
    similarityCount++;
  }
  return sim;
}

function similarity(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const used = new Set();
  let matched = 0;
  for (const x of ta) {
    const i = tb.findIndex((y, j) => !used.has(j) && (y.startsWith(x) || x.startsWith(y) || oneTypo(x, y)));
    if (i >= 0) {
      used.add(i);
      matched++;
    }
  }
  return matched / Math.max(ta.length, tb.length) * 0.5 + matched / Math.min(ta.length, tb.length) * 0.5;
}
