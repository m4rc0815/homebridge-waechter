import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leseDf, leseTemperatur, leseThrottled, berechneRamProzent, leseMeminfo, baueJournalBefehl } from '../src/sammler.mjs';

test('df-Ausgabe wird zu Prozent', () => {
  const ausgabe = `Filesystem     1K-blocks     Used Available Use% Mounted on
/dev/mmcblk0p2  30218764 12345678  16000000  44% /`;
  assert.equal(leseDf(ausgabe), 44);
});

test('unlesbare df-Ausgabe liefert null statt Unsinn', () => {
  assert.equal(leseDf('kaputt'), null);
});

test('Temperatur in Milligrad wird zu Grad', () => {
  assert.equal(leseTemperatur('52738\n'), 52.7);
});

test('throttled-Wert 0x0 heißt: alles in Ordnung', () => {
  assert.equal(leseThrottled('throttled=0x0'), false);
});

test('throttled-Wert ungleich null heißt: gedrosselt', () => {
  assert.equal(leseThrottled('throttled=0x50005'), true);
});

test('RAM-Belegung wird aus frei und gesamt berechnet', () => {
  assert.equal(berechneRamProzent(1_000_000_000, 4_000_000_000), 75);
  assert.equal(berechneRamProzent(0, 0), null, 'ohne Zahlen lieber null als eine erfundene 100');
});

test('Journal-Befehl begrenzt auf den Zeitraum seit dem letzten Lauf', () => {
  const b = baueJournalBefehl('2026-09-07 09:45:00');
  assert.match(b, /--since/);
  assert.match(b, /2026-09-07 09:45:00/);
  assert.match(b, /homebridge/);
});

test('RAM wird aus MemAvailable berechnet, nicht aus MemFree', () => {
  // Typisches gesundes Linux: fast nichts "frei", aber viel verfügbar (Cache).
  const meminfo = `MemTotal:        3885040 kB
MemFree:          120000 kB
MemAvailable:    2900000 kB
Buffers:          180000 kB`;
  assert.equal(leseMeminfo(meminfo), 25,
    'mit MemFree wären es 97 % — eine Dauerwarnung auf jedem gesunden Pi');
});

test('unvollständige meminfo liefert null statt Unsinn', () => {
  assert.equal(leseMeminfo('MemTotal: 100 kB'), null);
});
