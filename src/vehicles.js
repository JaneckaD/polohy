import { Marker } from 'maplibre-gl';
import { TRAIN_KINDS } from './trains.js';
import { NETWORKS } from './cities.js';

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

function createElement() {
  const el = document.createElement('div');
  el.className = 'vehicle';
  el.innerHTML = '<div class="vehicle-arrow"></div><div class="vehicle-dot"></div>';
  return el;
}

// Obsah značky: u autobusu a trolejbusu číslo linky, u vlaku druh (Os, R…) v kolečku barvy druhu
// (jako značky DSZO). Číslo vlaku a dopravce jsou až v detailu.
function setLabel(el, v) {
  // Linka DSZO s písmenem spoje z jízdního řádu (8d = končí ve vozovně u Baťovy nemocnice).
  const key = v.type === 'train' ? v.code : `${v.line}${v.mark ?? ''}`;
  if (el.dataset.label === key) return;
  el.dataset.label = key;
  const dot = el.querySelector('.vehicle-dot');
  dot.textContent = key;
  // Trojmístná čísla regionálních linek se do kolečka vejdou jen menším písmem.
  el.classList.toggle('long-label', String(key ?? '').length >= 3);
  if (v.type !== 'train') {
    // MHD jiného města a regionální autobusy: barva města nebo dopravce.
    const net = NETWORKS[v.city];
    if (net) {
      el.style.setProperty('--vehicle-color', net.main);
      el.style.setProperty('--vehicle-text', net.text);
    } else {
      el.style.removeProperty('--vehicle-color');
      el.style.removeProperty('--vehicle-text');
    }
    return;
  }
  el.title = `${v.code} ${v.number} · ${v.operator?.short ?? ''}`;
  el.style.setProperty('--vehicle-color', TRAIN_KINDS[v.kind]?.color ?? '#6c6c70');
  el.style.setProperty('--vehicle-text', '#ffffff');
}

const STACK_GRID = 0.0004; // ~40 m
const STACK_STEP_PX = 30;

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
        const el = createElement();
        const marker = new Marker({ element: el }).setLngLat([v.lon, v.lat]).addTo(this.map);
        item = { marker, el, vehicle: v, pos: { lat: v.lat, lon: v.lon }, bearing: null };
        this.bindEvents(item);
        this.items.set(v.id, item);
      } else {
        if (distanceMeters(item.pos, v) >= MIN_MOVE_METERS) {
          item.bearing = bearingDegrees(item.pos, v);
        }
        this.animate(item, { lat: v.lat, lon: v.lon });
      }

      const bearing = Number.isFinite(v.bearing) ? v.bearing : item.bearing;
      item.vehicle = { ...v, bearing };
      item.el.dataset.type = v.type;
      if (v.city) item.el.dataset.city = v.city;
      else delete item.el.dataset.city;
      setLabel(item.el, v);
      this.setBearing(item, bearing);
    }

    for (const [id, item] of this.items) {
      if (!seen.has(id)) {
        item.marker.remove();
        this.items.delete(id);
      }
    }
    this.stackTrains(vehicles);
    this.applySelection();
  }

  // Vlaky stojící ve stejné stanici mají stejnou polohu: značky se seřadí pod sebe, ať jdou všechny vidět.
  stackTrains(vehicles) {
    const groups = new Map();
    for (const v of vehicles) {
      if (v.type !== 'train') continue;
      const key = `${Math.round(v.lat / STACK_GRID)}:${Math.round(v.lon / STACK_GRID)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(v.id);
    }
    for (const ids of groups.values()) {
      ids.sort();
      ids.forEach((id, i) => {
        this.items.get(id)?.marker.setOffset([0, Math.round((i - (ids.length - 1) / 2) * STACK_STEP_PX)]);
      });
    }
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
