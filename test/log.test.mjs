import { test } from 'node:test';
import assert from 'node:assert/strict';
import { werteLogAus, RAUSCHEN } from '../src/pruefungen/log.mjs';

test('ruhiger Log erzeugt keinen Befund', () => {
  assert.deepEqual(werteLogAus(['Homebridge is running on port 51826.', 'Loaded plugin: homebridge-hue']), []);
});

test('Strommess-Rauschen wird herausgefiltert', () => {
  const zeilen = Array.from({ length: 200 }, () => '[eWeLink] Steckdose current power: 42 W');
  assert.deepEqual(werteLogAus(zeilen), [], 'das 5-Sekunden-Rauschen darf nichts auslösen');
});

test('TypeError wird als kritisch gemeldet', () => {
  const b = werteLogAus(["TypeError: Cannot read properties of undefined (reading 'logManager')"]);
  assert.equal(b.length, 1);
  assert.equal(b[0].schwere, 'kritisch');
});

test('gleiche Fehlerart wird zu EINEM Befund gebündelt', () => {
  const b = werteLogAus(Array.from({ length: 40 }, () => 'ERROR: connection refused'));
  assert.equal(b.length, 1, '40 gleiche Zeilen sind ein Problem, nicht vierzig');
  assert.match(b[0].text, /40/, 'die Anzahl gehört in den Text');
});

test('unterschiedliche Fehler bleiben getrennt', () => {
  const b = werteLogAus(['ERROR: connection refused', 'TypeError: x is not a function']);
  assert.equal(b.length, 2);
});

test('RAUSCHEN-Muster sind als Liste exportiert und erweiterbar', () => {
  assert.ok(Array.isArray(RAUSCHEN));
  assert.ok(RAUSCHEN.some((r) => r.test('current power: 5 W')));
});
