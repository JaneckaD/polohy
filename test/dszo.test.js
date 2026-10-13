import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVehiclesPage, parseTable, mergeVehicles, formatDelay, parseTrip } from '../src/dszo.js';

// Výřez ze skutečné stránky https://www.dszo.cz/online/ (11. 10. 2026), zkrácený.
const PAGE = `
<script>
var vuz417 = new ol.Feature({geometry: new ol.geom.Point(ol.proj.fromLonLat([17.6648031,49.225424])), name: '417', line: '2', delay: '41', lowlevel: '1', station: '5601', infow: '<div class="infowindow">Vůz: <strong>417</strong><br />Linka: <strong>2</strong><br />Zpoždění: <strong>0:41</strong><br />Zastávka: <strong>Náměstí Míru</strong><br/>Řidič (služba): 2506&nbsp;(4/2)<br /></div>'});
var style417 = new ol.style.Style({ image: new ol.style.Icon({ color: [0, 255, 0, 1], src: 'symbol_fore_close5.png', rotation: 228 * Math.PI/180, scale: 0.5 }), text: new ol.style.Text({ text: '2' }) });
vuz417.setStyle(style417);
var vuz416 = new ol.Feature({geometry: new ol.geom.Point(ol.proj.fromLonLat([17.5320801,49.2021248])), name: '416', line: '2', delay: '0', lowlevel: '1', station: '6202', infow: '<div>…</div>'});
var style416 = new ol.style.Style({ image: new ol.style.Icon({ color: [0, 255, 0, 1], src: 'symbol_fore_close5.png', rotation: 208 * Math.PI/180 }), text: new ol.style.Text({ text: '2' }) });
var vuz227 = new ol.Feature({geometry: new ol.geom.Point(ol.proj.fromLonLat([17.6357422,49.2183846])), name: '227', line: '1', delay: '-20', lowlevel: '0', station: '7502', infow: '<div>…</div>'});
</script>`;

const TABLE = '{"data": [["227","1","00:48","Příluky,točna","Sportovní hala","3/1","1747"],["417","2","00:15","Náměstí Míru","Otrokovice,žel.st.","4/2","2506"]]}';

test('parses vehicles from the DSZO online page', () => {
  const v = parseVehiclesPage(PAGE);
  assert.equal(v.length, 3);
  assert.deepEqual(v[0], {
    id: '417', line: '2', type: 'trolleybus', lat: 49.225424, lon: 17.6648031, bearing: 228,
    delay: 41, lowFloor: true, stationId: '5601', features: ['lowlevel'], updated: null,
  });
  assert.equal(v[1].bearing, 208);
  // vůz bez stylu: směr neznámý, šipka se dopočítá z pohybu
  assert.equal(v[2].bearing, null);
  assert.equal(v[2].delay, -20);
});

test('joins the terminus from tabs2.php', () => {
  const merged = mergeVehicles(parseVehiclesPage(PAGE), parseTable(TABLE));
  assert.equal(merged[0].headsign, 'Otrokovice,žel.st.');
  assert.equal(merged[0].stop, 'Náměstí Míru');
  assert.equal(merged[0].delayText, '1 minuta');
  assert.equal(merged[0].duty, '4/2');
  assert.equal(merged[1].headsign, null);
  assert.equal(merged[2].headsign, 'Sportovní hala');
});

test('tolerates broken table and empty page', () => {
  assert.equal(parseTable('<html>chyba</html>').size, 0);
  assert.deepEqual(parseVehiclesPage('<html></html>'), []);
});

test('formats delay', () => {
  assert.equal(formatDelay(162), '3 minuty');
  assert.equal(formatDelay(60), '1 minuta');
  assert.equal(formatDelay(330), '6 minut');
  assert.equal(formatDelay(-20), '0 minut');
  assert.equal(formatDelay(-120), '-2 minuty');
});

test('reads vehicle equipment, type and update time', () => {
  const html = `var vuz917 = new ol.Feature({geometry: new ol.geom.Point(ol.proj.fromLonLat([17.6,49.2])), name: '917', line: '33', delay: '60', lowlevel: '1', station: '1', infow: '<div class="infowindow">Aktualizace: 2026-10-11 12:01:12<br /><img src="img/ico-ac.png" title="klimatizace"><img src="img/ico-usb.png"><span title="WiFi"></span></div>'});`;
  const [v] = parseVehiclesPage(html);
  assert.equal(v.type, 'bus');
  assert.deepEqual(v.features, ['wifi', 'ac', 'lowlevel', 'usb']);
  assert.equal(v.updated, '2026-10-11 12:01:12');
  assert.equal(parseVehiclesPage(PAGE)[0].type, 'trolleybus');
});

test('parses the trip timetable fragment', () => {
  const html = '<div><b>Linka 2 vůz 417, zpoždění: 0:41</b></div><table><tr><td>11:48</td><td>Bartošova Čtvrť A</td></tr><tr><td>11:49</td><td>Zborovská&nbsp;A</td></tr></table>12:26 Otrokovice,žel.st. C<br>';
  assert.deepEqual(parseTrip(html), [
    { time: '11:48', name: 'Bartošova Čtvrť A' },
    { time: '11:49', name: 'Zborovská A' },
    { time: '12:26', name: 'Otrokovice,žel.st. C' },
  ]);
});
