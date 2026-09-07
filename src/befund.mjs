// Ein Befund ist eine einzelne Auffälligkeit aus einer Prüfung. Die id ist über
// Läufe hinweg stabil — daran erkennt zustand.mjs, ob etwas neu oder behoben ist.

export const SCHWERE = { kritisch: 'kritisch', warnung: 'warnung', hinweis: 'hinweis' };
const RANG = { kritisch: 0, warnung: 1, hinweis: 2 };

export function befund({ bereich, schluessel, schwere, titel, text = '', daten = {} }) {
  if (RANG[schwere] === undefined) {
    throw new Error(`Unbekannter Schweregrad: ${schwere}`);
  }
  return { id: `${bereich}:${schluessel}`, bereich, schwere, titel, text, daten };
}

export const istKritisch = (b) => b.schwere === SCHWERE.kritisch;

export const sortiereNachSchwere = (liste) =>
  [...liste].sort((a, b) => RANG[a.schwere] - RANG[b.schwere]);
