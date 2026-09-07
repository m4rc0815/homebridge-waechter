#!/usr/bin/env node
// Einstiegspunkt. Ein Lauf = ein Prozess, vom systemd-Timer alle 15 Minuten
// gestartet. Reihenfolge: sammeln → bewerten → mit letztem Lauf vergleichen →
// reparieren → melden → Zustand sichern.
//
// Aufruf:
//   node src/waechter.mjs                    normaler Lauf
//   node src/waechter.mjs --trocken          prüft und zeigt an, sendet aber nichts
//   node src/waechter.mjs --konfig /pfad     andere Konfigurationsdatei

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ladeKonfig } from './konfig.mjs';
import { HbApi } from './hbapi.mjs';
import { ladeZustand, speichereZustand, verarbeite } from './zustand.mjs';
import { pruefeDienst, pruefeBridges } from './pruefungen/bridges.mjs';
import { pruefeSensoren } from './pruefungen/sensoren.mjs';
import { werteLogAus } from './pruefungen/log.mjs';
import { pruefeSystem } from './pruefungen/system.mjs';
import { sammleSystemwerte, leseJournal } from './sammler.mjs';
import { baueMeldung, sendeAnDiscord } from './melder.mjs';
import { berichtFaellig, baueBericht, alsTag } from './bericht.mjs';
import { befund, SCHWERE } from './befund.mjs';

const KONFIG_STANDARD = '/etc/homebridge-waechter/config.json';

const minuten = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export function imWartungsfenster(jetzt, takt) {
  const lokal = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(jetzt);
  const jetztMin = minuten(lokal);
  const von = minuten(takt.wartungVon);
  const bis = minuten(takt.wartungBis);
  return von <= bis ? jetztMin >= von && jetztMin <= bis : jetztMin >= von || jetztMin <= bis;
}

export async function lauf(argv = process.argv.slice(2)) {
  const trocken = argv.includes('--trocken');
  const kIdx = argv.indexOf('--konfig');
  const konfigPfad = kIdx >= 0 ? argv[kIdx + 1] : KONFIG_STANDARD;

  const k = await ladeKonfig(konfigPfad);
  const jetzt = new Date();

  if (imWartungsfenster(jetzt, k.takt)) {
    console.log('Wartungsfenster — Prüfung übersprungen (täglicher Neustart läuft).');
    return 0;
  }

  const zustandAlt = await ladeZustand(k.zustandsdatei);
  const api = new HbApi(k.homebridge);
  const befunde = [];
  let bridges = [];
  let accessories = [];
  let sensorwerte = zustandAlt.sensorwerte ?? {};

  // --- Homebridge-API ---------------------------------------------------
  try {
    const [status, br, acc] = await Promise.all([api.status(), api.childBridges(), api.accessories()]);
    bridges = br ?? [];
    accessories = acc ?? [];
    befunde.push(...pruefeDienst(status));
    befunde.push(...pruefeBridges(bridges));
    const s = pruefeSensoren(accessories, zustandAlt.sensorwerte ?? {}, {
      jetzt, frischeStunden: k.schwellen.frischeStunden, ausnahmen: k.sensorAusnahmen,
    });
    befunde.push(...s.befunde);
    sensorwerte = s.sensorwerte;
  } catch (e) {
    befunde.push(befund({
      bereich: 'dienst', schluessel: 'api',
      schwere: SCHWERE.kritisch,
      titel: 'Homebridge-Oberfläche nicht erreichbar',
      text: String(e.message),
    }));
  }

  // --- Betriebssystem ---------------------------------------------------
  const seit = zustandAlt.aktualisiert
    ? new Date(zustandAlt.aktualisiert).toISOString().slice(0, 19).replace('T', ' ')
    : '15 minutes ago';
  const [systemwerte, journal] = await Promise.all([sammleSystemwerte(), leseJournal(seit)]);
  befunde.push(...pruefeSystem(systemwerte, k.schwellen));
  befunde.push(...werteLogAus(journal));

  // --- Vergleich mit dem letzten Lauf -----------------------------------
  const { zustand, neu, behoben } = verarbeite(zustandAlt, befunde, { jetzt, entprellung: k.takt.entprellung });
  zustand.sensorwerte = sensorwerte;

  // --- Selbstheilung: genau EIN Versuch je toter Child Bridge -----------
  for (const b of neu) {
    if (b.bereich !== 'bridge' || b.schwere !== SCHWERE.kritisch) continue;
    const eintrag = zustand.offen[b.id];
    if (!eintrag || eintrag.repariert) continue;
    if (trocken) { b.text += '\n_(Trockenlauf: kein Neustart versucht)_'; continue; }

    const geklappt = await api.starteBridgeNeu(b.daten.username).catch(() => false);
    eintrag.repariert = true;
    b.text += geklappt
      ? '\n🔧 Neustart wurde ausgelöst — der nächste Lauf prüft, ob es geholfen hat.'
      : '\n🔧 Neustart konnte nicht ausgelöst werden.';
  }

  // --- Melden -----------------------------------------------------------
  const meldung = baueMeldung({ neu, behoben, pingUserId: k.discord.pingUserId });
  if (trocken) {
    console.log(JSON.stringify({ befundeGesamt: befunde.length, befunde, neu, behoben }, null, 2));
  } else if (meldung) {
    const e = await sendeAnDiscord(k.discord.webhook, meldung);
    console.log(`Discord: ${e.ok ? 'gesendet' : `fehlgeschlagen (${e.fehler ?? e.status})`}`);
  }

  // --- Tagesbericht -----------------------------------------------------
  if (berichtFaellig(zustand, { jetzt, berichtUm: k.takt.berichtUm })) {
    const bericht = baueBericht({
      offen: zustand.offen,
      kennzahlen: { bridges: bridges.length, sensoren: accessories.length, plattenProzent: systemwerte.plattenProzent },
      jetzt,
    });
    if (!trocken) {
      const e = await sendeAnDiscord(k.discord.webhook, bericht);
      // letzterBericht NUR bei Erfolg setzen: sonst kostet ein kurzer Netzausfall
      // den Tagesbericht fuer den ganzen Tag. So versucht es der naechste Lauf erneut.
      if (e.ok) {
        zustand.letzterBericht = alsTag(jetzt);
        console.log('Tagesbericht gesendet.');
      } else {
        console.log(`Tagesbericht fehlgeschlagen (${e.fehler ?? e.status}) — naechster Lauf versucht es erneut.`);
      }
    } else {
      console.log('Tagesbericht wäre jetzt fällig (Trockenlauf: nicht gesendet).');
    }
  }

  if (!trocken) await speichereZustand(k.zustandsdatei, zustand);
  console.log(`Lauf beendet: ${befunde.length} Befunde, ${neu.length} neu, ${behoben.length} behoben.`);
  return 0;
}

// Nur ausführen, wenn direkt gestartet — nicht beim Import im Test.
const direktGestartet = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direktGestartet) {
  lauf().then((c) => process.exit(c)).catch((e) => {
    console.error('Wächter-Lauf abgebrochen:', e.message);
    process.exit(1);
  });
}
