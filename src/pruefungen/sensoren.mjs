// Sensor-Prüfung in zwei Stufen:
//   1. Verfügbarkeit — gilt für JEDES Gerät: keine Werte = nicht erreichbar.
//   2. Frische — nur für Merkmale, die sich naturgemäß laufend ändern.
// Kontakt-, Bewegungs- und Schaltgeräte bleiben außen vor: dort ist ein
// unveränderter Wert der Normalfall, keine Störung.

import { befund, SCHWERE } from '../befund.mjs';

// Merkmale, deren Wert sich im gesunden Betrieb STAENDIG bewegt — nur diese
// duerfen auf Frische geprueft werden. Bewusst NICHT enthalten (07.09.2026 an
// Marcs Anlage nachgemessen):
//   BatteryLevel             — steht tage- bis wochenlang auf demselben Wert
//   CurrentAmbientLightLevel — nachts konstant am Minimum, im Winter 14 h lang
//   Consumption/Voltage/ElectricCurrent — konstant 0, solange nichts eingeschaltet ist
// Alle drei haetten auf einer gesunden Anlage taeglich Fehlalarme erzeugt.
export const MESSWERT_MERKMALE = new Set([
  'CurrentTemperature',
  'CurrentRelativeHumidity',
  'AirQuality',
  'PM2_5Density',
  'PM10Density',
  'CarbonDioxideLevel',
  'VOCDensity',
]);

// Merkmale, mit denen ein Geraet SELBST seine Stoerung meldet — viel
// verlaesslicher als jede Frische-Heuristik.
const STOERMELDER = {
  StatusLowBattery: { wenn: (w) => w === 1 || w === true, titel: 'Batterie schwach', text: 'Das Gerät meldet einen niedrigen Batteriestand.' },
  StatusFault:      { wenn: (w) => w === 1 || w === true, titel: 'meldet eine Störung', text: 'Das Gerät setzt das HomeKit-Merkmal StatusFault.' },
};

// Gerätetypen, die von der Frische-Prüfung ausgenommen bleiben.
// ACHTUNG: Homebridge schreibt humanType MIT Leerzeichen ("Leak Sensor",
// "Garage Door Opener"). Deshalb wird vor dem Vergleich normalisiert — sonst
// griff diese Liste bei fast keinem Geraet (Fehler vom 07.09.2026).
const OHNE_FRISCHE = new Set([
  'ContactSensor', 'MotionSensor', 'Switch', 'Outlet', 'Lightbulb',
  'LockMechanism', 'Door', 'Window', 'WindowCovering', 'GarageDoorOpener',
  'StatelessProgrammableSwitch', 'LeakSensor', 'SmokeSensor', 'OccupancySensor',
  'Valve', 'Battery', 'History', 'ProtocolInformation', 'HueBridge', 'Status',
  'Speaker', 'Fan', 'Thermostat', 'SecuritySystem',
]);

export const normalisiereTyp = (t) => String(t ?? '').replace(/\s+/g, '');

const STUNDEN = 3600_000;

export function pruefeSensoren(accessories = [], sensorwerteAlt = {}, opt = {}) {
  const { jetzt = new Date(), frischeStunden = 6, ausnahmen = [] } = opt;
  const befunde = [];
  const sensorwerte = {};
  const uebersprungen = new Set(ausnahmen);

  for (const acc of accessories) {
    const name = acc.serviceName ?? acc.uniqueId;
    if (uebersprungen.has(name) || uebersprungen.has(acc.uniqueId)) continue;

    const werte = acc.values ?? {};
    if (Object.keys(werte).length === 0) {
      befunde.push(befund({
        bereich: 'sensor',
        schluessel: acc.uniqueId,
        schwere: SCHWERE.kritisch,
        titel: `"${name}" antwortet nicht`,
        text: 'Das Gerät ist in Homebridge vorhanden, liefert aber keine Werte mehr.',
        daten: { name },
      }));
      continue;
    }

    // Selbstgemeldete Stoerungen gelten fuer JEDES Geraet, unabhaengig vom Typ.
    for (const [merkmal, regel] of Object.entries(STOERMELDER)) {
      if (!(merkmal in werte) || !regel.wenn(werte[merkmal])) continue;
      befunde.push(befund({
        bereich: 'sensor',
        schluessel: `${acc.uniqueId}|${merkmal}`,
        schwere: SCHWERE.warnung,
        titel: `"${name}" ${regel.titel}`,
        text: regel.text,
        daten: { name, merkmal },
      }));
    }

    if (OHNE_FRISCHE.has(normalisiereTyp(acc.humanType))) continue;

    for (const [merkmal, wert] of Object.entries(werte)) {
      if (!MESSWERT_MERKMALE.has(merkmal)) continue;
      const schluessel = `sensor:${acc.uniqueId}|${merkmal}`;
      const vorher = sensorwerteAlt[schluessel];

      if (!vorher || vorher.wert !== wert) {
        // Neu oder verändert — Uhr für dieses Merkmal neu stellen.
        sensorwerte[schluessel] = { wert, seit: jetzt.toISOString() };
        continue;
      }

      // Unverändert: den ursprünglichen Zeitpunkt behalten, sonst läuft die Uhr nie ab.
      sensorwerte[schluessel] = vorher;
      const stillSeit = (jetzt - new Date(vorher.seit)) / STUNDEN;
      if (stillSeit >= frischeStunden) {
        befunde.push(befund({
          bereich: 'sensor',
          schluessel: `${acc.uniqueId}|${merkmal}`,
          schwere: SCHWERE.warnung,
          titel: `"${name}" liefert seit ${Math.floor(stillSeit)} h denselben Wert`,
          text: `${merkmal} steht unverändert auf ${wert}. Der Sensor hängt vermutlich.`,
          daten: { name, merkmal, wert },
        }));
      }
    }
  }

  return { befunde, sensorwerte };
}
