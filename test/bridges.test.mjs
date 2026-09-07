import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruefeDienst, pruefeBridges } from '../src/pruefungen/bridges.mjs';

test('laufender Dienst erzeugt keinen Befund', () => {
  assert.deepEqual(pruefeDienst({ status: 'up' }), []);
});

test('toter Dienst ist kritisch', () => {
  const b = pruefeDienst({ status: 'down' });
  assert.equal(b.length, 1);
  assert.equal(b[0].schwere, 'kritisch');
  assert.equal(b[0].id, 'dienst:homebridge');
});

test('startender Dienst (pending) ist noch kein Fehler', () => {
  assert.deepEqual(pruefeDienst({ status: 'pending' }), [], 'pending heißt nur: startet gerade');
});

test('gesunde Bridges erzeugen keine Befunde', () => {
  const bridges = [
    { name: 'Hue', username: '0E:AA', status: 'ok', plugin: 'homebridge-hue' },
    { name: 'Cube', username: '0E:BB', status: 'ok', plugin: 'homebridge-plugin-ewelink-cube' },
  ];
  assert.deepEqual(pruefeBridges(bridges), []);
});

test('tote Bridge wird kritisch gemeldet, mit username als Schlüssel', () => {
  const b = pruefeBridges([{ name: 'Cube', username: '0E:BB', status: 'down', plugin: 'p' }]);
  assert.equal(b.length, 1);
  assert.equal(b[0].id, 'bridge:0E:BB');
  assert.equal(b[0].schwere, 'kritisch');
  assert.match(b[0].titel, /Cube/);
  assert.equal(b[0].daten.username, '0E:BB', 'für den Reparaturversuch nötig');
});

test('von Hand gestoppte Bridge wird NICHT gemeldet', () => {
  const b = pruefeBridges([{ name: 'Test', username: '0E:CC', status: 'down', manuallyStopped: true }]);
  assert.deepEqual(b, [], 'wer selbst stoppt, will keinen Alarm');
});

test('unbekannte Statuswerte werden als Warnung gemeldet, nicht verschluckt', () => {
  const b = pruefeBridges([{ name: 'X', username: '0E:DD', status: 'irgendwas' }]);
  assert.equal(b.length, 1);
  assert.equal(b[0].schwere, 'warnung');
});

test('Status "ok" ist gesund — Homebridge 2.4.0 meldet ok statt up', () => {
  assert.deepEqual(pruefeDienst({ status: 'ok' }), [],
    'am 07.09.2026 auf der echten Anlage nachgemessen: die API liefert "ok"');
});

test('wirklich unbekannter Status meldet weiterhin', () => {
  assert.equal(pruefeDienst({ status: 'zombie' }).length, 1);
  assert.equal(pruefeDienst({}).length, 1, 'gar keine Antwort ist ein echter Ausfall');
});
