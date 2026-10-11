import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCzptt, timetableYear } from '../scripts/rail-equip.mjs';

test('výbava vlaku z centrálních poznámek CZPTT', () => {
  const xml = `<CZPTTLocation><OperationalTrainNumber>885</OperationalTrainNumber></CZPTTLocation>
    <NetworkSpecificParameter><Name>CZCentralPTTNote</Name><Value>40|CZ36805||CZ35575||0|</Value></NetworkSpecificParameter>
    <NetworkSpecificParameter><Name>CZCentralPTTNote</Name>
      <Value>17|CZ36805||CZ35575||0|</Value></NetworkSpecificParameter>
    <NetworkSpecificParameter><Name>CZCentralPTTNote</Name><Value>44|CZ34362||CZ34755||0|</Value></NetworkSpecificParameter>
    <NetworkSpecificParameter><Name>CZIPTS</Name><Value>74|CZ35575||CZ36805||</Value></NetworkSpecificParameter>`;
  const r = parseCzptt(xml);
  assert.equal(r.no, '885');
  assert.deepEqual([...r.codes].sort(), [17, 40]); // 44 (IDS) není výbava
});

test('rok jízdního řádu se mění v prosinci', () => {
  assert.equal(timetableYear(new Date('2026-10-11T12:00:00Z')), 2026);
  assert.equal(timetableYear(new Date('2026-12-14T12:00:00Z')), 2027);
});
