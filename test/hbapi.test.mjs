import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HbApi } from '../src/hbapi.mjs';

function fakeFetch(routen) {
  const aufrufe = [];
  const f = async (url, opt = {}) => {
    aufrufe.push({ url: String(url), methode: opt.method ?? 'GET' });
    const treffer = Object.entries(routen).find(([pfad]) => String(url).includes(pfad));
    if (!treffer) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => treffer[1] };
  };
  f.aufrufe = aufrufe;
  return f;
}

test('meldet sich an und hängt den Token an Folgeabfragen', async () => {
  const f = fakeFetch({
    '/api/auth/login': { access_token: 'TOKEN123' },
    '/api/status/homebridge/child-bridges': [{ name: 'A', status: 'ok' }],
  });
  const api = new HbApi({ url: 'http://x', benutzer: 'w', passwort: 'p' }, f);
  const bridges = await api.childBridges();
  assert.equal(bridges.length, 1);
  assert.ok(f.aufrufe.find((a) => a.url.includes('child-bridges')));
});

test('meldet sich nur einmal an, auch bei mehreren Abfragen', async () => {
  const f = fakeFetch({
    '/api/auth/login': { access_token: 'T' },
    '/api/status/homebridge': { status: 'up' },
    '/api/accessories': [],
  });
  const api = new HbApi({ url: 'http://x', benutzer: 'w', passwort: 'p' }, f);
  await api.status();
  await api.accessories();
  assert.equal(f.aufrufe.filter((a) => a.url.includes('/login')).length, 1);
});

test('fehlgeschlagener Login wirft eine verständliche Meldung', async () => {
  const f = async () => ({ ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) });
  const api = new HbApi({ url: 'http://x', benutzer: 'w', passwort: 'falsch' }, f);
  await assert.rejects(() => api.status(), /Anmeldung.*fehlgeschlagen/i);
});

test('startet eine einzelne Child Bridge neu', async () => {
  const f = fakeFetch({ '/api/auth/login': { access_token: 'T' }, '/api/server/restart/': { ok: true } });
  const api = new HbApi({ url: 'http://x', benutzer: 'w', passwort: 'p' }, f);
  await api.starteBridgeNeu('0E:11:22:33:44:55');
  const put = f.aufrufe.find((a) => a.methode === 'PUT');
  assert.ok(put.url.includes('/api/server/restart/0E:11:22:33:44:55'));
});
