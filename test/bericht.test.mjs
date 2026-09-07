import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berichtFaellig, baueBericht } from '../src/bericht.mjs';

const um = (uhrzeit) => new Date(`2026-09-07T${uhrzeit}:00+02:00`);

test('vor der Berichtszeit ist nichts fällig', () => {
  assert.equal(berichtFaellig({ letzterBericht: null }, { jetzt: um('06:30'), berichtUm: '07:00' }), false);
});

test('nach der Berichtszeit und noch keiner heute: fällig', () => {
  assert.equal(berichtFaellig({ letzterBericht: '2026-09-06' }, { jetzt: um('07:05'), berichtUm: '07:00' }), true);
});

test('heute schon berichtet: nicht noch einmal', () => {
  assert.equal(berichtFaellig({ letzterBericht: '2026-09-07' }, { jetzt: um('12:00'), berichtUm: '07:00' }), false);
});

test('Bericht ohne Probleme ist grün und nennt die Zahlen', () => {
  const e = baueBericht({ offen: {}, kennzahlen: { bridges: 4, sensoren: 37, plattenProzent: 44 } });
  assert.equal(e.embeds[0].color, 0x22c55e);
  assert.match(e.embeds[0].description, /37/);
  assert.match(e.embeds[0].description, /4/);
});

test('Bericht mit offenen Problemen erinnert an jedes einzelne', () => {
  const offen = { 'bridge:A': { titel: 'Child Bridge "Cube" läuft nicht', seit: '2026-09-01T10:00:00Z', schwere: 'kritisch' } };
  const e = baueBericht({ offen, kennzahlen: { bridges: 4, sensoren: 37, plattenProzent: 44 } });
  assert.equal(e.embeds[0].color, 0xef4444);
  assert.match(e.embeds[0].description, /Cube/);
  assert.match(e.embeds[0].description, /seit/i, 'die Dauer macht den Druck');
});
