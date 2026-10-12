// Malý sdílený stav aplikace s ukládáním do localStorage (filtr, poslední polohy vozů).
import { normalizeFilter } from './filtering.js';

export { filterActive, matchesFilter } from './filtering.js';

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
  // Filtr se pamatuje v prohlížeči (i po zavření aplikace).
  filter: normalizeFilter(load('mhd.filter', {})),
  vehicles: [],
  trains: [],
  cityBuses: [],
  coaches: [],
  // Autobusy bez živé polohy: poloha odhadem podle jízdního řádu (src/estimated.js).
  estimated: [],
  // Živé polohy IDS JMK (src/jmk.js): tramvaje, trolejbusy a autobusy MHD i regionální linky.
  jmk: [],

  setFilter(patch) {
    this.filter = normalizeFilter({ ...this.filter, ...patch });
    save('mhd.filter', this.filter);
    this.emit();
  },

  setVehicles(list) {
    this.vehicles = list;
    save('mhd.vehicles', { at: Date.now(), list });
    this.emit();
  },

  setCityBuses(list) {
    this.cityBuses = list;
    this.emit();
  },

  setCoaches(list) {
    this.coaches = list;
    this.emit();
  },

  setTrains(list) {
    this.trains = list;
    this.emit();
  },

  setEstimated(list) {
    this.estimated = list;
    this.emit();
  },

  setJmk(list) {
    this.jmk = list;
    this.emit();
  },

  /** Všechny vozy a vlaky na mapě. */
  allVehicles() {
    return [...this.vehicles, ...this.cityBuses, ...this.jmk, ...this.coaches, ...this.estimated, ...this.trains];
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

  // Překreslení se sloučí do jednoho snímku (víc zdrojů často přijde naráz).
  emit() {
    if (this.pending) return;
    this.pending = true;
    const run = () => {
      this.pending = false;
      for (const fn of listeners) fn(this);
    };
    if (typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && !document.hidden) requestAnimationFrame(run);
    else setTimeout(run, 0);
  },
};

export function sortLines(refs) {
  return [...refs].sort((a, b) => (parseInt(a, 10) || 999) - (parseInt(b, 10) || 999) || String(a).localeCompare(String(b)));
}
