// Dálkové autobusy FlixBus: polohy ze sledování spojů FlixBus (přes proxy /flix), jen spoje uvnitř kraje.
// Zastávky a časy spoje nese už seznam vozů, trasu po silnicích dodá /flix/route až u vybraného vozu.
import { regionContains } from './region.js';
import { formatDelay } from './dszo.js';

// FlixBus polohy obnovuje zhruba po půl minutě.
export const COACH_REFRESH_MS = 30000;

const timeFmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const pragueTime = (iso) => (iso ? timeFmt.format(new Date(iso)) : null);

/** Záznam z proxy → vůz pro mapu (stejný tvar jako ostatní autobusy), nebo null mimo kraj. */
export function parseFlixBus(b, region) {
  if (!Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return null;
  if (region && !regionContains(region, b.lon, b.lat)) return null;
  const calls = (b.calls ?? []).filter((c) => c.name);
  const ni = calls.findIndex((c) => c.seq === b.next);
  const atStop = ni >= 0 && b.arrived === true;
  return {
    id: `flix-${b.id}`,
    type: 'bus',
    city: 'flix',
    line: b.code ?? '',
    lineName: b.name ?? null,
    rideId: b.id,
    lat: b.lat,
    lon: b.lon,
    bearing: null,
    // V zastávce: ta zastávka; mezi zastávkami: naposledy projetá.
    stop: atStop ? calls[ni].name : ni > 0 ? calls[ni - 1].name : null,
    next: atStop ? (calls[ni + 1]?.name ?? null) : ni >= 0 ? calls[ni].name : null,
    from: calls[0]?.name ?? null,
    headsign: b.dir ?? calls.at(-1)?.name ?? null,
    tripNo: b.no != null ? String(b.no) : null,
    lowFloor: null,
    features: [],
    plate: null,
    delay: Number.isFinite(b.dev) ? b.dev : null,
    delayText: formatDelay(b.dev),
    updated: b.at ?? null,
    calls,
    nextIndex: ni,
    atStop,
  };
}

export async function fetchCoaches(proxy, region) {
  const res = await fetch(`${proxy}/flix`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`/flix: HTTP ${res.status}`);
  const data = await res.json();
  return (data.buses ?? []).map((b) => parseFlixBus(b, region)).filter(Boolean);
}

/** Zastávky spoje pro časovou osu: [{ name, lat, lon, time }] (čas odjezdu, v cíli příjezdu). */
export function coachTrip(v) {
  return (v.calls ?? []).map((c) => ({ name: c.name, lat: c.lat, lon: c.lon, time: c.time ?? pragueTime(c.dep ?? c.arr) }));
}

/** Kde je vůz vůči zastávkám: index zastávky (v ní nebo naposledy projeté) a jestli v ní stojí. */
export function coachPosition(v) {
  if (!(v.nextIndex >= 0)) return null;
  return v.atStop ? { current: v.nextIndex, atStop: true } : { current: v.nextIndex - 1, atStop: false };
}

/** Zakódovaná lomená čára (Google polyline, přesnost 5) → [[lon, lat], …]. */
export function decodePolyline(str) {
  const coords = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < str.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    lat += next();
    lon += next();
    coords.push([lon / 1e5, lat / 1e5]);
  }
  return coords;
}

/** Trasa spoje po silnicích: úsek i vede ze zastávky i do i + 1 ([[lon, lat], …] nebo null). */
export async function fetchCoachSegments(proxy, v) {
  try {
    const res = await fetch(`${proxy}/flix/route?id=${encodeURIComponent(v.rideId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const segments = (v.calls ?? []).slice(1).map(() => null);
    for (const s of data.segments ?? []) if (s.seq >= 1 && s.seq <= segments.length && s.line) segments[s.seq - 1] = decodePolyline(s.line);
    return segments;
  } catch {
    return null;
  }
}
