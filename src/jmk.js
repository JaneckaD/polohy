// Živé polohy IDS JMK: veřejný proud polohových dat KORDIS JMK z otevřených dat Brna (data.brno.cz,
// licence CC BY, zdroj KORDIS JMK). Proud posílá každý vůz zhruba po půl minutě, proto si polohy držíme
// a mapě je předáváme po dávkách. Spoj (zastávky, časy, dopravce) se dohledá v datech vyhledávání spojení
// podle linky, poslední projeté a cílové zastávky (čísla uzlů zastávek jsou stejná jako v GTFS KORDIS).
import { formatDelay } from './dszo.js';
import { cityStopName, lineLabel } from './cities.js';
import { regionContains } from './region.js';

export const JMK_STREAM = 'wss://gis.brno.cz/geoevent/ws/services/Kordis_stream/StreamServer/subscribe';
// Jen sloupce, které aplikace potřebuje (menší přenos).
const FIELDS = 'ID,VType,LineName,Lat,Lng,Bearing,Course,LF,Delay,LastStopID,FinalStopID,IsInactive,TimeUpdated';
const FLUSH_MS = 3000; // jak často předat nové polohy mapě
const STALE_MS = 3 * 60 * 1000; // vůz, o kterém 3 minuty nepřišla zpráva, z mapy zmizí
const SAVE_MS = 20000; // jak často uložit polohy pro rychlý start
const STORE_KEY = 'mhd.jmk';

// Druhy vozů v proudu: 0 tramvaj, 1 trolejbus, 2 autobus MHD Brno, 4 regionální autobus (i MHD ostatních
// měst), 5 vlak (vlaky bere aplikace z jiného zdroje).
const VTYPES = { 0: ['tram', 'brno'], 1: ['trolleybus', 'brno'], 2: ['bus', 'brno'], 4: ['bus', 'jmk'] };
const JMK_NETS = new Set(['jmk', 'brno', 'jmkmhd']);

const hhmm = (m) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
const dayIndex = (start, date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);

function distM(lat1, lon1, lat2, lon2) {
  const kx = 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.hypot((lat1 - lat2) * 110574, (lon1 - lon2) * kx);
}

// Spoje sítí IDS JMK podle čísla linky (z dat vyhledávání spojení), postavené jednou.
const lineIndex = new WeakMap();
function linesOf(P) {
  if (!lineIndex.has(P)) {
    const idx = new Map();
    for (const trip of P.trips) {
      if (!JMK_NETS.has(trip.pattern.c)) continue;
      if (!idx.has(trip.pattern.r)) idx.set(trip.pattern.r, []);
      idx.get(trip.pattern.r).push(trip);
    }
    lineIndex.set(P, idx);
  }
  return lineIndex.get(P);
}

const stopOfNode = (P, node) => (node != null ? P?.nodes?.[node] : undefined);
const sameStop = (P, a, b) => a === b || (a != null && b != null && P.stops[a].name === P.stops[b].name);

/**
 * Spoj, kterým vůz jede: stejná linka a cíl, poslední projetá zastávka je ve spoji a vůz u ní podle
 * jízdního řádu a zpoždění byl před chvílí. Vůz na výchozí zastávce může čekat na odjezd až hodinu.
 * Když cíl nesedí na žádný spoj (výluka, mimořádný cíl), vezme se spoj stejné linky jen podle zastávky a času.
 * Vrací { trip, k, shift } nebo null.
 */
export function matchJmkTrip(P, a, date, min) {
  const last = stopOfNode(P, a.LastStopID);
  if (!P || last == null) return null;
  const final = stopOfNode(P, a.FinalStopID);
  return findTrip(P, a, date, min, last, final, 10) ?? (final != null ? findTrip(P, a, date, min, last, null, 3) : null);
}

function findTrip(P, a, date, min, last, final, maxScore) {
  const di = dayIndex(P.startDate, date);
  const delay = Number.isFinite(a.Delay) ? a.Delay : 0;
  let best = null;
  for (const trip of linesOf(P).get(String(a.LineName)) ?? []) {
    const s = trip.pattern.s;
    if (final != null && !sameStop(P, s.at(-1), final)) continue;
    for (const [day, shift] of [[di, 0], [di - 1, 1440]]) {
      if (day < 0 || day >= P.days || trip.mask[day] !== '1') continue;
      const t = min + shift;
      if (t < trip.arr[0] - 70 || t > trip.times.at(-1) + delay + 30) continue;
      for (let k = 0; k < s.length; k++) {
        if (!sameStop(P, s[k], last)) continue;
        // Minuty od (zpožděného) odjezdu z poslední zastávky; vůz má být na cestě k další.
        const diff = t - (trip.times[k] + delay);
        const span = k + 1 < s.length ? trip.arr[k + 1] - trip.times[k] : 2;
        const early = k === 0 ? 60 : 1; // na výchozí zastávce čeká na odjezd
        const score = diff < -early ? -early - diff : diff > span + 2 ? diff - span - 2 : 0;
        // Při shodě vyhraje spoj, jehož odjezd je nejblíž (čekající vůz pojede nejbližším spojem).
        const rank = score + Math.abs(diff) / 1000;
        if (score <= maxScore && (!best || rank < best.rank)) best = { score, rank, trip, k, shift, waiting: diff < 0 };
      }
    }
  }
  return best;
}

// Trasy vzorů spojů po silnicích (src/estimated.js), u tramvají rovně mezi zastávkami.
let segmentsFor = () => null;
export function setJmkSegments(fn) {
  segmentsFor = fn;
}

/** Zastávky a trasa spoje pro vůz (sdílené všemi vozy na stejném spoji). */
const callsCache = new WeakMap();
function tripCalls(P, trip, net, tram) {
  if (!callsCache.has(trip)) {
    const pat = trip.pattern;
    const calls = pat.s.map((si, i) => ({ seq: i + 1, name: cityStopName(net, P.stops[si].name), lat: P.stops[si].lat, lon: P.stops[si].lon, time: hhmm(trip.times[i]) }));
    const segments = tram ? calls.slice(1).map((c, i) => (c.lat != null && calls[i].lat != null ? [[calls[i].lon, calls[i].lat], [c.lon, c.lat]] : null)) : segmentsFor(P, pat);
    callsCache.set(trip, { calls, segments });
  }
  return callsCache.get(trip);
}

/** Zpráva z proudu → vůz pro mapu (stejný tvar jako ostatní vozy), nebo null (vlak, neaktivní, mimo oblast). */
export function parseJmk(a, { P = null, region = null, date, min } = {}) {
  const vt = VTYPES[a.VType];
  if (!vt || a.IsInactive === 'true' || !Number.isFinite(a.Lat) || !Number.isFinite(a.Lng)) return null;
  if (region && !regionContains(region, a.Lng, a.Lat)) return null;
  const [type, baseNet] = vt;
  const line = String(a.LineName ?? '');
  const match = P && date ? matchJmkTrip(P, a, date, min) : null;
  const pat = match?.trip.pattern;
  // Regionální linka, nebo MHD jiného města (podle jízdního řádu linky).
  const city = baseNet === 'brno' ? 'brno' : pat?.c === 'jmkmhd' ? 'jmkmhd' : 'jmk';
  const name = (node) => {
    const i = stopOfNode(P, node);
    return i != null ? P.stops[i].name : null;
  };
  const delay = Number.isFinite(a.Delay) ? Math.round(a.Delay * 60) : null;
  const v = {
    id: `jmk-${a.ID}`,
    type,
    city,
    line: lineLabel(line),
    lat: a.Lat,
    lon: a.Lng,
    bearing: Number.isFinite(a.Bearing) && a.Bearing >= 0 ? a.Bearing : null,
    stop: name(a.LastStopID) ? cityStopName(city, name(a.LastStopID)) : null,
    next: null,
    from: null,
    headsign: name(a.FinalStopID) ? cityStopName(city, name(a.FinalStopID)) : null,
    rawStop: name(a.LastStopID),
    rawHeadsign: name(a.FinalStopID),
    tripNo: null,
    course: a.Course ? String(a.Course) : null,
    operatorName: pat?.o ?? null,
    lowFloor: a.LF === 'true' ? true : a.LF === 'false' ? false : null,
    features: a.LF === 'true' ? ['lowlevel'] : [],
    plate: null,
    delay,
    delayText: formatDelay(delay),
    updated: Number.isFinite(a.TimeUpdated) ? new Date(a.TimeUpdated).toISOString() : null,
    live: 'jmk',
  };
  if (match) {
    const { calls, segments } = tripCalls(P, match.trip, city, type === 'tram');
    const k = match.k;
    const at = calls[k];
    // U poslední projeté zastávky (do 70 m), nebo už na cestě k další.
    const atStop = k === calls.length - 1 || match.waiting || (at.lat != null && distM(a.Lat, a.Lng, at.lat, at.lon) < 70);
    const ni = atStop ? k : k + 1;
    Object.assign(v, {
      tripId: match.trip.id,
      from: calls[0].name,
      next: atStop ? (calls[ni + 1]?.name ?? null) : calls[ni].name,
      headsign: v.headsign ?? calls.at(-1).name,
      calls,
      nextIndex: ni,
      atStop,
      segments,
    });
  }
  return v;
}

function loadSaved() {
  try {
    const c = JSON.parse(localStorage.getItem(STORE_KEY));
    return c && Date.now() - c.at < STALE_MS ? c.list : [];
  } catch {
    return [];
  }
}

/**
 * Spojení s proudem: drží poslední zprávu o každém voze a po dávkách volá onChange(seznam vozů).
 * context() vrací { P, region, date, min } pro dohledání spojů.
 */
export class JmkLive {
  constructor({ onChange, context, snapshot = null }) {
    this.onChange = onChange;
    this.context = context;
    this.snapshot = snapshot; // () => Promise<{ at, list } | null>: poslední dávka z proxy pro rychlý start
    this.raw = new Map(); // ID -> { a, at }
    this.built = new Map(); // ID -> vůz
    this.dirty = false;
    this.ws = null;
    this.running = false;
    this.retry = 0;
    this.lastMessage = 0;
    this.lastSave = 0;
    this.failedSince = null;
    // Polohy z minula (do 3 minut), ať mapa nečeká na první zprávy.
    const now = Date.now();
    for (const a of loadSaved()) this.raw.set(a.ID, { a, at: now - 60000 });
    this.dirty = this.raw.size > 0;
  }

  /**
   * Nejsou živé polohy? (true, dokud nepřijde první dávka proudu, ta chodí jen jednou za půl minuty,
   * a když se proud nepřipojí: vozy IDS JMK se pak odhadnou podle jízdního řádu, ať je mapa plná hned.)
   */
  get down() {
    if (!this.raw.size) return true;
    return this.failedSince != null && Date.now() - this.failedSince > 45000 && Date.now() - this.lastMessage > STALE_MS;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.connect();
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
    this.flush();
    // Proud posílá polohy jen jednou za půl minuty: do té doby vozy z poslední dávky, kterou drží proxy.
    if (this.snapshot && Date.now() - this.lastMessage > 20000) {
      this.snapshot().then((snap) => {
        if (!snap?.list?.length || Date.now() - snap.at > STALE_MS) return;
        this.ingest(snap.list, snap.at);
      });
    }
  }

  /** Zprávy proudu (z proxy nebo uložené) s časem příjmu; novější zprávy o stejném voze nepřepíší. */
  ingest(list, at) {
    let changed = false;
    for (const j of list) {
      const a = j?.attributes ?? j;
      if (!a || a.ID == null) continue;
      if (!Number.isFinite(a.Lat) && j.geometry) {
        a.Lat = j.geometry.y;
        a.Lng = j.geometry.x;
      }
      const old = this.raw.get(a.ID);
      if (old && old.at >= at) continue;
      this.raw.set(a.ID, { a, at });
      this.built.delete(a.ID);
      changed = true;
    }
    if (changed) {
      this.dirty = true;
      this.flush();
    }
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    clearTimeout(this.reconnect);
    this.ws?.close();
    this.ws = null;
  }

  connect() {
    if (!this.running || typeof WebSocket === 'undefined') return;
    let ws;
    try {
      ws = new WebSocket(JMK_STREAM);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ filter: { outFields: FIELDS } }));
    ws.onmessage = (e) => {
      let j;
      try {
        j = JSON.parse(e.data);
      } catch {
        return;
      }
      const a = j?.attributes;
      if (!a || a.ID == null) return;
      if (!Number.isFinite(a.Lat) && j.geometry) {
        a.Lat = j.geometry.y;
        a.Lng = j.geometry.x;
      }
      this.retry = 0;
      this.failedSince = null;
      this.lastMessage = Date.now();
      this.raw.set(a.ID, { a, at: this.lastMessage });
      this.built.delete(a.ID);
      this.dirty = true;
    };
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.failedSince ??= Date.now();
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  scheduleReconnect() {
    if (!this.running) return;
    const delay = [2000, 5000, 10000, 30000][Math.min(this.retry++, 3)];
    clearTimeout(this.reconnect);
    this.reconnect = setTimeout(() => this.connect(), delay);
  }

  /** Spoje se dohledávají z dat vyhledávání: po jejich načtení se vozy sestaví znovu. */
  rebuild() {
    this.built.clear();
    this.dirty = true;
    this.flush();
  }

  flush() {
    const now = Date.now();
    for (const [id, r] of this.raw) {
      if (now - r.at > STALE_MS) {
        this.raw.delete(id);
        this.built.delete(id);
        this.dirty = true;
      }
    }
    if (!this.dirty) return;
    this.dirty = false;
    const ctx = this.context();
    for (const [id, r] of this.raw) if (!this.built.has(id)) this.built.set(id, parseJmk(r.a, ctx));
    this.onChange([...this.built.values()].filter(Boolean));
    if (now - this.lastSave > SAVE_MS && this.raw.size) {
      this.lastSave = now;
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ at: now, list: [...this.raw.values()].map((r) => r.a) }));
      } catch {
        /* plné úložiště nevadí */
      }
    }
  }
}
