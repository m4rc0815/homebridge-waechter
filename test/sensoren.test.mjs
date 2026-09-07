import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruefeSensoren, MESSWERT_MERKMALE } from '../src/pruefungen/sensoren.mjs';

const JETZT = new Date('2026-09-07T12:00:00Z');
const VOR_7H = new Date('2026-09-07T05:00:00Z').toISOString();
const VOR_1H = new Date('2026-09-07T11:00:00Z').toISOString();

const acc = (id, name, values, humanType = 'TemperatureSensor') => ({
  uniqueId: id, serviceName: name, humanType, values,
});

test('frische Messwerte erzeugen keinen Befund', () => {
  const alt = { 'sensor:a|CurrentTemperature': { wert: 20, seit: VOR_7H } };
  const e = pruefeSensoren([acc('a', 'Bad', { CurrentTemperature: 21.5 })], alt, { jetzt: JETZT, frischeStunden: 6 });
  assert.deepEqual(e.befunde, [], 'Wert hat sich geändert — alles gut');
  assert.equal(e.sensorwerte['sensor:a|CurrentTemperature'].wert, 21.5);
});

test('seit über 6 Stunden eingefrorener Messwert wird gemeldet', () => {
  const alt = { 'sensor:a|CurrentTemperature': { wert: 20, seit: VOR_7H } };
  const e = pruefeSensoren([acc('a', 'Bad', { CurrentTemperature: 20 })], alt, { jetzt: JETZT, frischeStunden: 6 });
  assert.equal(e.befunde.length, 1);
  assert.equal(e.befunde[0].schwere, 'warnung');
  assert.match(e.befunde[0].titel, /Bad/);
  assert.equal(e.sensorwerte['sensor:a|CurrentTemperature'].seit, VOR_7H, 'seit darf NICHT zurückgesetzt werden');
});

test('erst eine Stunde eingefroren ist noch kein Fehler', () => {
  const alt = { 'sensor:a|CurrentTemperature': { wert: 20, seit: VOR_1H } };
  const e = pruefeSensoren([acc('a', 'Bad', { CurrentTemperature: 20 })], alt, { jetzt: JETZT, frischeStunden: 6 });
  assert.deepEqual(e.befunde, []);
});

test('Kontaktsensor wird NICHT auf Frische geprüft', () => {
  const alt = { 'sensor:c|ContactSensorState': { wert: 0, seit: VOR_7H } };
  const e = pruefeSensoren(
    [acc('c', 'Fenster', { ContactSensorState: 0 }, 'ContactSensor')],
    alt, { jetzt: JETZT, frischeStunden: 6 },
  );
  assert.deepEqual(e.befunde, [], 'ein Fenster darf wochenlang zu bleiben');
});

test('Gerät ohne Werte gilt als nicht erreichbar', () => {
  const e = pruefeSensoren([acc('d', 'Flur', {})], {}, { jetzt: JETZT, frischeStunden: 6 });
  assert.equal(e.befunde.length, 1);
  assert.equal(e.befunde[0].schwere, 'kritisch');
  assert.match(e.befunde[0].text, /keine Werte/i);
});

test('Gerät auf der Ausnahmeliste wird übersprungen', () => {
  const alt = { 'sensor:a|CurrentTemperature': { wert: 20, seit: VOR_7H } };
  const e = pruefeSensoren(
    [acc('a', 'Bad', { CurrentTemperature: 20 })],
    alt, { jetzt: JETZT, frischeStunden: 6, ausnahmen: ['Bad'] },
  );
  assert.deepEqual(e.befunde, []);
});

test('bekannte Messwert-Merkmale enthalten Temperatur, Feuchte, Batterie', () => {
  for (const m of ['CurrentTemperature', 'CurrentRelativeHumidity', 'BatteryLevel']) {
    assert.ok(MESSWERT_MERKMALE.has(m), `${m} muss auf Frische geprüft werden`);
  }
});
