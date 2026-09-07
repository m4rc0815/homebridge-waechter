// Sensor-Prüfung in zwei Stufen:
//   1. Verfügbarkeit — gilt für JEDES Gerät: keine Werte = nicht erreichbar.
//   2. Frische — nur für Merkmale, die sich naturgemäß laufend ändern.
// Kontakt-, Bewegungs- und Schaltgeräte bleiben außen vor: dort ist ein
// unveränderter Wert der Normalfall, keine Störung.

import { befund, SCHWERE } from '../befund.mjs';

// Merkmale, deren Wert sich im gesunden Betrieb ständig bewegt.
export const MESSWERT_MERKMALE = new Set([
  'CurrentTemperature',
  'CurrentRelativeHumidity',
  'BatteryLevel',
  'CurrentAmbientLightLevel',
  'AirQuality',
  'PM2_5Density',
  'PM10Density',
  'CarbonDioxideLevel',
  'VOCDensity',
]);

// Gerätetypen, die von der Frische-Prüfung ausgenommen bleiben.
const OHNE_FRISCHE = new Set([
  'ContactSensor', 'MotionSensor', 'Switch', 'Outlet', 'Lightbulb',
  'LockMechanism', 'Door', 'Window', 'GarageDoorOpener', 'StatelessProgrammableSwitch',
  'LeakSensor', 'SmokeSensor', 'OccupancySensor', 'Valve',
]);

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

    if (OHNE_FRISCHE.has(acc.humanType)) continue;

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
