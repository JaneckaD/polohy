// Barvy podle typu vozidla: trolejbus červený (barva DSZO), autobus modrý.
export const TYPE_COLORS = {
  trolleybus: { main: '#d71920', dark: '#6e0b0f' },
  bus: { main: '#1d5fd1', dark: '#0b2a63' },
};

export const TYPE_LABELS = { trolleybus: 'Trolejbus', bus: 'Autobus' };

// Stejné hranice jako legenda na dszo.cz/online: 0–2, 2–4, 4–10 a víc než 10 minut.
export function delayLevel(seconds) {
  if (seconds == null) return 'unknown';
  if (seconds < 120) return 'ok';
  if (seconds < 240) return 'minor';
  if (seconds < 600) return 'major';
  return 'severe';
}
