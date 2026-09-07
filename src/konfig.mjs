// Konfiguration liegt auf dem Pi unter /etc/homebridge-waechter/config.json
// mit Rechten 600 — sie enthält Passwort und Webhook-URL.

import { readFile } from 'node:fs/promises';

export const STANDARD = {
  homebridge: { url: 'http://localhost:8581' },
  discord: { webhook: null, pingUserId: null },
  takt: { wartungVon: '03:55', wartungBis: '04:10', berichtUm: '07:00', entprellung: 2 },
  schwellen: { frischeStunden: 6, platteProzent: 85, ramProzent: 90, tempGrad: 75 },
  sensorAusnahmen: [],
  zustandsdatei: '/var/lib/homebridge-waechter/zustand.json',
};

export function pruefeKonfig(roh) {
  const k = {
    ...STANDARD,
    ...roh,
    homebridge: { ...STANDARD.homebridge, ...roh.homebridge },
    discord: { ...STANDARD.discord, ...roh.discord },
    takt: { ...STANDARD.takt, ...roh.takt },
    schwellen: { ...STANDARD.schwellen, ...roh.schwellen },
  };
  if (!k.homebridge.benutzer) throw new Error('Konfiguration: homebridge.benutzer fehlt');
  if (!k.homebridge.passwort) throw new Error('Konfiguration: homebridge.passwort fehlt');
  if (!k.discord.webhook) throw new Error('Konfiguration: discord.webhook fehlt');
  return k;
}

export async function ladeKonfig(pfad) {
  const roh = JSON.parse(await readFile(pfad, 'utf8'));
  return pruefeKonfig(roh);
}
