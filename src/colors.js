// Barvy podle druhu dopravy: trolejbus žlutý, autobus MHD modrý, regionální autobus oranžový,
// vlak podle druhu (osobní, spěšný, rychlík, mezinárodní).
// text = barva písma na barvě linky (na žluté tmavé, kontrast 14:1; na modré bílé, 5,3:1),
// casing = okraj čáry na bílé mapě, passed = projetá část trasy (šedá),
// stop = korálek zastávky na čáře (tmavší odstín, aby z dálky nevypadal jako mezera v čáře).
import { NETWORKS } from './cities.js';
import { TRAIN_KINDS } from './trains.js';

export const TYPE_COLORS = {
  trolleybus: { main: '#ffcc00', text: '#1c1c1e', casing: '#a07f00', passed: '#8e8e93', dark: '#8e8e93', stop: '#7a5f00', stopPassed: '#636366' },
  bus: { main: '#0a66d8', text: '#ffffff', casing: '#ffffff', passed: '#8e8e93', dark: '#8e8e93', stop: '#063f86', stopPassed: '#636366' },
};
// MHD dalších měst (modrá) a regionální autobusy (oranžová).
for (const [code, c] of Object.entries(NETWORKS)) {
  TYPE_COLORS[code] = { main: c.main, text: c.text, casing: '#ffffff', passed: '#8e8e93', dark: '#8e8e93', stop: c.stop, stopPassed: '#636366' };
}

/** Nastaví prvku CSS proměnné barev typu: --line-color (výplň), --line-text (písmo na ní), --line-ink (čáry a ikony na bílé). */
export function applyTypeColors(el, type) {
  const c = TYPE_COLORS[type] ?? TYPE_COLORS.bus;
  el.style.setProperty('--line-color', c.main);
  el.style.setProperty('--line-text', c.text);
  el.style.setProperty('--line-ink', type === 'trolleybus' ? '#b38900' : c.main);
  el.style.setProperty('--line-stop', c.stop);
  el.dataset.type = type === 'trolleybus' ? 'trolleybus' : 'bus';
  return el;
}

const kindColor = (kind) => TRAIN_KINDS[kind]?.color ?? '#6c6c70';

/** Barvy trasy vlaku na mapě (podle druhu vlaku), ve stejném tvaru jako TYPE_COLORS. */
export function trainColors(kind) {
  const c = kindColor(kind);
  return { main: c, text: '#ffffff', casing: '#ffffff', passed: '#8e8e93', dark: '#8e8e93', stop: c, stopPassed: '#636366' };
}

/** Barvy podle vozu: u vlaku barva druhu vlaku, jinak podle typu. */
export function applyVehicleColors(el, v) {
  if (v?.city) {
    applyTypeColors(el, v.city);
    el.dataset.type = 'bus';
    return el;
  }
  if (v?.type !== 'train') return applyTypeColors(el, v?.type);
  const c = kindColor(v.kind);
  el.style.setProperty('--line-color', c);
  el.style.setProperty('--line-text', '#ffffff');
  el.style.setProperty('--line-ink', c);
  el.style.setProperty('--line-stop', c);
  el.dataset.type = 'train';
  return el;
}

export const TYPE_LABELS = { trolleybus: 'Trolejbus', bus: 'Autobus' };

// Stejné hranice jako legenda na dszo.cz/online: 0–2, 2–4, 4–10 a víc než 10 minut.
export function delayLevel(seconds) {
  if (seconds == null) return 'unknown';
  if (seconds < 120) return 'ok';
  if (seconds < 240) return 'minor';
  if (seconds < 600) return 'major';
  return 'severe';
}
