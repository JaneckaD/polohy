// Ikony druhů dopravy (filtr a legenda), stejný styl čar jako ikony v detailu vozu.
const svg = (body, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const KIND_ICONS = {
  trolleybus: svg('<rect x="4" y="8" width="16" height="10" rx="2"/><path d="M4 13h16M9 8 7 2.5M15 8l2-5.5"/><circle cx="8" cy="18.5" r="1.3"/><circle cx="16" cy="18.5" r="1.3"/>'),
  mhd: svg('<rect x="4" y="4" width="16" height="14" rx="2"/><path d="M4 11h16M8 4v7M16 4v7"/><circle cx="8" cy="18.5" r="1.3"/><circle cx="16" cy="18.5" r="1.3"/>'),
  regional: svg('<rect x="2.5" y="6" width="19" height="11" rx="2"/><path d="M2.5 11h19M7.5 6v5M12 6v5M16.5 6v5"/><circle cx="6.5" cy="17.5" r="1.5"/><circle cx="17.5" cy="17.5" r="1.5"/>'),
  coach: svg('<path d="M2.5 17V8.5a3 3 0 0 1 3-3h11.5l4.5 5V17z"/><path d="M2.5 11h19M16 5.5V11"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>'),
  intl: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.3 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.3-3.8-8.5S9.4 5.9 12 3.5z"/>'),
  train: svg('<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14M9 21l1.5-4M15 21l-1.5-4"/><circle cx="9" cy="13.5" r="1" fill="currentColor"/><circle cx="15" cy="13.5" r="1" fill="currentColor"/>'),
};
