#!/usr/bin/env node
// Einmaliges Werkzeug: fragt die echte Homebridge ab und zeigt die tatsächlichen
// Feldnamen. Gibt bewusst KEINE Werte aus, die Rückschlüsse auf Geheimnisse zulassen.
//
// Aufruf auf dem Pi:  sudo /opt/homebridge/bin/node tools/erkunde.mjs

import { ladeKonfig } from '../src/konfig.mjs';
import { HbApi } from '../src/hbapi.mjs';

const k = await ladeKonfig(process.argv[2] ?? '/etc/homebridge-waechter/config.json');
const api = new HbApi(k.homebridge);

const status = await api.status();
console.log('--- /api/status/homebridge ---');
console.log(JSON.stringify(status, null, 2));

const bridges = await api.childBridges();
console.log(`\n--- child-bridges (${bridges.length}) ---`);
console.log('Felder:', Object.keys(bridges[0] ?? {}).join(', '));
for (const b of bridges) console.log(`  ${String(b.status).padEnd(8)} ${b.name} (${b.username}) ${b.plugin ?? ''}`);

const acc = await api.accessories();
console.log(`\n--- accessories (${acc.length}) ---`);
console.log('Felder:', Object.keys(acc[0] ?? {}).join(', '));
const typen = {};
for (const a of acc) typen[a.humanType] = (typen[a.humanType] ?? 0) + 1;
console.log('Gerätetypen:', JSON.stringify(typen, null, 2));
const merkmale = new Set();
for (const a of acc) for (const m of Object.keys(a.values ?? {})) merkmale.add(m);
console.log('Vorkommende Merkmale:', [...merkmale].sort().join(', '));
const ohneWerte = acc.filter((a) => Object.keys(a.values ?? {}).length === 0);
console.log(`Geräte ohne Werte: ${ohneWerte.length}`, ohneWerte.map((a) => a.serviceName).join(', '));
