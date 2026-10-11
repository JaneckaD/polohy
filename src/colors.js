// Barvy podle typu vozidla: trolejbus žlutý, autobus modrý.
// text = barva písma na barvě linky (na žluté tmavé, kontrast 14:1; na modré bílé, 5,3:1),
// casing = okraj čáry na bílé mapě, passed = projetá část trasy (šedá),
// stop = korálek zastávky na čáře (tmavší odstín, aby z dálky nevypadal jako mezera v čáře).
export const TYPE_COLORS = {
  trolleybus: { main: '#ffcc00', text: '#1c1c1e', casing: '#a07f00', passed: '#8e8e93', dark: '#8e8e93', stop: '#7a5f00', stopPassed: '#636366' },
  bus: { main: '#0a66d8', text: '#ffffff', casing: '#ffffff', passed: '#8e8e93', dark: '#8e8e93', stop: '#063f86', stopPassed: '#636366' },
};

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

// Na bílém pozadí musí být čáry a ikony dost tmavé (žlutá RegioJetu ne).
const inkOf = (color) => (color === '#f2c300' ? '#8a6d00' : color);

/** Barvy trasy vlaku na mapě (podle dopravce), ve stejném tvaru jako TYPE_COLORS. */
export function trainColors(operator) {
  const ink = inkOf(operator?.color ?? '#636366');
  return { main: ink, text: operator?.text ?? '#ffffff', casing: '#ffffff', passed: '#8e8e93', dark: '#8e8e93', stop: ink, stopPassed: '#636366' };
}

/** Barvy podle vozu: u vlaku barva dopravce, jinak podle typu. */
export function applyVehicleColors(el, v) {
  if (v?.type !== 'train') return applyTypeColors(el, v?.type);
  const { color, text } = v.operator;
  const ink = inkOf(color);
  el.style.setProperty('--line-color', color);
  el.style.setProperty('--line-text', text);
  el.style.setProperty('--line-ink', ink);
  el.style.setProperty('--line-stop', ink);
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
