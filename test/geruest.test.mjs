import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('package.json ist gültiges ESM-Projekt ohne Laufzeit-Abhängigkeiten', async () => {
  const p = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(p.type, 'module');
  assert.equal(p.dependencies, undefined, 'Der Wächter muss ohne npm install auf dem Pi laufen');
});
