import { test } from 'node:test';
import assert from 'node:assert/strict';
import { befund, SCHWERE, istKritisch, sortiereNachSchwere } from '../src/befund.mjs';

test('befund erzeugt einen vollständigen Datensatz', () => {
  const b = befund({ bereich: 'bridge', schluessel: '0E:11:22', schwere: 'kritisch', titel: 'Bridge tot', text: 'Details' });
  assert.equal(b.id, 'bridge:0E:11:22');
  assert.equal(b.schwere, 'kritisch');
  assert.equal(b.titel, 'Bridge tot');
});

test('unbekannter Schweregrad wird abgewiesen', () => {
  assert.throws(() => befund({ bereich: 'x', schluessel: 'y', schwere: 'egal', titel: 't' }), /Schweregrad/);
});

test('istKritisch trennt Alarm von Hinweis', () => {
  assert.equal(istKritisch({ schwere: SCHWERE.kritisch }), true);
  assert.equal(istKritisch({ schwere: SCHWERE.warnung }), false);
});

test('sortiereNachSchwere stellt Kritisches nach vorn', () => {
  const liste = [
    { schwere: 'hinweis', titel: 'c' },
    { schwere: 'kritisch', titel: 'a' },
    { schwere: 'warnung', titel: 'b' },
  ];
  assert.deepEqual(sortiereNachSchwere(liste).map((x) => x.titel), ['a', 'b', 'c']);
});
