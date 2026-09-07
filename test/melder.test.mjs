import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baueMeldung, sendeAnDiscord } from '../src/melder.mjs';

const neu = [{ id: 'bridge:A', schwere: 'kritisch', titel: 'Child Bridge "Cube" läuft nicht', text: 'Status down' }];
const warn = [{ id: 'system:ram', schwere: 'warnung', titel: 'RAM bei 95 %', text: 'Leck?' }];

test('kritische Meldung erhält den @-Ping', () => {
  const m = baueMeldung({ neu, behoben: [], pingUserId: '4711' });
  assert.match(m.content, /<@4711>/, 'nur so klingelt das Handy');
});

test('reine Warnung erhält KEINEN Ping', () => {
  const m = baueMeldung({ neu: warn, behoben: [], pingUserId: '4711' });
  assert.equal(m.content ?? '', '');
});

test('ohne konfigurierte UserId gibt es keinen Ping-Platzhalter', () => {
  const m = baueMeldung({ neu, behoben: [], pingUserId: null });
  assert.equal(m.content ?? '', '');
});

test('Entwarnung wird als eigenes grünes Embed geführt', () => {
  const m = baueMeldung({ neu: [], behoben: [{ id: 'bridge:A', titel: 'Child Bridge "Cube" läuft nicht' }], pingUserId: null });
  assert.equal(m.embeds.length, 1);
  assert.equal(m.embeds[0].color, 0x22c55e);
  assert.match(m.embeds[0].title, /behoben/i);
});

test('ohne Befunde entsteht gar keine Meldung', () => {
  assert.equal(baueMeldung({ neu: [], behoben: [], pingUserId: null }), null);
});

test('Senden ohne Webhook-URL wirft nicht, sondern meldet Überspringen', async () => {
  const e = await sendeAnDiscord(null, { embeds: [] });
  assert.equal(e.uebersprungen, true);
});

test('Netzwerkfehler beim Senden lässt den Lauf nicht scheitern', async () => {
  const kaputt = async () => { throw new Error('Netz weg'); };
  const e = await sendeAnDiscord('https://x', { embeds: [] }, kaputt);
  assert.equal(e.ok, false);
  assert.match(e.fehler, /Netz weg/);
});
