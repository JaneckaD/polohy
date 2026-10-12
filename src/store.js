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

export function sortLines(refs) {
  return [...refs].sort((a, b) => (parseInt(a, 10) || 999) - (parseInt(b, 10) || 999) || String(a).localeCompare(String(b)));
}
