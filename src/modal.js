// Okna nad mapou (filtr, legenda, informace): na mobilu jdou za horní lištu (úchyt) stáhnout dolů a zavřít,
// stejně jako listy v iOS. Na počítači úchyt není (okno je uprostřed obrazovky).
const DESKTOP = '(min-width: 720px)';
const CLOSE_PX = 90; // stažení o tolik pixelů okno zavře
const CLOSE_SPEED = 0.6; // nebo rychlé švihnutí dolů (px/ms)

/** Zavře okno stejně jako tlačítko Hotovo (obsluha [data-close] v okně). */
function close(modal) {
  modal.querySelector('.modal-backdrop[data-close]')?.click();
}

function bind(modal) {
  const panel = modal.querySelector('.modal-panel');
  if (!panel) return;
  let start = null; // { y, t, id }
  let dy = 0;
  let last = null;

  const begin = (e) => {
    if (matchMedia(DESKTOP).matches || e.button > 0) return;
    // Táhne se za úchyt a záhlaví; v obsahu jen když je odscrollovaný nahoru a táhne se dolů (jako v iOS).
    const head = e.target.closest('.sheet-grip, .modal-head');
    if (!head && panel.scrollTop > 0) return;
    if (e.target.closest('button, a, input, select, summary, label') && !head) return;
    start = { y: e.clientY, t: performance.now(), id: e.pointerId, head: !!head, active: false };
    dy = 0;
    last = { y: e.clientY, t: start.t };
  };

  const move = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const d = e.clientY - start.y;
    if (!start.active) {
      // V obsahu se tah stane stahováním okna, až když jde jasně dolů; jinak normálně scrolluje.
      if (Math.abs(d) < 6) return;
      if (d < 0 || (!start.head && panel.scrollTop > 0)) {
        start = null;
        return;
      }
      start.active = true;
      panel.classList.add('dragging');
      panel.setPointerCapture?.(e.pointerId);
    }
    e.preventDefault();
    dy = Math.max(0, d);
    panel.style.transform = `translateY(${dy}px)`;
    last = { y: e.clientY, t: performance.now(), v: (e.clientY - last.y) / Math.max(1, performance.now() - last.t) };
  };

  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const active = start.active;
    start = null;
    if (!active) return;
    panel.classList.remove('dragging');
    if (dy > CLOSE_PX || (last?.v ?? 0) > CLOSE_SPEED) {
      // Dojede dolů pod okraj obrazovky a pak se zavře.
      panel.style.transform = `translateY(${panel.offsetHeight + 40}px)`;
      setTimeout(() => {
        close(modal);
        panel.style.transform = '';
      }, 200);
    } else {
      panel.style.transform = '';
    }
  };

  panel.addEventListener('pointerdown', begin);
  panel.addEventListener('pointermove', move);
  panel.addEventListener('pointerup', end);
  panel.addEventListener('pointercancel', end);
  // Kliknutí po stažení (prst skončí na tlačítku Hotovo) nic neudělá navíc; okno se zavírá samo.
  panel.addEventListener('touchmove', (e) => start?.active && e.cancelable && e.preventDefault(), { passive: false });
}

/** Stahování dolů pro všechna okna .modal na stránce. */
export function initModals(root = document) {
  for (const modal of root.querySelectorAll('.modal')) bind(modal);
}
