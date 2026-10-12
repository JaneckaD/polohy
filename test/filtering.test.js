import test from 'node:test';
import assert from 'node:assert/strict';
import { describe, matchesFilter, normalizeFilter, filterCount, describeFilter, EMPTY_FILTER } from '../src/filtering.js';
import { carrierName } from '../src/cities.js';

const dszoTrolley = { id: '101', type: 'trolleybus', line: '3' };
const dszoBus = { id: '301', type: 'bus', line: '31' };
const kmBus = { id: 'km-1', type: 'bus', city: 'km', line: '4', operator: null };
const vmBus = { id: 'vm-1', type: 'bus', city: 'vm', line: '1', operator: 'TQM' };
const regional = { id: 'csad-1', type: 'bus', city: 'csad', line: '371' };
const flix = { id: 'flix-1', type: 'bus', city: 'flix', line: '856' };
const rj = { id: 'rj-1', type: 'bus', city: 'rj', line: 'RJ' };
const os = { id: 'vlak-Os-1', type: 'train', kind: 'os', operator: { short: 'ČD' } };
const rjTrain = { id: 'vlak-RJ-2', type: 'train', kind: 'r', operator: { short: 'RegioJet' } };
const all = [dszoTrolley, dszoBus, kmBus, vmBus, regional, flix, rj, os, rjTrain];
const shown = (patch) => all.filter((v) => matchesFilter(v, { ...EMPTY_FILTER, ...patch })).map((v) => v.id);

test('filtr: druh, město a dopravce vozu', () => {
  assert.deepEqual(describe(dszoTrolley), { kind: 'trolleybus', network: 'zl', carrier: 'DSZO', region: 'zlk' });
  assert.deepEqual(describe(vmBus), { kind: 'mhd', network: 'vm', carrier: 'TQM', region: 'zlk' });
  assert.equal(describe(regional).kind, 'regional');
  assert.equal(describe(regional).carrier, 'ČSAD BUS UH');
  assert.equal(describe(rj).kind, 'coach');
  assert.equal(describe(rj).carrier, 'RegioJet');
  assert.equal(describe(os).carrier, 'ČD');
  assert.equal(carrierName('TQM–MHDVM'), 'TQM');
  assert.equal(carrierName('ZDS-Psota'), 'ZDS-Psota');
  assert.equal(carrierName('ARRIVA, pr. Zlín'), 'Arriva');
});

test('filtr: nic nevybráno = vše, skupiny se kombinují', () => {
  assert.equal(shown({}).length, all.length);
  assert.deepEqual(shown({ kinds: ['coach'] }), ['flix-1', 'rj-1']);
  assert.deepEqual(shown({ kinds: ['train'], trainKinds: ['r'] }), ['vlak-RJ-2']);
  // Dopravce platí napříč druhy: RegioJet autobus i vlak.
  assert.deepEqual(shown({ carriers: ['RegioJet'] }), ['rj-1', 'vlak-RJ-2']);
  // Město: jen MHD toho města (ostatní druhy, jen když jsou výslovně vybrané).
  assert.deepEqual(shown({ networks: ['vm'] }), ['vm-1']);
  assert.deepEqual(shown({ networks: ['vm'], kinds: ['mhd', 'train'] }), ['vm-1', 'vlak-Os-1', 'vlak-RJ-2']);
  assert.deepEqual(shown({ networks: ['zl', 'km'] }), ['101', '301', 'km-1']);
  assert.equal(shown({ regions: ['zlk'] }).length, all.length);
  // Druh vlaku nechá ostatní druhy být.
  assert.equal(shown({ trainKinds: ['os'] }).length, all.length - 1);
});

test('filtr: převod uloženého filtru ze starší verze', () => {
  assert.deepEqual(normalizeFilter({ type: 'train', lines: [], trainKinds: ['os'], operators: ['ČD'], delayed: false }), { ...EMPTY_FILTER, kinds: ['train'], trainKinds: ['os'], carriers: ['ČD'] });
  assert.equal(normalizeFilter({ type: 'all', lines: ['3'] }).lines, undefined);
  assert.deepEqual(normalizeFilter({ type: 'bus' }).kinds, ['mhd', 'regional', 'coach']);
  assert.deepEqual(normalizeFilter(null ?? {}), EMPTY_FILTER);
  const f = { ...EMPTY_FILTER, kinds: ['coach'], carriers: ['FlixBus'] };
  assert.equal(filterCount(f), 2);
  assert.equal(describeFilter(f), 'dálkové autobusy · FlixBus');
});
