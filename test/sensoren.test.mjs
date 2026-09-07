import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruefeSensoren, MESSWERT_MERKMALE, normalisiereTyp } from '../src/pruefungen/sensoren.mjs';

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

test('Messwert-Merkmale enthalten nur, was sich physikalisch staendig aendert', () => {
  for (const m of ['CurrentTemperature', 'CurrentRelativeHumidity']) {
    assert.ok(MESSWERT_MERKMALE.has(m), `${m} muss auf Frische geprüft werden`);
  }
  for (const m of ['BatteryLevel', 'CurrentAmbientLightLevel', 'Consumption']) {
    assert.ok(!MESSWERT_MERKMALE.has(m), `${m} darf NICHT geprüft werden — sonst Fehlalarme`);
  }
});

test('normalisiereTyp entfernt die Leerzeichen aus humanType', () => {
  assert.equal(normalisiereTyp('Leak Sensor'), 'LeakSensor');
  assert.equal(normalisiereTyp('Garage Door Opener'), 'GarageDoorOpener');
  assert.equal(normalisiereTyp(undefined), '');
});

// --- Abgleich mit Marcs echter Anlage (Erkundungslauf 07.09.2026) ------------

test('Typen mit Leerzeichen greifen — Homebridge schreibt "Leak Sensor", nicht "LeakSensor"', () => {
  const alt = { 'sensor:l|BatteryLevel': { wert: 100, seit: VOR_7H } };
  const e = pruefeSensoren(
    [acc('l', 'Wassermelder Keller', { LeakDetected: 0, BatteryLevel: 100 }, 'Leak Sensor')],
    alt, { jetzt: JETZT, frischeStunden: 6 },
  );
  assert.deepEqual(e.befunde, [], 'griff die Liste nicht, gäbe es hier einen Fehlalarm');
});

test('Batteriestand wird NICHT auf Frische geprüft', () => {
  const alt = { 'sensor:b|BatteryLevel': { wert: 100, seit: VOR_7H } };
  const e = pruefeSensoren(
    [acc('b', 'Fenstersensor', { BatteryLevel: 100 }, 'Battery')],
    alt, { jetzt: JETZT, frischeStunden: 6 },
  );
  assert.deepEqual(e.befunde, [], 'ein Akku darf wochenlang auf 100 % stehen');
});

test('Lichtsensor wird NICHT auf Frische geprüft — nachts konstant', () => {
  const alt = { 'sensor:h|CurrentAmbientLightLevel': { wert: 0.0001, seit: VOR_7H } };
  const e = pruefeSensoren(
    [acc('h', 'Helligkeit Flur', { CurrentAmbientLightLevel: 0.0001 }, 'Light Sensor')],
    alt, { jetzt: JETZT, frischeStunden: 6 },
  );
  assert.deepEqual(e.befunde, [], 'im Winter wäre das jede Nacht ein Fehlalarm');
});

test('schwache Batterie wird gemeldet — das ist die nützliche Batterieprüfung', () => {
  const e = pruefeSensoren(
    [acc('w', 'Wassermelder Bad', { LeakDetected: 0, StatusLowBattery: 1 }, 'Leak Sensor')],
    {}, { jetzt: JETZT, frischeStunden: 6 },
  );
  assert.equal(e.befunde.length, 1);
  assert.match(e.befunde[0].titel, /Batterie schwach/);
  assert.equal(e.befunde[0].schwere, 'warnung');
});

test('volle Batterie meldet nichts', () => {
  const e = pruefeSensoren(
    [acc('w', 'Wassermelder Bad', { LeakDetected: 0, StatusLowBattery: 0 }, 'Leak Sensor')],
    {}, { jetzt: JETZT, frischeStunden: 6 },
  );
  assert.deepEqual(e.befunde, []);
});

test('StatusFault meldet eine Gerätestörung', () => {
  const e = pruefeSensoren(
    [acc('f', 'Steckdose Küche', { On: true, StatusFault: 1 }, 'Switch')],
    {}, { jetzt: JETZT, frischeStunden: 6 },
  );
  assert.equal(e.befunde.length, 1);
  assert.match(e.befunde[0].titel, /Störung/);
});

test('Temperatur und Feuchte bleiben die echte Frische-Prüfung', () => {
  const alt = {
    'sensor:t|CurrentTemperature': { wert: 21, seit: VOR_7H },
    'sensor:t|CurrentRelativeHumidity': { wert: 55, seit: VOR_7H },
  };
  const e = pruefeSensoren(
    [acc('t', 'Wohnzimmer', { CurrentTemperature: 21, CurrentRelativeHumidity: 55 })],
    alt, { jetzt: JETZT, frischeStunden: 6 },
  );
  assert.equal(e.befunde.length, 2, 'beide eingefrorenen Messwerte müssen auffallen');
});
