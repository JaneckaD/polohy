// Malý sdílený stav aplikace s ukládáním do localStorage (filtr, poslední polohy vozů).

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* soukromé okno nebo plné úložiště: nevadí */
  }
}

const listeners = new Set();

export const store = {
  filter: { type: 'all', lines: [], ...load('mhd.filter', {}), delayed: false },
  vehicles: [],

  setFilter(patch) {
    this.filter = { ...this.filter, ...patch };
    save('mhd.filter', this.filter);
    this.emit();
  },

  setVehicles(list) {
    this.vehicles = list;
    save('mhd.vehicles', { at: Date.now(), list });
    this.emit();
  },

  /** Polohy z minulého spuštění, pokud nejsou starší než maxAge ms. */
  cachedVehicles(maxAge = 3 * 60 * 1000) {
    const c = load('mhd.vehicles', null);
    return c && Date.now() - c.at < maxAge ? c.list : null;
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  emit() {
    for (const fn of listeners) fn(this);
  },
};

export function filterActive(f) {
  return f.type !== 'all' || f.lines.length > 0;
}

export function matchesFilter(v, f) {
  if (f.type !== 'all' && v.type !== f.type) return false;
  if (f.lines.length && !f.lines.includes(v.line)) return false;
  return true;
}

export function sortLines(refs) {
  return [...refs].sort((a, b) => (parseInt(a, 10) || 999) - (parseInt(b, 10) || 999) || String(a).localeCompare(String(b)));
}
