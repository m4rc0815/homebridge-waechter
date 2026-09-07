import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruefeKonfig, STANDARD } from '../src/konfig.mjs';

const gueltig = {
  homebridge: { url: 'http://localhost:8581', benutzer: 'waechter', passwort: 'geheim' },
  discord: { webhook: 'https://discord.com/api/webhooks/1/x' },
};

test('gültige Konfiguration wird mit Standardwerten aufgefüllt', () => {
  const k = pruefeKonfig(gueltig);
  assert.equal(k.schwellen.frischeStunden, STANDARD.schwellen.frischeStunden);
  assert.equal(k.takt.entprellung, 2);
});

test('fehlendes Passwort wird klar benannt', () => {
  assert.throws(() => pruefeKonfig({ ...gueltig, homebridge: { url: 'x', benutzer: 'y' } }), /passwort/i);
});

test('fehlender Webhook wird klar benannt', () => {
  assert.throws(() => pruefeKonfig({ ...gueltig, discord: {} }), /webhook/i);
});

test('eigene Schwellen überschreiben die Standardwerte', () => {
  const k = pruefeKonfig({ ...gueltig, schwellen: { frischeStunden: 12 } });
  assert.equal(k.schwellen.frischeStunden, 12);
  assert.equal(k.schwellen.platteProzent, STANDARD.schwellen.platteProzent, 'nicht genannte Werte bleiben');
});
