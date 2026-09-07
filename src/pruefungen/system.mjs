// Der Unterbau: Platte, Arbeitsspeicher, Temperatur, Spannungsdrosselung.
// Reine Bewertung — das Einsammeln der Zahlen macht sammler.mjs, damit hier
// nichts vom Betriebssystem abhängt.

import { befund, SCHWERE } from '../befund.mjs';

export function pruefeSystem(werte, grenzen) {
  const b = [];
  const { plattenProzent, ramProzent, tempGrad, gedrosselt } = werte;

  if (Number.isFinite(plattenProzent) && plattenProzent >= grenzen.platteProzent) {
    b.push(befund({
      bereich: 'system', schluessel: 'platte',
      schwere: SCHWERE.kritisch,
      titel: `Speicherplatz zu ${plattenProzent} % belegt`,
      text: 'Läuft die Platte voll, kann Homebridge seine Zustandsdateien nicht mehr schreiben.',
    }));
  }
  if (Number.isFinite(ramProzent) && ramProzent >= grenzen.ramProzent) {
    b.push(befund({
      bereich: 'system', schluessel: 'ram',
      schwere: SCHWERE.warnung,
      titel: `Arbeitsspeicher zu ${ramProzent} % belegt`,
      text: 'Anhaltend hoher Verbrauch deutet auf ein Speicherleck in einem Plugin hin.',
    }));
  }
  if (Number.isFinite(tempGrad) && tempGrad >= grenzen.tempGrad) {
    b.push(befund({
      bereich: 'system', schluessel: 'temperatur',
      schwere: SCHWERE.warnung,
      titel: `Pi-Temperatur bei ${tempGrad} °C`,
      text: 'Ab etwa 80 °C drosselt der Raspberry Pi selbsttätig die Leistung.',
    }));
  }
  if (gedrosselt) {
    b.push(befund({
      bereich: 'system', schluessel: 'drosselung',
      schwere: SCHWERE.warnung,
      titel: 'Raspberry Pi drosselt sich',
      text: 'Unterspannung oder Überhitzung. Häufigste Ursache ist ein zu schwaches Netzteil — auf Dauer nimmt die SD-Karte Schaden.',
    }));
  }
  return b;
}
