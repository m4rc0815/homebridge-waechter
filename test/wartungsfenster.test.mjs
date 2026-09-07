import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imWartungsfenster } from '../src/waechter.mjs';

const um = (u) => new Date(`2026-09-07T${u}:00+02:00`);
const takt = { wartungVon: '03:55', wartungBis: '04:10' };

test('mitten im Neustartfenster wird nicht gemeldet', () => {
  assert.equal(imWartungsfenster(um('04:00'), takt), true);
});

test('kurz davor und kurz danach wird gemeldet', () => {
  assert.equal(imWartungsfenster(um('03:50'), takt), false);
  assert.equal(imWartungsfenster(um('04:15'), takt), false);
});

test('tagsüber ist kein Wartungsfenster', () => {
  assert.equal(imWartungsfenster(um('14:00'), takt), false);
});

test('Fenster über Mitternacht funktioniert', () => {
  const nacht = { wartungVon: '23:55', wartungBis: '00:10' };
  assert.equal(imWartungsfenster(um('23:58'), nacht), true);
  assert.equal(imWartungsfenster(um('00:05'), nacht), true);
  assert.equal(imWartungsfenster(um('12:00'), nacht), false);
});
