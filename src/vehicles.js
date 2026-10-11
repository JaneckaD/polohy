import { Marker } from 'maplibre-gl';

// Vrstva vozidel: kolečko s číslem linky a malou šipkou ve směru jízdy.
// Směr bereme z dat (heading), a když chybí, dopočítáme ho z posledních dvou poloh vozu.

const MIN_MOVE_METERS = 12;
const ANIMATION_MS = 1500;

function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearingDegrees(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function createElement(vehicle) {
  const el = document.createElement('div');
  el.className = 'vehicle';
  el.innerHTML = '<div class="vehicle-arrow"></div><div class="vehicle-dot"></div>';
  el.querySelector('.vehicle-dot').textContent = vehicle.line;
  return el;
}

export class VehicleLayer {
  /** @param {{ onHover?: (v, el) => void, onLeave?: () => void, onSelect?: (v) => void }} handlers */
  constructor(map, handlers = {}) {
    this.map = map;
    this.handlers = handlers;
    this.items = new Map(); // id -> { marker, el, vehicle, pos, bearing, anim }
    this.selectedId = null;
  }

  get(id) {
    return this.items.get(id)?.vehicle ?? null;
  }

  update(vehicles) {
    const seen = new Set();

    for (const v of vehicles) {
      seen.add(v.id);
      let item = this.items.get(v.id);

      if (!item) {
        const el = createElement(v);
        const marker = new Marker({ element: el }).setLngLat([v.lon, v.lat]).addTo(this.map);
        item = { marker, el, vehicle: v, pos: { lat: v.lat, lon: v.lon }, bearing: null };
        this.bindEvents(item);
        this.items.set(v.id, item);
      } else {
        const dot = item.el.querySelector('.vehicle-dot');
        if (dot.textContent !== v.line) dot.textContent = v.line;
        if (distanceMeters(item.pos, v) >= MIN_MOVE_METERS) {
          item.bearing = bearingDegrees(item.pos, v);
        }
        this.animate(item, { lat: v.lat, lon: v.lon });
      }

      const bearing = Number.isFinite(v.bearing) ? v.bearing : item.bearing;
      item.vehicle = { ...v, bearing };
      item.el.dataset.type = v.type;
      this.setBearing(item, bearing);
    }

    for (const [id, item] of this.items) {
      if (!seen.has(id)) {
        item.marker.remove();
        this.items.delete(id);
      }
    }
    this.applySelection();
  }

  bindEvents(item) {
    const el = item.el;
    // Najetí myší jen na zařízeních, která umí hover (počítač); na mobilu stačí klepnutí.
    el.addEventListener('mouseenter', () => {
      if (matchMedia('(hover: hover)').matches) this.handlers.onHover?.(item.vehicle, el);
    });
    el.addEventListener('mouseleave', () => this.handlers.onLeave?.());
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onSelect?.(item.vehicle);
    });
  }

  select(id) {
    this.selectedId = id;
    this.applySelection();
  }

  applySelection() {
    for (const [id, item] of this.items) {
      item.el.classList.toggle('selected', id === this.selectedId);
      item.el.classList.toggle('dimmed', this.selectedId != null && id !== this.selectedId);
    }
  }

  setBearing(item, bearing) {
    const arrow = item.el.querySelector('.vehicle-arrow');
    if (bearing == null) {
      arrow.style.display = 'none';
    } else {
      arrow.style.display = '';
      arrow.style.transform = `rotate(${bearing}deg)`;
    }
  }

  // Plynulý posun značky mezi dvěma aktualizacemi.
  animate(item, target) {
    const from = { ...item.pos };
    item.pos = target;
    if (item.anim) cancelAnimationFrame(item.anim);
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / ANIMATION_MS);
      const e = t * (2 - t);
      item.marker.setLngLat([
        from.lon + (target.lon - from.lon) * e,
        from.lat + (target.lat - from.lat) * e,
      ]);
      item.anim = t < 1 ? requestAnimationFrame(step) : null;
    };
    item.anim = requestAnimationFrame(step);
  }
}
