// Výbava vlaků (Wi-Fi, zásuvky, kola, bezbariérovost…) z celostátních jízdních řádů SŽ (CZPTT, CIS JŘ).
// Každý vlak je jeden XML soubor; výbava je v centrálních poznámkách KJŘ:
//   <Name>CZCentralPTTNote</Name><Value>kód|BodOd||BodDo||příjezd|kalendář</Value>
// Číselník kódů: „Popis datové komunikace IS KADR – Doplněk číselníky“, kap. 2.16.
import { unzipSync } from 'fflate';

export const CZPTT_URL = (year) => `https://portal.cisjr.cz/pub/draha/celostatni/szdc/${year}/JR${year}.zip`;

/** Kódy centrálních poznámek, které aplikace zobrazuje jako výbavu vlaku. */
export const EQUIP_CODES = new Set([10, 13, 14, 17, 18, 19, 20, 22, 24, 25, 28, 29, 30, 33, 34, 36, 38, 39, 40, 46]);

/** Jízdní řád platí od prosincové změny: od 10. 12. už bereme data příštího roku. */
export function timetableYear(date = new Date()) {
  const y = date.getUTCFullYear();
  return date.getUTCMonth() === 11 && date.getUTCDate() >= 10 ? y + 1 : y;
}

/**
 * Z jednoho souboru CZPTT číslo vlaku a kódy výbavy (jen ty z EQUIP_CODES).
 * Poznámky platné jen na části trasy nebo v některé dny bereme pro celý vlak.
 */
export function parseCzptt(xml) {
  const no = /<OperationalTrainNumber>(\d+)<\/OperationalTrainNumber>/.exec(xml)?.[1];
  if (!no) return null;
  const codes = new Set();
  for (const m of xml.matchAll(/<Name>CZCentralPTTNote<\/Name>\s*<Value>(\d+)\|/g)) {
    const code = Number(m[1]);
    if (EQUIP_CODES.has(code)) codes.add(code);
  }
  return { no, codes };
}

/** { číslo vlaku: [kódy] } pro vlaky z `numbers` (Set čísel jako řetězců). */
export function railEquipment(zipBytes, numbers) {
  const out = new Map();
  const decoder = new TextDecoder();
  const files = unzipSync(zipBytes, { filter: (f) => f.name.endsWith('.xml') });
  for (const data of Object.values(files)) {
    const parsed = parseCzptt(decoder.decode(data));
    if (!parsed || !numbers.has(parsed.no)) continue;
    const set = out.get(parsed.no) ?? new Set();
    parsed.codes.forEach((c) => set.add(c));
    out.set(parsed.no, set);
  }
  return Object.fromEntries([...out].map(([no, set]) => [no, [...set].sort((a, b) => a - b)]));
}
