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
  el.classList.toggle('estimated', !!v.estimated);
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

// Značky vozů jsou prvky stránky (HTML) a mapa je při každém posunu přepočítává všechny. Na mapě proto
// držíme jen značky v okolí výřezu (s malou rezervou), ostatní se přidávají průběžně během posunu.
const VIEW_MARGIN = 0.25; // rezerva kolem výřezu (podíl jeho šířky/výšky)
const CULL_MS = 200; // jak často během posunu mapy přepočítat, které značky patří na mapu

export class VehicleLayer {
  /** @param {{ onHover?: (v, el) => void, onLeave?: () => void, onSelect?: (v) => void }} handlers */
  constructor(map, handlers = {}) {
    this.map = map;
    this.handlers = handlers;
    this.items = new Map(); // id -> { marker, el, vehicle, pos, bearing, anim, shown, offset }
    this.selectedId = null;
    this.animating = new Set();
    this.frame = null;
    this.view = null;
    let last = 0;
    map.on('move', () => {
      const now = performance.now();
      if (now - last < CULL_MS) return;
      last = now;
      this.view = null;
      this.cull();
    });
    map.on('moveend', () => {
      this.view = null;
      this.cull();
    });
  }

  get(id) {
    return this.items.get(id)?.vehicle ?? null;
  }

  /** Výřez mapy s rezervou: [západ, jih, východ, sever]. */
  viewBox() {
    if (!this.view) {
      const b = this.map.getBounds();
      const dx = (b.getEast() - b.getWest()) * VIEW_MARGIN;
      const dy = (b.getNorth() - b.getSouth()) * VIEW_MARGIN;
      this.view = [b.getWest() - dx, b.getSouth() - dy, b.getEast() + dx, b.getNorth() + dy];
    }
    return this.view;
  }

  inView(p) {
    const [w, s, e, n] = this.viewBox();
    return p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n;
  }

  /** Značka je na mapě, jen když je vůz v okolí výřezu (vybraný vůz vždy). */
  place(item) {
    const show = item.vehicle.id === this.selectedId || this.inView(item.pos);
    if (show === item.shown) return;
    item.shown = show;
    if (show) item.marker.setLngLat([item.pos.lon, item.pos.lat]).addTo(this.map);
    else item.marker.remove();
  }

  cull() {
    for (const item of this.items.values()) this.place(item);
  }

  update(vehicles) {
    const seen = new Set();
    this.view = null;

    for (const v of vehicles) {
      seen.add(v.id);
      let item = this.items.get(v.id);

      if (!item) {
        const el = createElement();
        const marker = new Marker({ element: el }).setLngLat([v.lon, v.lat]);
        item = { marker, el, vehicle: v, pos: { lat: v.lat, lon: v.lon }, bearing: null, shown: false, offset: 0, arrow: null };
        this.bindEvents(item);
        this.items.set(v.id, item);
      } else {
        const moved = distanceMeters(item.pos, v);
        if (moved >= MIN_MOVE_METERS) item.bearing = bearingDegrees(item.pos, v);
        if (moved >= 1) this.moveTo(item, { lat: v.lat, lon: v.lon });
      }

      const bearing = Number.isFinite(v.bearing) ? v.bearing : item.bearing;
      item.vehicle = { ...v, bearing };
      if (item.el.dataset.type !== v.type) item.el.dataset.type = v.type;
      if ((item.el.dataset.city ?? null) !== (v.city ?? null)) {
        if (v.city) item.el.dataset.city = v.city;
        else delete item.el.dataset.city;
      }
      setLabel(item.el, v);
      this.setBearing(item, bearing);
      this.place(item);
    }

    for (const [id, item] of this.items) {
      if (!seen.has(id)) {
        item.marker.remove();
        this.animating.delete(item);
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
        const item = this.items.get(id);
        const offset = Math.round((i - (ids.length - 1) / 2) * STACK_STEP_PX);
        if (item && item.offset !== offset) {
          item.offset = offset;
          item.marker.setOffset([0, offset]);
        }
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
    this.cull();
  }

  applySelection() {
    for (const [id, item] of this.items) {
      const selected = id === this.selectedId;
      const dimmed = this.selectedId != null && !selected;
      if (item.selected !== selected) item.el.classList.toggle('selected', (item.selected = selected));
      if (item.dimmed !== dimmed) item.el.classList.toggle('dimmed', (item.dimmed = dimmed));
    }
  }

  setBearing(item, bearing) {
    const value = bearing == null ? null : Math.round(bearing);
    if (item.arrow === value) return;
    item.arrow = value;
    const arrow = item.el.querySelector('.vehicle-arrow');
    if (value == null) {
      arrow.style.display = 'none';
    } else {
      arrow.style.display = '';
      arrow.style.transform = `rotate(${value}deg)`;
    }
  }

  // Plynulý posun značky mezi dvěma aktualizacemi: jedna společná smyčka pro všechny vozy
  // a jen pro ty, které jsou vidět (ostatní skočí rovnou na novou polohu).
  moveTo(item, target) {
    const from = item.anim ? this.current(item, performance.now()) : { ...item.pos };
    item.pos = target;
    if (!item.shown && !this.inView(target)) {
      item.anim = null;
      this.animating.delete(item);
      item.marker.setLngLat([target.lon, target.lat]);
      return;
    }
    item.anim = { from, start: performance.now() };
    this.animating.add(item);
    this.frame ??= requestAnimationFrame((now) => this.tick(now));
  }

  current(item, now) {
    const { from, start } = item.anim;
    const t = Math.min(1, (now - start) / ANIMATION_MS);
    const e = t * (2 - t);
    return { lon: from.lon + (item.pos.lon - from.lon) * e, lat: from.lat + (item.pos.lat - from.lat) * e, done: t >= 1 };
  }

  tick(now) {
    this.frame = null;
    for (const item of this.animating) {
      const p = this.current(item, now);
      if (item.shown) item.marker.setLngLat([p.lon, p.lat]);
      if (p.done) {
        item.anim = null;
        this.animating.delete(item);
      }
    }
    if (this.animating.size) this.frame = requestAnimationFrame((t) => this.tick(t));
  }
}
