// Porovnávání názvů zastávek z DSZO a z OpenStreetMap, které se liší diakritikou,
// zkratkami a čárkami („Otrokovice,žel.st.“ vs. „Otrokovice, železniční stanice“).

export function normalizeName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function nameTokens(name) {
  return normalizeName(name).split(' ').filter(Boolean);
}

/** Zastávky DSZO mají na konci písmeno nástupiště („Zborovská A“), to pro porovnání nepotřebujeme. */
export function stripPlatform(name) {
  return String(name ?? '').replace(/\s+[A-Z]$/, '').trim();
}

/**
 * Podobnost dvou názvů 0–1. Slova se shodují, když je jedno předponou druhého,
 * takže „zel st“ odpovídá „zeleznicni stanice“.
 */
export function nameSimilarity(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const used = new Set();
  let matched = 0;
  for (const x of ta) {
    const i = tb.findIndex((y, j) => !used.has(j) && (y.startsWith(x) || x.startsWith(y)));
    if (i >= 0) {
      used.add(i);
      matched++;
    }
  }
  return matched / Math.max(ta.length, tb.length) * 0.5 + matched / Math.min(ta.length, tb.length) * 0.5;
}
