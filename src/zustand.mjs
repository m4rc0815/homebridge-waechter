// Zustandsverwaltung: vergleicht die Befunde dieses Laufs mit dem letzten Lauf und
// entscheidet, was gemeldet wird. Reine Funktion — kein Dateizugriff, damit testbar.
//
// Drei Töpfe:
//   verdacht — gesehen, aber noch nicht oft genug für eine Meldung (Entprellung)
//   offen    — gemeldet und weiterhin bestehend
//   (weg)    — war offen, ist verschwunden → Entwarnung

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const ZUSTAND_VERSION = 1;

export const leererZustand = () => ({
  version: ZUSTAND_VERSION,
  aktualisiert: null,
  verdacht: {},
  offen: {},
  sensorwerte: {},
  letzterBericht: null,
});

export function verarbeite(alt, befunde, { jetzt = new Date(), entprellung = 2 } = {}) {
  const zustand = {
    ...leererZustand(),
    ...alt,
    verdacht: { ...(alt.verdacht ?? {}) },
    offen: { ...(alt.offen ?? {}) },
    sensorwerte: { ...(alt.sensorwerte ?? {}) },
    aktualisiert: jetzt.toISOString(),
  };
  const aktuell = new Map(befunde.map((b) => [b.id, b]));
  const neu = [];
  const behoben = [];

  for (const [id, b] of aktuell) {
    const offen = zustand.offen[id];
    if (offen) {
      // Bekannt. Nur melden, wenn der Schweregrad gestiegen ist.
      if (offen.schwere !== b.schwere && b.schwere === 'kritisch') {
        neu.push(b);
        zustand.offen[id] = { ...offen, schwere: b.schwere, titel: b.titel };
      }
      continue;
    }
    const laeufe = (zustand.verdacht[id]?.laeufe ?? 0) + 1;
    if (laeufe >= entprellung) {
      // seit AUSLESEN, bevor der Verdachtseintrag entfernt wird — sonst zeigt
      // jedes Problem fälschlich "seit jetzt" statt seit dem ersten Auftreten.
      const seitErstFund = zustand.verdacht[id]?.seit ?? jetzt.toISOString();
      delete zustand.verdacht[id];
      zustand.offen[id] = {
        seit: seitErstFund,
        schwere: b.schwere,
        titel: b.titel,
        bereich: b.bereich,
        repariert: false,
      };
      neu.push(b);
    } else {
      zustand.verdacht[id] = { seit: zustand.verdacht[id]?.seit ?? jetzt.toISOString(), laeufe };
    }
  }

  // Verschwundene Verdachtsfälle vergessen — ohne Meldung, sie waren nie gemeldet.
  for (const id of Object.keys(zustand.verdacht)) {
    if (!aktuell.has(id)) delete zustand.verdacht[id];
  }
  // Verschwundene offene Befunde: Entwarnung.
  for (const id of Object.keys(zustand.offen)) {
    if (!aktuell.has(id)) {
      behoben.push({ id, ...zustand.offen[id] });
      delete zustand.offen[id];
    }
  }

  return { zustand, neu, behoben };
}

export async function ladeZustand(pfad) {
  try {
    const roh = JSON.parse(await readFile(pfad, 'utf8'));
    return roh.version === ZUSTAND_VERSION ? roh : leererZustand();
  } catch {
    return leererZustand(); // erster Lauf oder beschädigte Datei — sauber neu anfangen
  }
}

export async function speichereZustand(pfad, zustand) {
  await mkdir(dirname(pfad), { recursive: true });
  await writeFile(pfad, JSON.stringify(zustand, null, 2), 'utf8');
}
