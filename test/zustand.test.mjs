import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leererZustand, verarbeite } from '../src/zustand.mjs';

const b = (id, schwere = 'kritisch') => ({ id, schwere, titel: id, text: '', bereich: 'test', daten: {} });
const JETZT = new Date('2026-09-07T10:00:00Z');

test('erster Fund wird noch NICHT gemeldet (Entprellung)', () => {
  const e = verarbeite(leererZustand(), [b('bridge:A')], { jetzt: JETZT, entprellung: 2 });
  assert.deepEqual(e.neu, [], 'ein einzelner Aussetzer darf nicht sofort alarmieren');
  assert.equal(e.zustand.verdacht['bridge:A'].laeufe, 1);
});

test('zweiter Fund in Folge wird gemeldet', () => {
  const e1 = verarbeite(leererZustand(), [b('bridge:A')], { jetzt: JETZT, entprellung: 2 });
  const e2 = verarbeite(e1.zustand, [b('bridge:A')], { jetzt: JETZT, entprellung: 2 });
  assert.equal(e2.neu.length, 1);
  assert.equal(e2.neu[0].id, 'bridge:A');
  assert.ok(e2.zustand.offen['bridge:A']);
});

test('bestehendes Problem meldet kein zweites Mal', () => {
  let z = leererZustand();
  for (let i = 0; i < 3; i++) z = verarbeite(z, [b('bridge:A')], { jetzt: JETZT, entprellung: 2 }).zustand;
  const e = verarbeite(z, [b('bridge:A')], { jetzt: JETZT, entprellung: 2 });
  assert.deepEqual(e.neu, []);
  assert.deepEqual(e.behoben, []);
});

test('Verschwinden erzeugt eine Entwarnung', () => {
  let z = leererZustand();
  z = verarbeite(z, [b('bridge:A')], { jetzt: JETZT, entprellung: 2 }).zustand;
  z = verarbeite(z, [b('bridge:A')], { jetzt: JETZT, entprellung: 2 }).zustand;
  const e = verarbeite(z, [], { jetzt: JETZT, entprellung: 2 });
  assert.equal(e.behoben.length, 1);
  assert.equal(e.behoben[0].id, 'bridge:A');
  assert.equal(e.zustand.offen['bridge:A'], undefined);
});

test('kurzer Aussetzer erzeugt gar keine Nachricht', () => {
  let z = leererZustand();
  z = verarbeite(z, [b('bridge:A')], { jetzt: JETZT, entprellung: 2 }).zustand;
  const e = verarbeite(z, [], { jetzt: JETZT, entprellung: 2 });
  assert.deepEqual(e.neu, []);
  assert.deepEqual(e.behoben, [], 'ein nie gemeldetes Problem braucht keine Entwarnung');
  assert.equal(e.zustand.verdacht['bridge:A'], undefined, 'Verdacht muss zurückgesetzt werden');
});

test('Schweregrad-Verschärfung wird als neu gemeldet', () => {
  let z = leererZustand();
  z = verarbeite(z, [b('x:1', 'warnung')], { jetzt: JETZT, entprellung: 2 }).zustand;
  z = verarbeite(z, [b('x:1', 'warnung')], { jetzt: JETZT, entprellung: 2 }).zustand;
  const e = verarbeite(z, [b('x:1', 'kritisch')], { jetzt: JETZT, entprellung: 2 });
  assert.equal(e.neu.length, 1, 'aus Warnung wird Alarm — das muss dich erreichen');
});

test('seit merkt sich den ERSTEN Fund, nicht den Zeitpunkt der Meldung', () => {
  const frueh = new Date('2026-09-07T08:00:00Z');
  const spaet = new Date('2026-09-07T09:00:00Z');
  let z = verarbeite(leererZustand(), [b('bridge:A')], { jetzt: frueh, entprellung: 2 }).zustand;
  const e = verarbeite(z, [b('bridge:A')], { jetzt: spaet, entprellung: 2 });
  assert.equal(e.zustand.offen['bridge:A'].seit, frueh.toISOString(),
    'sonst zeigt der Tagesbericht jede Störung als "seit heute"');
});
