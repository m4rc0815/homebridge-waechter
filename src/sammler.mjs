// Liest Kennzahlen vom Betriebssystem. Die Parser sind als reine Funktionen
// exportiert und getestet; das Ausführen der Befehle bleibt ungetestet, weil es
// ohnehin nur auf dem Pi läuft.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { freemem, totalmem } from 'node:os';
import { readFile } from 'node:fs/promises';

const lauf = promisify(execFile);

export function berechneRamProzent(frei, gesamt) {
  if (!Number.isFinite(gesamt) || gesamt <= 0) return null;
  return Math.round(((gesamt - frei) / gesamt) * 100);
}

// os.freemem() zaehlt unter Linux NUR wirklich unbenutzten Speicher. Ein gesundes
// Linux nutzt fast den ganzen Rest als Dateicache, den es jederzeit hergibt — mit
// freemem() meldete der Waechter deshalb dauerhaft >90 % und waere nach einem Tag
// nur noch Rauschen. MemAvailable ist die Zahl, die tatsaechlich zaehlt.
export function leseMeminfo(inhalt) {
  const zahl = (feld) => {
    const t = inhalt.match(new RegExp(`^${feld}:\\s+(\\d+) kB`, 'm'));
    return t ? Number(t[1]) : null;
  };
  const gesamt = zahl('MemTotal');
  const verfuegbar = zahl('MemAvailable');
  if (!gesamt || verfuegbar === null) return null;
  return Math.round(((gesamt - verfuegbar) / gesamt) * 100);
}

export function leseDf(ausgabe) {
  const zeile = ausgabe.split('\n')[1];
  const treffer = zeile?.match(/(\d+)%/);
  return treffer ? Number(treffer[1]) : null;
}

export function leseTemperatur(ausgabe) {
  const milligrad = Number(String(ausgabe).trim());
  return Number.isFinite(milligrad) ? Math.round(milligrad / 100) / 10 : null;
}

export function leseThrottled(ausgabe) {
  const treffer = String(ausgabe).match(/throttled=0x([0-9a-f]+)/i);
  return treffer ? parseInt(treffer[1], 16) !== 0 : false;
}

export function baueJournalBefehl(seit) {
  return `journalctl -u homebridge --since "${seit}" --no-pager -o cat`;
}

const still = async (fn, standard = null) => { try { return await fn(); } catch { return standard; } };

export async function sammleSystemwerte() {
  const plattenProzent = await still(async () => leseDf((await lauf('df', ['-P', '/'])).stdout));
  const tempGrad = await still(async () =>
    leseTemperatur((await lauf('cat', ['/sys/class/thermal/thermal_zone0/temp'])).stdout));
  const gedrosselt = await still(async () =>
    leseThrottled((await lauf('vcgencmd', ['get_throttled'])).stdout), false);
  // Bevorzugt /proc/meminfo (Linux, also der Pi); os.freemem() nur als Rueckfall.
  const ramProzent = await still(async () =>
    leseMeminfo(await readFile('/proc/meminfo', 'utf8'))) ?? berechneRamProzent(freemem(), totalmem());
  return { plattenProzent, tempGrad, gedrosselt, ramProzent };
}

export async function leseJournal(seit) {
  return still(async () => {
    const { stdout } = await lauf('bash', ['-lc', baueJournalBefehl(seit)], { maxBuffer: 8 * 1024 * 1024 });
    return stdout.split('\n');
  }, []);
}
