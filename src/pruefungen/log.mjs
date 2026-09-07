// Wertet die journalctl-Zeilen seit dem letzten Lauf aus.
// Zwei Regeln, die den Unterschied machen:
//   1. Bekanntes Rauschen wird verworfen, bevor irgendetwas gezählt wird.
//   2. Gleichartige Fehler werden gebündelt — 40 identische Zeilen sind EIN Befund.

import { befund, SCHWERE } from '../befund.mjs';

// Zeilen, die im Normalbetrieb massenhaft auftreten und nichts bedeuten.
export const RAUSCHEN = [
  /current power/i,
  /current voltage/i,
  /current current/i,
  /Homebridge is running on port/i,
  /Loaded plugin:/i,
  /Registering platform/i,
  /^\s*$/,
];

const MUSTER = [
  { re: /out of memory|heap out of memory/i, schwere: SCHWERE.kritisch, art: 'Speichermangel' },
  { re: /TypeError|ReferenceError|SyntaxError/i, schwere: SCHWERE.kritisch, art: 'Programmfehler im Plugin' },
  { re: /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND/i, schwere: SCHWERE.warnung, art: 'Verbindungsproblem' },
  { re: /\bERROR\b|\[error\]/i, schwere: SCHWERE.warnung, art: 'Fehlermeldung' },
];

// Zahlen, Zeitstempel und IDs herausnehmen, damit gleichartige Zeilen zusammenfallen.
const normalisiere = (z) => z.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 120);

export function werteLogAus(zeilen = []) {
  const gruppen = new Map();

  for (const zeile of zeilen) {
    if (RAUSCHEN.some((r) => r.test(zeile))) continue;
    const treffer = MUSTER.find((m) => m.re.test(zeile));
    if (!treffer) continue;

    const schluessel = `${treffer.art}|${normalisiere(zeile)}`;
    const vorhanden = gruppen.get(schluessel);
    if (vorhanden) vorhanden.anzahl++;
    else gruppen.set(schluessel, { anzahl: 1, zeile: zeile.trim().slice(0, 300), ...treffer });
  }

  return [...gruppen.entries()].map(([schluessel, g]) =>
    befund({
      bereich: 'log',
      schluessel: normalisiere(schluessel),
      schwere: g.schwere,
      titel: `${g.art} im Homebridge-Log`,
      text: `${g.anzahl}× seit der letzten Prüfung:\n${g.zeile}`,
      daten: { anzahl: g.anzahl },
    }),
  );
}
