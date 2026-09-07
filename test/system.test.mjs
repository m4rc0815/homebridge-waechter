import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruefeSystem } from '../src/pruefungen/system.mjs';

const grenzen = { platteProzent: 85, ramProzent: 90, tempGrad: 75 };

test('gesundes System erzeugt keine Befunde', () => {
  assert.deepEqual(pruefeSystem({ plattenProzent: 40, ramProzent: 55, tempGrad: 48, gedrosselt: false }, grenzen), []);
});

test('volle Platte ist kritisch', () => {
  const b = pruefeSystem({ plattenProzent: 92, ramProzent: 50, tempGrad: 40, gedrosselt: false }, grenzen);
  assert.equal(b.length, 1);
  assert.equal(b[0].schwere, 'kritisch');
  assert.equal(b[0].id, 'system:platte');
});

test('hoher RAM ist eine Warnung, kein Alarm', () => {
  const b = pruefeSystem({ plattenProzent: 20, ramProzent: 95, tempGrad: 40, gedrosselt: false }, grenzen);
  assert.equal(b[0].schwere, 'warnung');
});

test('Drosselung des Pi wird gemeldet', () => {
  const b = pruefeSystem({ plattenProzent: 20, ramProzent: 20, tempGrad: 82, gedrosselt: true }, grenzen);
  const ids = b.map((x) => x.id);
  assert.ok(ids.includes('system:drosselung'), 'Unterspannung frisst sonst still die SD-Karte');
  assert.ok(ids.includes('system:temperatur'));
});

test('fehlende Messwerte werden übersprungen statt falsch gemeldet', () => {
  const b = pruefeSystem({ plattenProzent: null, ramProzent: undefined, tempGrad: null, gedrosselt: false }, grenzen);
  assert.deepEqual(b, [], 'ein nicht auslesbarer Wert ist kein Fehler');
});
