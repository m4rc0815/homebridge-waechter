// Prüft den Homebridge-Gesamtdienst und jede einzelne Child Bridge.
// Genau hier wäre der eWeLink-CUBE-Absturz vom 05.09.2026 sofort aufgefallen.

import { befund, SCHWERE } from '../befund.mjs';

export function pruefeDienst(status) {
  const wert = status?.status;
  if (wert === 'up' || wert === 'pending') return [];
  return [befund({
    bereich: 'dienst',
    schluessel: 'homebridge',
    schwere: SCHWERE.kritisch,
    titel: 'Homebridge-Dienst antwortet nicht',
    text: `Status: ${wert ?? 'unbekannt'}. HomeKit erreicht derzeit keines der Geräte.`,
  })];
}

export function pruefeBridges(bridges = []) {
  const raus = [];
  for (const br of bridges) {
    if (br.manuallyStopped) continue; // bewusst gestoppt — kein Fehler
    if (br.status === 'ok' || br.status === 'pending') continue;

    const kritisch = br.status === 'down';
    raus.push(befund({
      bereich: 'bridge',
      schluessel: br.username ?? br.name,
      schwere: kritisch ? SCHWERE.kritisch : SCHWERE.warnung,
      titel: `Child Bridge "${br.name}" läuft nicht`,
      text: kritisch
        ? `Status "down"${br.plugin ? `, Plugin ${br.plugin}` : ''}. Die Geräte dieser Bridge fehlen in Apple Home.`
        : `Unerwarteter Status "${br.status}".`,
      daten: { username: br.username, name: br.name, plugin: br.plugin },
    }));
  }
  return raus;
}
