# Homebridge-Wächter — Implementierungsplan

> **Für agentische Bearbeiter:** ERFORDERLICHER SUB-SKILL: `superpowers:subagent-driven-development` (empfohlen) oder `superpowers:executing-plans`, um diesen Plan Aufgabe für Aufgabe umzusetzen. Schritte nutzen Checkbox-Syntax (`- [ ]`) zur Verfolgung.

**Ziel:** Ein eigenständiger Node-Dienst auf dem Homebridge-Raspberry-Pi, der alle 15 Minuten Dienst, Child Bridges, Sensor-Verfügbarkeit, Logfehler und Systemgesundheit prüft und Zustandswechsel per Discord meldet.

**Architektur:** Ein zustandsbehafteter Einmal-Lauf, ausgelöst von einem systemd-Timer — kein Dauerprozess. Jeder Lauf erzeugt eine Liste von *Befunden* mit stabilen IDs, vergleicht sie gegen die Zustandsdatei des letzten Laufs und meldet nur Änderungen. Prüfungen sind reine Funktionen über eingespeiste Daten, damit sie ohne echten Pi testbar bleiben; die Ein-/Ausgabe (Homebridge-API, journalctl, Discord) liegt in dünnen, injizierbaren Adaptern.

**Nicht im Umfang:** Das Claude-OS-Dashboard-Panel wurde am 07.09.2026 gestrichen. Als Andockstelle für ein späteres Panel dient die ohnehin geführte Zustandsdatei `/var/lib/homebridge-waechter/zustand.json` — sie enthält den vollständigen Lagebericht in maschinenlesbarer Form. Ein eigener HTTP-Endpunkt wird bewusst **nicht** vorgebaut (YAGNI): ohne Panel wäre er ein zusätzlicher Dienst ohne Nutzen.

**Tech-Stack:** Node.js 24 (bereits unter `/opt/homebridge/bin/node` auf dem Pi), `node:test` als Testrunner, eingebautes `fetch`. **Null Laufzeit-Abhängigkeiten** — kein npm install auf dem Pi.

**Verifizierte API-Grundlage** (Homebridge 2.4.0, UI 5.29.0, abgefragt am 07.09.2026):

| Endpunkt | Zweck |
|---|---|
| `POST /api/auth/login` | frei zugänglich, liefert JWT |
| `GET /api/status/homebridge` | Dienststatus (`up`/`pending`/`down`) |
| `GET /api/status/homebridge/child-bridges` | Array aller Child Bridges mit Status |
| `GET /api/accessories` | alle Accessories inkl. aktueller Werte |
| `GET /api/status/rpi/throttled` | Pi-Spannungs-/Temperaturdrosselung |
| `GET /api/status/cpu`, `/ram`, `/uptime` | Systemlast |
| `GET /api/plugins` | installierte Plugins, Update-Stand |
| `PUT /api/server/restart/{deviceId}` | **eine einzelne** Child Bridge neu starten |

---

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `src/waechter.mjs` | Einstiegspunkt: orchestriert einen Lauf, kennt die Reihenfolge |
| `src/konfig.mjs` | Konfiguration laden und prüfen |
| `src/befund.mjs` | Befund-Datentyp, Schweregrade, stabile IDs |
| `src/zustand.mjs` | Zustandsdatei, Entprellung, Wechselerkennung — **Herzstück** |
| `src/hbapi.mjs` | Homebridge-API-Client (Login, Abfragen, Bridge-Neustart) |
| `src/pruefungen/dienst.mjs` | systemd-Dienst + API-Gesamtstatus |
| `src/pruefungen/bridges.mjs` | Child-Bridge-Status |
| `src/pruefungen/sensoren.mjs` | Verfügbarkeit + Frische von Accessories |
| `src/pruefungen/log.mjs` | journalctl-Auswertung |
| `src/pruefungen/system.mjs` | Platte, RAM, Temperatur, Drosselung |
| `src/melder.mjs` | Discord-Embeds bauen und senden |
| `src/bericht.mjs` | Täglicher Lebenszeichen-Bericht |
| `systemd/*.service`, `*.timer` | Zeitsteuerung |
| `install.sh`, `update.sh` | Einrichtung und Einzeiler-Update |

Alle Prüfmodule liefern denselben Typ (`Befund[]`) und bekommen ihre Daten übergeben — nie holen sie sie selbst. Dadurch braucht kein Test einen laufenden Pi.

---

## Aufgabe 1: Projektgerüst und Testlauf

**Dateien:**
- Anlegen: `package.json`
- Anlegen: `.gitignore`
- Anlegen: `test/gerüst.test.mjs`

- [ ] **Schritt 1: package.json anlegen**

```json
{
  "name": "homebridge-waechter",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Überwacht Homebridge auf Dienst-, Bridge-, Sensor- und Systemfehler und meldet Auffälligkeiten per Discord",
  "scripts": {
    "test": "node --test test/*.test.mjs",
    "pruefen": "node src/waechter.mjs",
    "trockenlauf": "node src/waechter.mjs --trocken"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Schritt 2: .gitignore anlegen**

```
node_modules/
*.log
zustand.json
config.json
.DS_Store
```

Begründung: `config.json` enthält das Wächter-Passwort und die Webhook-URL und darf **nie** ins Repo.

- [ ] **Schritt 3: Gerüsttest schreiben**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('package.json ist gültiges ESM-Projekt ohne Laufzeit-Abhängigkeiten', async () => {
  const p = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(p.type, 'module');
  assert.equal(p.dependencies, undefined, 'Der Wächter muss ohne npm install auf dem Pi laufen');
});
```

- [ ] **Schritt 4: Test laufen lassen**

Ausführen: `npm test`
Erwartet: 1 Test bestanden.

- [ ] **Schritt 5: Committen**

```bash
git add package.json .gitignore test/gerüst.test.mjs
git commit -m "chore: Projektgerüst ohne Laufzeit-Abhängigkeiten"
```

---

## Aufgabe 2: Befund-Datentyp

Ein *Befund* ist eine einzelne Auffälligkeit. Die `id` muss über Läufe hinweg stabil sein — daran erkennt der Zustandsvergleich, ob ein Problem neu, bekannt oder behoben ist.

**Dateien:**
- Anlegen: `src/befund.mjs`
- Anlegen: `test/befund.test.mjs`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { befund, SCHWERE, istKritisch, sortiereNachSchwere } from '../src/befund.mjs';

test('befund erzeugt einen vollständigen Datensatz', () => {
  const b = befund({ bereich: 'bridge', schluessel: '0E:11:22', schwere: 'kritisch', titel: 'Bridge tot', text: 'Details' });
  assert.equal(b.id, 'bridge:0E:11:22');
  assert.equal(b.schwere, 'kritisch');
  assert.equal(b.titel, 'Bridge tot');
});

test('unbekannter Schweregrad wird abgewiesen', () => {
  assert.throws(() => befund({ bereich: 'x', schluessel: 'y', schwere: 'egal', titel: 't' }), /Schweregrad/);
});

test('istKritisch trennt Alarm von Hinweis', () => {
  assert.equal(istKritisch({ schwere: SCHWERE.kritisch }), true);
  assert.equal(istKritisch({ schwere: SCHWERE.warnung }), false);
});

test('sortiereNachSchwere stellt Kritisches nach vorn', () => {
  const liste = [
    { schwere: 'hinweis', titel: 'c' },
    { schwere: 'kritisch', titel: 'a' },
    { schwere: 'warnung', titel: 'b' },
  ];
  assert.deepEqual(sortiereNachSchwere(liste).map((x) => x.titel), ['a', 'b', 'c']);
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `npm test`
Erwartet: FEHLER — `Cannot find module '../src/befund.mjs'`

- [ ] **Schritt 3: Minimale Umsetzung**

```javascript
// Ein Befund ist eine einzelne Auffälligkeit aus einer Prüfung. Die id ist über
// Läufe hinweg stabil — daran erkennt zustand.mjs, ob etwas neu oder behoben ist.

export const SCHWERE = { kritisch: 'kritisch', warnung: 'warnung', hinweis: 'hinweis' };
const RANG = { kritisch: 0, warnung: 1, hinweis: 2 };

export function befund({ bereich, schluessel, schwere, titel, text = '', daten = {} }) {
  if (!RANG[schwere] && RANG[schwere] !== 0) {
    throw new Error(`Unbekannter Schweregrad: ${schwere}`);
  }
  return { id: `${bereich}:${schluessel}`, bereich, schwere, titel, text, daten };
}

export const istKritisch = (b) => b.schwere === SCHWERE.kritisch;

export const sortiereNachSchwere = (liste) =>
  [...liste].sort((a, b) => RANG[a.schwere] - RANG[b.schwere]);
```

- [ ] **Schritt 4: Test laufen lassen**

Ausführen: `npm test`
Erwartet: alle Tests bestanden.

- [ ] **Schritt 5: Committen**

```bash
git add src/befund.mjs test/befund.test.mjs
git commit -m "feat: Befund-Datentyp mit stabilen IDs und Schweregraden"
```

---

## Aufgabe 3: Zustandsverwaltung (Herzstück)

Hier entscheidet sich, ob du 96 Nachrichten am Tag bekommst oder zwei. Drei Regeln:
1. Ein Befund wird erst gemeldet, wenn er **zwei Läufe hintereinander** bestand (Entprellung).
2. Verschwindet ein gemeldeter Befund, gibt es eine **Entwarnung**.
3. Ein bereits gemeldeter, weiterhin bestehender Befund erzeugt **keine** neue Nachricht.

**Dateien:**
- Anlegen: `src/zustand.mjs`
- Anlegen: `test/zustand.test.mjs`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leererZustand, verarbeite } from '../src/zustand.mjs';

const b = (id, schwere = 'kritisch') => ({ id, schwere, titel: id, text: '', bereich: 'test', daten: {} });
const JETZT = new Date('2026-09-07T10:00:00Z');

test('erster Fund wird noch NICHT gemeldet (Entprellung)', () => {
  const e = verarbeite(leererZustand(), [b('bridge:A')], { jetzt: JETZT, entprellung: 2 });
  assert.deepEqual(e.neu, [], 'ein einzelner Aussetzer darf nicht sofort alarmieren');
  assert.equal(e.zustand.verdacht['bridge:A'].laeufe, 1);
});

test('zweiter Fund in Folge wird gemeldet', () => {
  const e1 = verarbeite(leererZustand(), [b('bridge:A')], { jetzt: JETZT, entprellung: 2 });
  const e2 = verarbeite(e1.zustand, [b('bridge:A')], { jetzt: JETZT, entprellung: 2 });
  assert.equal(e2.neu.length, 1);
  assert.equal(e2.neu[0].id, 'bridge:A');
  assert.ok(e2.zustand.offen['bridge:A']);
});

test('bestehendes Problem meldet kein zweites Mal', () => {
  let z = leererZustand();
  for (let i = 0; i < 3; i++) z = verarbeite(z, [b('bridge:A')], { jetzt: JETZT, entprellung: 2 }).zustand;
  const e = verarbeite(z, [b('bridge:A')], { jetzt: JETZT, entprellung: 2 });
  assert.deepEqual(e.neu, []);
  assert.deepEqual(e.behoben, []);
});

test('Verschwinden erzeugt eine Entwarnung', () => {
  let z = leererZustand();
  z = verarbeite(z, [b('bridge:A')], { jetzt: JETZT, entprellung: 2 }).zustand;
  z = verarbeite(z, [b('bridge:A')], { jetzt: JETZT, entprellung: 2 }).zustand;
  const e = verarbeite(z, [], { jetzt: JETZT, entprellung: 2 });
  assert.equal(e.behoben.length, 1);
  assert.equal(e.behoben[0].id, 'bridge:A');
  assert.equal(e.zustand.offen['bridge:A'], undefined);
});

test('kurzer Aussetzer erzeugt gar keine Nachricht', () => {
  let z = leererZustand();
  z = verarbeite(z, [b('bridge:A')], { jetzt: JETZT, entprellung: 2 }).zustand;
  const e = verarbeite(z, [], { jetzt: JETZT, entprellung: 2 });
  assert.deepEqual(e.neu, []);
  assert.deepEqual(e.behoben, [], 'ein nie gemeldetes Problem braucht keine Entwarnung');
  assert.equal(e.zustand.verdacht['bridge:A'], undefined, 'Verdacht muss zurückgesetzt werden');
});

test('Schweregrad-Verschärfung wird als neu gemeldet', () => {
  let z = leererZustand();
  z = verarbeite(z, [b('x:1', 'warnung')], { jetzt: JETZT, entprellung: 2 }).zustand;
  z = verarbeite(z, [b('x:1', 'warnung')], { jetzt: JETZT, entprellung: 2 }).zustand;
  const e = verarbeite(z, [b('x:1', 'kritisch')], { jetzt: JETZT, entprellung: 2 });
  assert.equal(e.neu.length, 1, 'aus Warnung wird Alarm — das muss dich erreichen');
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `npm test`
Erwartet: FEHLER — `Cannot find module '../src/zustand.mjs'`

- [ ] **Schritt 3: Umsetzung**

```javascript
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
      // jedes Problem faelschlich "seit jetzt" statt seit dem ersten Auftreten.
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
```

- [ ] **Schritt 4: Test laufen lassen**

Ausführen: `npm test`
Erwartet: alle Tests bestanden. Falls der Test „Verschwinden erzeugt eine Entwarnung" scheitert, prüfe, dass `offen` erst nach Erreichen der Entprellung gefüllt wird.

- [ ] **Schritt 5: Committen**

```bash
git add src/zustand.mjs test/zustand.test.mjs
git commit -m "feat: Zustandsverwaltung mit Entprellung, Entwarnung und Verschärfungserkennung"
```

---

## Aufgabe 4: Homebridge-API-Client

**Dateien:**
- Anlegen: `src/hbapi.mjs`
- Anlegen: `test/hbapi.test.mjs`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HbApi } from '../src/hbapi.mjs';

function fakeFetch(routen) {
  const aufrufe = [];
  const f = async (url, opt = {}) => {
    aufrufe.push({ url: String(url), methode: opt.method ?? 'GET' });
    const treffer = Object.entries(routen).find(([pfad]) => String(url).includes(pfad));
    if (!treffer) return { ok: false, status: 404, json: async () => ({}) };
    const [, wert] = treffer;
    return { ok: true, status: 200, json: async () => wert };
  };
  f.aufrufe = aufrufe;
  return f;
}

test('meldet sich an und hängt den Token an Folgeabfragen', async () => {
  const f = fakeFetch({
    '/api/auth/login': { access_token: 'TOKEN123' },
    '/api/status/homebridge/child-bridges': [{ name: 'A', status: 'ok' }],
  });
  const api = new HbApi({ url: 'http://x', benutzer: 'w', passwort: 'p' }, f);
  const bridges = await api.childBridges();
  assert.equal(bridges.length, 1);
  const abfrage = f.aufrufe.find((a) => a.url.includes('child-bridges'));
  assert.ok(abfrage, 'Bridge-Abfrage muss stattgefunden haben');
});

test('meldet sich nur einmal an, auch bei mehreren Abfragen', async () => {
  const f = fakeFetch({
    '/api/auth/login': { access_token: 'T' },
    '/api/status/homebridge': { status: 'up' },
    '/api/accessories': [],
  });
  const api = new HbApi({ url: 'http://x', benutzer: 'w', passwort: 'p' }, f);
  await api.status();
  await api.accessories();
  const logins = f.aufrufe.filter((a) => a.url.includes('/login'));
  assert.equal(logins.length, 1, 'jeder Lauf braucht nur einen Login');
});

test('fehlgeschlagener Login wirft eine verständliche Meldung', async () => {
  const f = async () => ({ ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) });
  const api = new HbApi({ url: 'http://x', benutzer: 'w', passwort: 'falsch' }, f);
  await assert.rejects(() => api.status(), /Anmeldung.*fehlgeschlagen/i);
});

test('startet eine einzelne Child Bridge neu', async () => {
  const f = fakeFetch({ '/api/auth/login': { access_token: 'T' }, '/api/server/restart/': { ok: true } });
  const api = new HbApi({ url: 'http://x', benutzer: 'w', passwort: 'p' }, f);
  await api.starteBridgeNeu('0E:11:22:33:44:55');
  const put = f.aufrufe.find((a) => a.methode === 'PUT');
  assert.ok(put.url.includes('/api/server/restart/0E:11:22:33:44:55'));
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `npm test`
Erwartet: FEHLER — Modul nicht gefunden.

- [ ] **Schritt 3: Umsetzung**

```javascript
// Dünner Client für die Homebridge-Config-UI-API. Der Token gilt für einen Lauf;
// da jeder Lauf ein eigener Prozess ist, wird nichts zwischengespeichert.
// fetchImpl ist injizierbar, damit die Tests ohne echten Pi auskommen.

const ZEITLIMIT = 15000;

export class HbApi {
  constructor({ url, benutzer, passwort }, fetchImpl = fetch) {
    this.url = url.replace(/\/$/, '');
    this.benutzer = benutzer;
    this.passwort = passwort;
    this.fetch = fetchImpl;
    this.token = null;
  }

  async anmelden() {
    if (this.token) return this.token;
    const res = await this.fetch(`${this.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.benutzer, password: this.passwort }),
      signal: AbortSignal.timeout(ZEITLIMIT),
    });
    if (!res.ok) {
      throw new Error(`Anmeldung an Homebridge fehlgeschlagen (HTTP ${res.status}) — Benutzer oder Passwort prüfen`);
    }
    const daten = await res.json();
    this.token = daten.access_token;
    if (!this.token) throw new Error('Anmeldung lieferte keinen Token');
    return this.token;
  }

  async hole(pfad) {
    const token = await this.anmelden();
    const res = await this.fetch(`${this.url}${pfad}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(ZEITLIMIT),
    });
    if (!res.ok) throw new Error(`Abfrage ${pfad} fehlgeschlagen (HTTP ${res.status})`);
    return res.json();
  }

  status = () => this.hole('/api/status/homebridge');
  childBridges = () => this.hole('/api/status/homebridge/child-bridges');
  accessories = () => this.hole('/api/accessories');
  ram = () => this.hole('/api/status/ram');
  cpu = () => this.hole('/api/status/cpu');
  gedrosselt = () => this.hole('/api/status/rpi/throttled');

  async starteBridgeNeu(deviceId) {
    const token = await this.anmelden();
    const res = await this.fetch(`${this.url}/api/server/restart/${deviceId}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(ZEITLIMIT),
    });
    return res.ok;
  }
}
```

- [ ] **Schritt 4: Test laufen lassen**

Ausführen: `npm test`
Erwartet: alle Tests bestanden.

- [ ] **Schritt 5: Committen**

```bash
git add src/hbapi.mjs test/hbapi.test.mjs
git commit -m "feat: Homebridge-API-Client mit Einmal-Login und Bridge-Neustart"
```

---

## Aufgabe 5: Prüfung Dienst und Child Bridges

**Dateien:**
- Anlegen: `src/pruefungen/bridges.mjs`
- Anlegen: `test/bridges.test.mjs`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruefeDienst, pruefeBridges } from '../src/pruefungen/bridges.mjs';

test('laufender Dienst erzeugt keinen Befund', () => {
  assert.deepEqual(pruefeDienst({ status: 'up' }), []);
});

test('toter Dienst ist kritisch', () => {
  const b = pruefeDienst({ status: 'down' });
  assert.equal(b.length, 1);
  assert.equal(b[0].schwere, 'kritisch');
  assert.equal(b[0].id, 'dienst:homebridge');
});

test('startender Dienst (pending) ist noch kein Fehler', () => {
  assert.deepEqual(pruefeDienst({ status: 'pending' }), [], 'pending heißt nur: startet gerade');
});

test('gesunde Bridges erzeugen keine Befunde', () => {
  const bridges = [
    { name: 'Hue', username: '0E:AA', status: 'ok', plugin: 'homebridge-hue' },
    { name: 'Cube', username: '0E:BB', status: 'ok', plugin: 'homebridge-plugin-ewelink-cube' },
  ];
  assert.deepEqual(pruefeBridges(bridges), []);
});

test('tote Bridge wird kritisch gemeldet, mit username als Schlüssel', () => {
  const b = pruefeBridges([{ name: 'Cube', username: '0E:BB', status: 'down', plugin: 'p' }]);
  assert.equal(b.length, 1);
  assert.equal(b[0].id, 'bridge:0E:BB');
  assert.equal(b[0].schwere, 'kritisch');
  assert.match(b[0].titel, /Cube/);
  assert.equal(b[0].daten.username, '0E:BB', 'für den Reparaturversuch nötig');
});

test('von Hand gestoppte Bridge wird NICHT gemeldet', () => {
  const b = pruefeBridges([{ name: 'Test', username: '0E:CC', status: 'down', manuallyStopped: true }]);
  assert.deepEqual(b, [], 'wer selbst stoppt, will keinen Alarm');
});

test('unbekannte Statuswerte werden als Warnung gemeldet, nicht verschluckt', () => {
  const b = pruefeBridges([{ name: 'X', username: '0E:DD', status: 'irgendwas' }]);
  assert.equal(b.length, 1);
  assert.equal(b[0].schwere, 'warnung');
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `npm test`
Erwartet: FEHLER — Modul nicht gefunden.

- [ ] **Schritt 3: Umsetzung**

```javascript
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
```

- [ ] **Schritt 4: Test laufen lassen**

Ausführen: `npm test`
Erwartet: alle Tests bestanden.

- [ ] **Schritt 5: Committen**

```bash
git add src/pruefungen/bridges.mjs test/bridges.test.mjs
git commit -m "feat: Prüfung von Dienst und Child Bridges"
```

---

## Aufgabe 6: Prüfung Sensor-Verfügbarkeit und Frische

Zwei Stufen laut Spezifikation:
1. **Harte Verfügbarkeit** für alle Geräte — verschwunden oder ohne Werte = Fehler.
2. **Frische** nur für Messwert-Merkmale, die sich naturgemäß ändern. Kontakt-, Bewegungs- und Schaltgeräte sind ausgenommen, weil Stillstand dort normal ist.

**Dateien:**
- Anlegen: `src/pruefungen/sensoren.mjs`
- Anlegen: `test/sensoren.test.mjs`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruefeSensoren, MESSWERT_MERKMALE } from '../src/pruefungen/sensoren.mjs';

const JETZT = new Date('2026-09-07T12:00:00Z');
const VOR_7H = new Date('2026-09-07T05:00:00Z').toISOString();
const VOR_1H = new Date('2026-09-07T11:00:00Z').toISOString();

const acc = (id, name, values, humanType = 'TemperatureSensor') => ({
  uniqueId: id, serviceName: name, humanType, values,
});

test('frische Messwerte erzeugen keinen Befund', () => {
  const alt = { 'sensor:a|CurrentTemperature': { wert: 20, seit: VOR_7H } };
  const e = pruefeSensoren([acc('a', 'Bad', { CurrentTemperature: 21.5 })], alt, { jetzt: JETZT, frischeStunden: 6 });
  assert.deepEqual(e.befunde, [], 'Wert hat sich geändert — alles gut');
  assert.equal(e.sensorwerte['sensor:a|CurrentTemperature'].wert, 21.5);
});

test('seit über 6 Stunden eingefrorener Messwert wird gemeldet', () => {
  const alt = { 'sensor:a|CurrentTemperature': { wert: 20, seit: VOR_7H } };
  const e = pruefeSensoren([acc('a', 'Bad', { CurrentTemperature: 20 })], alt, { jetzt: JETZT, frischeStunden: 6 });
  assert.equal(e.befunde.length, 1);
  assert.equal(e.befunde[0].schwere, 'warnung');
  assert.match(e.befunde[0].titel, /Bad/);
  assert.equal(e.sensorwerte['sensor:a|CurrentTemperature'].seit, VOR_7H, 'seit darf NICHT zurückgesetzt werden');
});

test('erst eine Stunde eingefroren ist noch kein Fehler', () => {
  const alt = { 'sensor:a|CurrentTemperature': { wert: 20, seit: VOR_1H } };
  const e = pruefeSensoren([acc('a', 'Bad', { CurrentTemperature: 20 })], alt, { jetzt: JETZT, frischeStunden: 6 });
  assert.deepEqual(e.befunde, []);
});

test('Kontaktsensor wird NICHT auf Frische geprüft', () => {
  const alt = { 'sensor:c|ContactSensorState': { wert: 0, seit: VOR_7H } };
  const e = pruefeSensoren(
    [acc('c', 'Fenster', { ContactSensorState: 0 }, 'ContactSensor')],
    alt, { jetzt: JETZT, frischeStunden: 6 },
  );
  assert.deepEqual(e.befunde, [], 'ein Fenster darf wochenlang zu bleiben');
});

test('Gerät ohne Werte gilt als nicht erreichbar', () => {
  const e = pruefeSensoren([acc('d', 'Flur', {})], {}, { jetzt: JETZT, frischeStunden: 6 });
  assert.equal(e.befunde.length, 1);
  assert.equal(e.befunde[0].schwere, 'kritisch');
  assert.match(e.befunde[0].text, /keine Werte/i);
});

test('Gerät auf der Ausnahmeliste wird übersprungen', () => {
  const alt = { 'sensor:a|CurrentTemperature': { wert: 20, seit: VOR_7H } };
  const e = pruefeSensoren(
    [acc('a', 'Bad', { CurrentTemperature: 20 })],
    alt, { jetzt: JETZT, frischeStunden: 6, ausnahmen: ['Bad'] },
  );
  assert.deepEqual(e.befunde, []);
});

test('bekannte Messwert-Merkmale enthalten Temperatur, Feuchte, Batterie', () => {
  for (const m of ['CurrentTemperature', 'CurrentRelativeHumidity', 'BatteryLevel']) {
    assert.ok(MESSWERT_MERKMALE.has(m), `${m} muss auf Frische geprüft werden`);
  }
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `npm test`
Erwartet: FEHLER — Modul nicht gefunden.

- [ ] **Schritt 3: Umsetzung**

```javascript
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
```

- [ ] **Schritt 4: Test laufen lassen**

Ausführen: `npm test`
Erwartet: alle Tests bestanden. Achte besonders auf den Test „seit darf NICHT zurückgesetzt werden" — wird `seit` bei jedem Lauf neu gesetzt, schlägt die Frische-Prüfung nie an.

- [ ] **Schritt 5: Committen**

```bash
git add src/pruefungen/sensoren.mjs test/sensoren.test.mjs
git commit -m "feat: Sensor-Verfügbarkeit und Frische-Prüfung mit Typ-Ausnahmen"
```

---

## Aufgabe 7: Prüfung der Logfehler

Wichtig: Der Log wird laut Vault-Doku vom Plugin `@homebridge-plugins/homebridge-ewelink` mit Strommess-Zeilen im 5-Sekunden-Takt geflutet. Ohne Filter ersäuft jeder echte Stacktrace.

**Dateien:**
- Anlegen: `src/pruefungen/log.mjs`
- Anlegen: `test/log.test.mjs`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { werteLogAus, RAUSCHEN } from '../src/pruefungen/log.mjs';

test('ruhiger Log erzeugt keinen Befund', () => {
  const zeilen = ['Homebridge is running on port 51826.', 'Loaded plugin: homebridge-hue'];
  assert.deepEqual(werteLogAus(zeilen), []);
});

test('Strommess-Rauschen wird herausgefiltert', () => {
  const zeilen = Array.from({ length: 200 }, () => '[eWeLink] Steckdose current power: 42 W');
  assert.deepEqual(werteLogAus(zeilen), [], 'das 5-Sekunden-Rauschen darf nichts auslösen');
});

test('TypeError wird als kritisch gemeldet', () => {
  const zeilen = ["TypeError: Cannot read properties of undefined (reading 'logManager')"];
  const b = werteLogAus(zeilen);
  assert.equal(b.length, 1);
  assert.equal(b[0].schwere, 'kritisch');
});

test('gleiche Fehlerart wird zu EINEM Befund gebündelt', () => {
  const zeilen = Array.from({ length: 40 }, () => 'ERROR: connection refused');
  const b = werteLogAus(zeilen);
  assert.equal(b.length, 1, '40 gleiche Zeilen sind ein Problem, nicht vierzig');
  assert.match(b[0].text, /40/, 'die Anzahl gehört in den Text');
});

test('unterschiedliche Fehler bleiben getrennt', () => {
  const b = werteLogAus(['ERROR: connection refused', 'TypeError: x is not a function']);
  assert.equal(b.length, 2);
});

test('RAUSCHEN-Muster sind als Liste exportiert und erweiterbar', () => {
  assert.ok(Array.isArray(RAUSCHEN));
  assert.ok(RAUSCHEN.some((r) => r.test('current power: 5 W')));
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `npm test`
Erwartet: FEHLER — Modul nicht gefunden.

- [ ] **Schritt 3: Umsetzung**

```javascript
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
  { re: /TypeError|ReferenceError|SyntaxError/i, schwere: SCHWERE.kritisch, art: 'Programmfehler im Plugin' },
  { re: /\bERROR\b|\[error\]/i, schwere: SCHWERE.warnung, art: 'Fehlermeldung' },
  { re: /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND/i, schwere: SCHWERE.warnung, art: 'Verbindungsproblem' },
  { re: /out of memory|heap out of memory/i, schwere: SCHWERE.kritisch, art: 'Speichermangel' },
];

// Zahlen, Zeitstempel und IDs herausnehmen, damit gleichartige Zeilen zusammenfallen.
const normalisiere = (z) =>
  z.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 120);

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
```

- [ ] **Schritt 4: Test laufen lassen**

Ausführen: `npm test`
Erwartet: alle Tests bestanden.

- [ ] **Schritt 5: Committen**

```bash
git add src/pruefungen/log.mjs test/log.test.mjs
git commit -m "feat: Log-Auswertung mit Rauschfilter und Fehlerbündelung"
```

---

## Aufgabe 8: Prüfung der Systemgesundheit

**Dateien:**
- Anlegen: `src/pruefungen/system.mjs`
- Anlegen: `test/system.test.mjs`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruefeSystem } from '../src/pruefungen/system.mjs';

const grenzen = { platteProzent: 85, ramProzent: 90, tempGrad: 75 };

test('gesundes System erzeugt keine Befunde', () => {
  const b = pruefeSystem({ plattenProzent: 40, ramProzent: 55, tempGrad: 48, gedrosselt: false }, grenzen);
  assert.deepEqual(b, []);
});

test('volle Platte ist kritisch', () => {
  const b = pruefeSystem({ plattenProzent: 92, ramProzent: 50, tempGrad: 40, gedrosselt: false }, grenzen);
  assert.equal(b.length, 1);
  assert.equal(b[0].schwere, 'kritisch');
  assert.equal(b[0].id, 'system:platte');
});

test('hoher RAM ist eine Warnung, kein Alarm', () => {
  const b = pruefeSystem({ plattenProzent: 20, ramProzent: 95, tempGrad: 40, gedrosselt: false }, grenzen);
  assert.equal(b[0].schwere, 'warnung');
});

test('Drosselung des Pi wird gemeldet', () => {
  const b = pruefeSystem({ plattenProzent: 20, ramProzent: 20, tempGrad: 82, gedrosselt: true }, grenzen);
  const ids = b.map((x) => x.id);
  assert.ok(ids.includes('system:drosselung'), 'Unterspannung frisst sonst still die SD-Karte');
  assert.ok(ids.includes('system:temperatur'));
});

test('fehlende Messwerte werden übersprungen statt falsch gemeldet', () => {
  const b = pruefeSystem({ plattenProzent: null, ramProzent: undefined, tempGrad: null, gedrosselt: false }, grenzen);
  assert.deepEqual(b, [], 'ein nicht auslesbarer Wert ist kein Fehler');
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `npm test`
Erwartet: FEHLER — Modul nicht gefunden.

- [ ] **Schritt 3: Umsetzung**

```javascript
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
```

- [ ] **Schritt 4: Test laufen lassen**

Ausführen: `npm test`
Erwartet: alle Tests bestanden.

- [ ] **Schritt 5: Committen**

```bash
git add src/pruefungen/system.mjs test/system.test.mjs
git commit -m "feat: Bewertung der Pi-Systemgesundheit"
```

---

## Aufgabe 9: Messwerte vom Betriebssystem einsammeln

Trennt die unreine Ein-/Ausgabe von der reinen Bewertung aus Aufgabe 8.

**Dateien:**
- Anlegen: `src/sammler.mjs`
- Anlegen: `test/sammler.test.mjs`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leseDf, leseTemperatur, leseThrottled, berechneRamProzent, baueJournalBefehl } from '../src/sammler.mjs';

test('df-Ausgabe wird zu Prozent', () => {
  const ausgabe = `Filesystem     1K-blocks     Used Available Use% Mounted on
/dev/mmcblk0p2  30218764 12345678  16000000  44% /`;
  assert.equal(leseDf(ausgabe), 44);
});

test('unlesbare df-Ausgabe liefert null statt Unsinn', () => {
  assert.equal(leseDf('kaputt'), null);
});

test('Temperatur in Milligrad wird zu Grad', () => {
  assert.equal(leseTemperatur('52738\n'), 52.7);
});

test('throttled-Wert 0x0 heißt: alles in Ordnung', () => {
  assert.equal(leseThrottled('throttled=0x0'), false);
});

test('throttled-Wert ungleich null heißt: gedrosselt', () => {
  assert.equal(leseThrottled('throttled=0x50005'), true);
});

test('RAM-Belegung wird aus frei und gesamt berechnet', () => {
  assert.equal(berechneRamProzent(1_000_000_000, 4_000_000_000), 75);
  assert.equal(berechneRamProzent(0, 0), null, 'ohne Zahlen lieber null als eine erfundene 100');
});

test('Journal-Befehl begrenzt auf den Zeitraum seit dem letzten Lauf', () => {
  const b = baueJournalBefehl('2026-09-07 09:45:00');
  assert.match(b, /--since/);
  assert.match(b, /2026-09-07 09:45:00/);
  assert.match(b, /homebridge/);
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `npm test`
Erwartet: FEHLER — Modul nicht gefunden.

- [ ] **Schritt 3: Umsetzung**

```javascript
// Liest Kennzahlen vom Betriebssystem. Die Parser sind als reine Funktionen
// exportiert und getestet; das Ausführen der Befehle bleibt ungetestet, weil es
// ohnehin nur auf dem Pi läuft.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { freemem, totalmem } from 'node:os';

const lauf = promisify(execFile);

export function berechneRamProzent(frei, gesamt) {
  if (!Number.isFinite(gesamt) || gesamt <= 0) return null;
  return Math.round(((gesamt - frei) / gesamt) * 100);
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
  const ramProzent = berechneRamProzent(freemem(), totalmem());
  return { plattenProzent, tempGrad, gedrosselt, ramProzent };
}

export async function leseJournal(seit) {
  return still(async () => {
    const { stdout } = await lauf('bash', ['-lc', baueJournalBefehl(seit)], { maxBuffer: 8 * 1024 * 1024 });
    return stdout.split('\n');
  }, []);
}

export async function dienstLaeuft() {
  return still(async () => {
    const { stdout } = await lauf('systemctl', ['is-active', 'homebridge']);
    return stdout.trim() === 'active';
  }, false);
}
```

- [ ] **Schritt 4: Test laufen lassen**

Ausführen: `npm test`
Erwartet: alle Tests bestanden.

- [ ] **Schritt 5: Committen**

```bash
git add src/sammler.mjs test/sammler.test.mjs
git commit -m "feat: Sammler für Systemkennzahlen und journalctl"
```

---

## Aufgabe 10: Discord-Melder

**Dateien:**
- Anlegen: `src/melder.mjs`
- Anlegen: `test/melder.test.mjs`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baueMeldung, sendeAnDiscord } from '../src/melder.mjs';

const neu = [
  { id: 'bridge:A', schwere: 'kritisch', titel: 'Child Bridge "Cube" läuft nicht', text: 'Status down' },
];
const warn = [{ id: 'system:ram', schwere: 'warnung', titel: 'RAM bei 95 %', text: 'Leck?' }];

test('kritische Meldung erhält den @-Ping', () => {
  const m = baueMeldung({ neu, behoben: [], pingUserId: '4711' });
  assert.match(m.content, /<@4711>/, 'nur so klingelt das Handy');
});

test('reine Warnung erhält KEINEN Ping', () => {
  const m = baueMeldung({ neu: warn, behoben: [], pingUserId: '4711' });
  assert.equal(m.content ?? '', '');
});

test('ohne konfigurierte UserId gibt es keinen Ping-Platzhalter', () => {
  const m = baueMeldung({ neu, behoben: [], pingUserId: null });
  assert.equal(m.content ?? '', '');
});

test('Entwarnung wird als eigenes grünes Embed geführt', () => {
  const m = baueMeldung({ neu: [], behoben: [{ id: 'bridge:A', titel: 'Child Bridge "Cube" läuft nicht' }], pingUserId: null });
  assert.equal(m.embeds.length, 1);
  assert.equal(m.embeds[0].color, 0x22c55e);
  assert.match(m.embeds[0].title, /behoben/i);
});

test('ohne Befunde entsteht gar keine Meldung', () => {
  assert.equal(baueMeldung({ neu: [], behoben: [], pingUserId: null }), null);
});

test('Senden ohne Webhook-URL wirft nicht, sondern meldet Überspringen', async () => {
  const e = await sendeAnDiscord(null, { embeds: [] });
  assert.equal(e.uebersprungen, true);
});

test('Netzwerkfehler beim Senden lässt den Lauf nicht scheitern', async () => {
  const kaputt = async () => { throw new Error('Netz weg'); };
  const e = await sendeAnDiscord('https://x', { embeds: [] }, kaputt);
  assert.equal(e.ok, false);
  assert.match(e.fehler, /Netz weg/);
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `npm test`
Erwartet: FEHLER — Modul nicht gefunden.

- [ ] **Schritt 3: Umsetzung**

```javascript
// Baut die Discord-Nachricht und schickt sie. Nach dem Vorbild von
// ki-dashboard/src/lib/discord.mjs: Netzwerkfehler werfen nie, damit eine
// gestörte Benachrichtigung nie den ganzen Prüflauf abbricht.

const ROT = 0xef4444, GELB = 0xf59e0b, GRUEN = 0x22c55e, GRAU = 0x64748b;
const FARBE = { kritisch: ROT, warnung: GELB, hinweis: GRAU };
const ICON = { kritisch: '🔴', warnung: '🟡', hinweis: '🔵' };

export function baueMeldung({ neu = [], behoben = [], pingUserId = null }) {
  if (neu.length === 0 && behoben.length === 0) return null;

  const embeds = [];
  for (const b of neu.slice(0, 8)) {
    embeds.push({
      title: `${ICON[b.schwere] ?? '•'} ${b.titel}`,
      description: b.text || undefined,
      color: FARBE[b.schwere] ?? GRAU,
      footer: { text: 'Homebridge-Wächter' },
      timestamp: new Date().toISOString(),
    });
  }
  if (behoben.length > 0) {
    embeds.push({
      title: `✅ ${behoben.length === 1 ? 'Problem behoben' : `${behoben.length} Probleme behoben`}`,
      description: behoben.map((b) => `• ${b.titel}`).join('\n'),
      color: GRUEN,
      footer: { text: 'Homebridge-Wächter' },
      timestamp: new Date().toISOString(),
    });
  }
  if (neu.length > 8) {
    embeds.push({ title: `… und ${neu.length - 8} weitere`, color: GRAU });
  }

  const kritisch = neu.some((b) => b.schwere === 'kritisch');
  return { content: kritisch && pingUserId ? `<@${pingUserId}>` : '', embeds };
}

export async function sendeAnDiscord(webhookUrl, nutzlast, fetchImpl = fetch) {
  if (!webhookUrl) return { ok: false, uebersprungen: true, grund: 'keine Webhook-URL' };
  if (!nutzlast) return { ok: true, uebersprungen: true, grund: 'nichts zu melden' };
  try {
    const res = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(nutzlast),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status };
  } catch (e) {
    return { ok: false, fehler: e.message };
  }
}
```

- [ ] **Schritt 4: Test laufen lassen**

Ausführen: `npm test`
Erwartet: alle Tests bestanden.

- [ ] **Schritt 5: Committen**

```bash
git add src/melder.mjs test/melder.test.mjs
git commit -m "feat: Discord-Melder mit Ping nur bei kritischen Befunden"
```

---

## Aufgabe 11: Täglicher Lebenszeichen-Bericht

Der Bericht ist der Ersatz für einen Totmann-Schalter: Bleibt er aus, ist der Pi weg.

**Dateien:**
- Anlegen: `src/bericht.mjs`
- Anlegen: `test/bericht.test.mjs`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berichtFaellig, baueBericht } from '../src/bericht.mjs';

const um = (uhrzeit) => new Date(`2026-09-07T${uhrzeit}:00+02:00`);

test('vor der Berichtszeit ist nichts fällig', () => {
  assert.equal(berichtFaellig({ letzterBericht: null }, { jetzt: um('06:30'), berichtUm: '07:00' }), false);
});

test('nach der Berichtszeit und noch keiner heute: fällig', () => {
  assert.equal(berichtFaellig({ letzterBericht: '2026-09-06' }, { jetzt: um('07:05'), berichtUm: '07:00' }), true);
});

test('heute schon berichtet: nicht noch einmal', () => {
  assert.equal(berichtFaellig({ letzterBericht: '2026-09-07' }, { jetzt: um('12:00'), berichtUm: '07:00' }), false);
});

test('Bericht ohne Probleme ist grün und nennt die Zahlen', () => {
  const e = baueBericht({ offen: {}, kennzahlen: { bridges: 4, sensoren: 37, plattenProzent: 44 } });
  assert.equal(e.embeds[0].color, 0x22c55e);
  assert.match(e.embeds[0].description, /37/);
  assert.match(e.embeds[0].description, /4/);
});

test('Bericht mit offenen Problemen erinnert an jedes einzelne', () => {
  const offen = {
    'bridge:A': { titel: 'Child Bridge "Cube" läuft nicht', seit: '2026-09-01T10:00:00Z', schwere: 'kritisch' },
  };
  const e = baueBericht({ offen, kennzahlen: { bridges: 4, sensoren: 37, plattenProzent: 44 } });
  assert.equal(e.embeds[0].color, 0xef4444);
  assert.match(e.embeds[0].description, /Cube/);
  assert.match(e.embeds[0].description, /seit/i, 'die Dauer macht den Druck');
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `npm test`
Erwartet: FEHLER — Modul nicht gefunden.

- [ ] **Schritt 3: Umsetzung**

```javascript
// Einmal täglich ein Lebenszeichen — auch wenn alles gesund ist. Bleibt die
// Nachricht aus, ist der Pi oder das Netz weg. Das ist der bewusst gewählte
// Ersatz für einen externen Totmann-Dienst.

const ROT = 0xef4444, GRUEN = 0x22c55e;

const alsTag = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(d);

export function berichtFaellig(zustand, { jetzt = new Date(), berichtUm = '07:00' } = {}) {
  const [std, min] = berichtUm.split(':').map(Number);
  const lokal = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(jetzt);
  const [hJetzt, mJetzt] = lokal.split(':').map(Number);
  const nachZeit = hJetzt * 60 + mJetzt >= std * 60 + min;
  return nachZeit && zustand.letzterBericht !== alsTag(jetzt);
}

export function baueBericht({ offen = {}, kennzahlen = {}, jetzt = new Date() }) {
  const probleme = Object.entries(offen);
  const { bridges = 0, sensoren = 0, plattenProzent = null } = kennzahlen;

  const kopf = `**${bridges}** Child Bridges · **${sensoren}** Geräte`
    + (plattenProzent != null ? ` · Platte **${plattenProzent} %**` : '');

  if (probleme.length === 0) {
    return {
      embeds: [{
        title: '✅ Homebridge — Tagesbericht',
        description: `${kopf}\n\nKeine offenen Auffälligkeiten.`,
        color: GRUEN,
        footer: { text: 'Homebridge-Wächter' },
        timestamp: jetzt.toISOString(),
      }],
    };
  }

  const liste = probleme.map(([, p]) => {
    const tage = p.seit ? Math.floor((jetzt - new Date(p.seit)) / 86400000) : null;
    const dauer = tage == null ? '' : tage >= 1 ? ` — offen seit ${tage} Tag${tage === 1 ? '' : 'en'}` : ' — seit heute';
    return `• ${p.titel}${dauer}`;
  }).join('\n');

  return {
    embeds: [{
      title: `⚠️ Homebridge — Tagesbericht (${probleme.length} offen)`,
      description: `${kopf}\n\n${liste}`,
      color: ROT,
      footer: { text: 'Homebridge-Wächter' },
      timestamp: jetzt.toISOString(),
    }],
  };
}

export { alsTag };
```

- [ ] **Schritt 4: Test laufen lassen**

Ausführen: `npm test`
Erwartet: alle Tests bestanden.

- [ ] **Schritt 5: Committen**

```bash
git add src/bericht.mjs test/bericht.test.mjs
git commit -m "feat: täglicher Lebenszeichen-Bericht mit Erinnerung an offene Probleme"
```

---

## Aufgabe 12: Konfiguration

**Dateien:**
- Anlegen: `src/konfig.mjs`
- Anlegen: `config.beispiel.json`
- Anlegen: `test/konfig.test.mjs`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruefeKonfig, STANDARD } from '../src/konfig.mjs';

const gueltig = {
  homebridge: { url: 'http://localhost:8581', benutzer: 'waechter', passwort: 'geheim' },
  discord: { webhook: 'https://discord.com/api/webhooks/1/x' },
};

test('gültige Konfiguration wird mit Standardwerten aufgefüllt', () => {
  const k = pruefeKonfig(gueltig);
  assert.equal(k.schwellen.frischeStunden, STANDARD.schwellen.frischeStunden);
  assert.equal(k.takt.entprellung, 2);
});

test('fehlendes Passwort wird klar benannt', () => {
  assert.throws(() => pruefeKonfig({ ...gueltig, homebridge: { url: 'x', benutzer: 'y' } }), /passwort/i);
});

test('fehlender Webhook wird klar benannt', () => {
  assert.throws(() => pruefeKonfig({ ...gueltig, discord: {} }), /webhook/i);
});

test('eigene Schwellen überschreiben die Standardwerte', () => {
  const k = pruefeKonfig({ ...gueltig, schwellen: { frischeStunden: 12 } });
  assert.equal(k.schwellen.frischeStunden, 12);
  assert.equal(k.schwellen.platteProzent, STANDARD.schwellen.platteProzent, 'nicht genannte Werte bleiben');
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `npm test`
Erwartet: FEHLER — Modul nicht gefunden.

- [ ] **Schritt 3: Umsetzung**

```javascript
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
```

- [ ] **Schritt 4: Beispieldatei anlegen**

`config.beispiel.json`:

```json
{
  "homebridge": {
    "url": "http://localhost:8581",
    "benutzer": "waechter",
    "passwort": "HIER-DAS-PASSWORT-DES-WAECHTER-BENUTZERS"
  },
  "discord": {
    "webhook": "HIER-DIE-WEBHOOK-URL",
    "pingUserId": "HIER-DEINE-DISCORD-USER-ID"
  },
  "takt": { "wartungVon": "03:55", "wartungBis": "04:10", "berichtUm": "07:00", "entprellung": 2 },
  "schwellen": { "frischeStunden": 6, "platteProzent": 85, "ramProzent": 90, "tempGrad": 75 },
  "sensorAusnahmen": []
}
```

- [ ] **Schritt 5: Test laufen lassen und committen**

```bash
npm test && git add src/konfig.mjs config.beispiel.json test/konfig.test.mjs && git commit -m "feat: Konfiguration mit Standardwerten und klaren Fehlermeldungen"
```

---

## Aufgabe 13: Orchestrierung und Wartungsfenster

Bindet alles zusammen. Das Wartungsfenster verhindert Fehlalarme durch den täglichen 04:00-Neustart.

**Dateien:**
- Anlegen: `src/waechter.mjs`
- Anlegen: `test/wartungsfenster.test.mjs`

- [ ] **Schritt 1: Fehlschlagenden Test schreiben**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imWartungsfenster } from '../src/waechter.mjs';

const um = (u) => new Date(`2026-09-07T${u}:00+02:00`);
const takt = { wartungVon: '03:55', wartungBis: '04:10' };

test('mitten im Neustartfenster wird nicht gemeldet', () => {
  assert.equal(imWartungsfenster(um('04:00'), takt), true);
});

test('kurz davor und kurz danach wird gemeldet', () => {
  assert.equal(imWartungsfenster(um('03:50'), takt), false);
  assert.equal(imWartungsfenster(um('04:15'), takt), false);
});

test('tagsüber ist kein Wartungsfenster', () => {
  assert.equal(imWartungsfenster(um('14:00'), takt), false);
});

test('Fenster über Mitternacht funktioniert', () => {
  assert.equal(imWartungsfenster(um('23:58'), { wartungVon: '23:55', wartungBis: '00:10' }), true);
  assert.equal(imWartungsfenster(um('00:05'), { wartungVon: '23:55', wartungBis: '00:10' }), true);
  assert.equal(imWartungsfenster(um('12:00'), { wartungVon: '23:55', wartungBis: '00:10' }), false);
});
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Ausführen: `npm test`
Erwartet: FEHLER — Modul nicht gefunden.

- [ ] **Schritt 3: Umsetzung**

```javascript
#!/usr/bin/env node
// Einstiegspunkt. Ein Lauf = ein Prozess, vom systemd-Timer alle 15 Minuten
// gestartet. Reihenfolge: sammeln → bewerten → mit letztem Lauf vergleichen →
// reparieren → melden → Zustand sichern.
//
// Aufruf:
//   node src/waechter.mjs                    normaler Lauf
//   node src/waechter.mjs --trocken          prüft und zeigt an, sendet aber nichts
//   node src/waechter.mjs --konfig /pfad     andere Konfigurationsdatei

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

async function lauf() {
  const argv = process.argv.slice(2);
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
    console.log(JSON.stringify({ befunde: befunde.length, neu, behoben }, null, 2));
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
    if (!trocken) await sendeAnDiscord(k.discord.webhook, bericht);
    zustand.letzterBericht = alsTag(jetzt);
    console.log('Tagesbericht gesendet.');
  }

  if (!trocken) await speichereZustand(k.zustandsdatei, zustand);
  console.log(`Lauf beendet: ${befunde.length} Befunde, ${neu.length} neu, ${behoben.length} behoben.`);
  return 0;
}

// Nur ausführen, wenn direkt gestartet — nicht beim Import im Test.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  lauf().then((c) => process.exit(c)).catch((e) => {
    console.error('Wächter-Lauf abgebrochen:', e.message);
    process.exit(1);
  });
}
```

- [ ] **Schritt 4: Test laufen lassen**

Ausführen: `npm test`
Erwartet: alle Tests bestanden, auch der Mitternachtsfall.

- [ ] **Schritt 5: Committen**

```bash
git add src/waechter.mjs test/wartungsfenster.test.mjs
git commit -m "feat: Orchestrierung mit Wartungsfenster und einmaliger Bridge-Reparatur"
```

---

## Aufgabe 14: systemd-Einheiten

**Dateien:**
- Anlegen: `systemd/homebridge-waechter.service`
- Anlegen: `systemd/homebridge-waechter.timer`

- [ ] **Schritt 1: Dienst-Einheit anlegen**

```ini
[Unit]
Description=Homebridge-Wächter — Prüflauf
After=homebridge.service
Wants=network-online.target

[Service]
Type=oneshot
User=root
WorkingDirectory=/opt/homebridge-waechter
ExecStart=/opt/homebridge/bin/node /opt/homebridge-waechter/src/waechter.mjs
TimeoutStartSec=120
StandardOutput=journal
StandardError=journal
```

Begründung `User=root`: `journalctl -u homebridge` und `vcgencmd` brauchen erhöhte Rechte, und die Konfiguration liegt mit Rechten 600 unter `/etc`.

- [ ] **Schritt 2: Timer-Einheit anlegen**

```ini
[Unit]
Description=Homebridge-Wächter alle 15 Minuten

[Timer]
OnCalendar=*:0/15
Persistent=true
RandomizedDelaySec=30
Unit=homebridge-waechter.service

[Install]
WantedBy=timers.target
```

`RandomizedDelaySec=30` verhindert, dass der Lauf jedes Mal exakt auf die Viertelstunde fällt und mit anderen Aufgaben kollidiert. `Persistent=true` holt einen verpassten Lauf nach einem Neustart nach.

- [ ] **Schritt 3: Syntax lokal prüfen**

Ausführen: `grep -c '=' systemd/homebridge-waechter.timer`
Erwartet: mindestens 6 Zeilen mit Zuweisungen. (Die echte Prüfung macht `systemd-analyze verify` auf dem Pi in Aufgabe 16.)

- [ ] **Schritt 4: Committen**

```bash
git add systemd/
git commit -m "feat: systemd-Dienst und 15-Minuten-Timer"
```

---

## Aufgabe 15: Installer und Einzeiler-Update

**Dateien:**
- Anlegen: `install.sh`
- Anlegen: `update.sh`

- [ ] **Schritt 1: install.sh anlegen**

```bash
#!/usr/bin/env bash
# Homebridge-Wächter einrichten. Im Terminal der Homebridge-Oberfläche einfügen.
# Fragt interaktiv nach Passwort und Webhook — nichts davon steht im Repo.
set -euo pipefail

REPO="https://github.com/m4rc0815/homebridge-waechter.git"
ZIEL="/opt/homebridge-waechter"
KONFIG_DIR="/etc/homebridge-waechter"
NODE="/opt/homebridge/bin/node"

echo "==> Homebridge-Wächter wird eingerichtet"

[ -x "$NODE" ] || { echo "FEHLER: $NODE nicht gefunden."; exit 1; }
command -v git >/dev/null || sudo apt-get install -y git

if [ -d "$ZIEL/.git" ]; then
  echo "==> Vorhandene Installation wird aktualisiert"
  sudo git -C "$ZIEL" pull --ff-only
else
  sudo git clone --depth 1 "$REPO" "$ZIEL"
fi

sudo mkdir -p "$KONFIG_DIR" /var/lib/homebridge-waechter

if [ ! -f "$KONFIG_DIR/config.json" ]; then
  echo
  echo "--- Zugangsdaten ---"
  read -rp "Homebridge-Benutzer für den Wächter [waechter]: " HB_USER
  HB_USER="${HB_USER:-waechter}"
  read -rsp "Passwort dieses Benutzers: " HB_PASS; echo
  read -rp "Discord-Webhook-URL: " DC_HOOK
  read -rp "Deine Discord-User-ID (für @-Ping bei Alarm, leer = kein Ping): " DC_UID

  sudo tee "$KONFIG_DIR/config.json" >/dev/null <<JSON
{
  "homebridge": { "url": "http://localhost:8581", "benutzer": "$HB_USER", "passwort": "$HB_PASS" },
  "discord": { "webhook": "$DC_HOOK", "pingUserId": "$DC_UID" },
  "takt": { "wartungVon": "03:55", "wartungBis": "04:10", "berichtUm": "07:00", "entprellung": 2 },
  "schwellen": { "frischeStunden": 6, "platteProzent": 85, "ramProzent": 90, "tempGrad": 75 },
  "sensorAusnahmen": [],
  "zustandsdatei": "/var/lib/homebridge-waechter/zustand.json"
}
JSON
  sudo chmod 600 "$KONFIG_DIR/config.json"
  echo "==> Konfiguration geschrieben (Rechte 600)"
else
  echo "==> Konfiguration existiert bereits, bleibt unverändert"
fi

sudo cp "$ZIEL/systemd/homebridge-waechter.service" /etc/systemd/system/
sudo cp "$ZIEL/systemd/homebridge-waechter.timer" /etc/systemd/system/
sudo cp "$ZIEL/update.sh" /usr/local/bin/homebridge-waechter-update
sudo chmod +x /usr/local/bin/homebridge-waechter-update
sudo systemctl daemon-reload
sudo systemctl enable --now homebridge-waechter.timer

echo
echo "==> Probelauf (sendet nichts):"
sudo "$NODE" "$ZIEL/src/waechter.mjs" --trocken || echo "Probelauf meldete einen Fehler — Ausgabe oben prüfen."

echo
echo "==> Fertig. Nächster Lauf:"
systemctl list-timers homebridge-waechter.timer --no-pager
echo
echo "Ab jetzt genügt für Updates:  sudo homebridge-waechter-update"
```

- [ ] **Schritt 2: update.sh anlegen**

```bash
#!/usr/bin/env bash
# Aktualisiert den Wächter aus dem Repo. Konfiguration bleibt unangetastet.
set -euo pipefail
ZIEL="/opt/homebridge-waechter"

sudo git -C "$ZIEL" pull --ff-only
sudo cp "$ZIEL/systemd/homebridge-waechter.service" /etc/systemd/system/
sudo cp "$ZIEL/systemd/homebridge-waechter.timer" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart homebridge-waechter.timer
echo "==> Aktualisiert auf $(sudo git -C "$ZIEL" log -1 --format='%h %s')"
sudo /opt/homebridge/bin/node "$ZIEL/src/waechter.mjs" --trocken
```

- [ ] **Schritt 3: Ausführbar machen und Syntax prüfen**

```bash
chmod +x install.sh update.sh
bash -n install.sh && bash -n update.sh && echo "Syntax in Ordnung"
```
Erwartet: `Syntax in Ordnung`

- [ ] **Schritt 4: Committen**

```bash
git add install.sh update.sh
git commit -m "feat: Installer mit interaktiver Zugangsdaten-Abfrage und Einzeiler-Update"
```

---

## Aufgabe 16: Erkundungslauf gegen die echte API

Bis hierher beruhen die Feldnamen auf der OpenAPI-Spezifikation und der Homebridge-Quelle. Bevor die Auswertung als fertig gilt, werden sie gegen die echte Anlage geprüft. **Dieser Schritt ist nicht optional** — schlägt ein Feldname fehl, meldet der Wächter still gar nichts.

**Dateien:**
- Anlegen: `tools/erkunde.mjs`

- [ ] **Schritt 1: Erkundungswerkzeug anlegen**

```javascript
#!/usr/bin/env node
// Einmaliges Werkzeug: fragt die echte Homebridge ab und zeigt die tatsächlichen
// Feldnamen. Gibt bewusst KEINE Werte aus, die Rückschlüsse auf Geheimnisse zulassen.
//
// Aufruf auf dem Pi:  sudo /opt/homebridge/bin/node tools/erkunde.mjs

import { ladeKonfig } from '../src/konfig.mjs';
import { HbApi } from '../src/hbapi.mjs';

const k = await ladeKonfig(process.argv[2] ?? '/etc/homebridge-waechter/config.json');
const api = new HbApi(k.homebridge);

const status = await api.status();
console.log('--- /api/status/homebridge ---');
console.log(JSON.stringify(status, null, 2));

const bridges = await api.childBridges();
console.log(`\n--- child-bridges (${bridges.length}) ---`);
console.log('Felder:', Object.keys(bridges[0] ?? {}).join(', '));
for (const b of bridges) console.log(`  ${b.status?.padEnd(8)} ${b.name} (${b.username}) ${b.plugin ?? ''}`);

const acc = await api.accessories();
console.log(`\n--- accessories (${acc.length}) ---`);
console.log('Felder:', Object.keys(acc[0] ?? {}).join(', '));
const typen = {};
for (const a of acc) typen[a.humanType] = (typen[a.humanType] ?? 0) + 1;
console.log('Gerätetypen:', JSON.stringify(typen, null, 2));
const merkmale = new Set();
for (const a of acc) for (const m of Object.keys(a.values ?? {})) merkmale.add(m);
console.log('Vorkommende Merkmale:', [...merkmale].sort().join(', '));
const ohneWerte = acc.filter((a) => Object.keys(a.values ?? {}).length === 0);
console.log(`Geräte ohne Werte: ${ohneWerte.length}`, ohneWerte.map((a) => a.serviceName).join(', '));
```

- [ ] **Schritt 2: Auf dem Pi ausführen**

Im Terminal der Homebridge-Oberfläche:
```bash
sudo /opt/homebridge/bin/node /opt/homebridge-waechter/tools/erkunde.mjs
```
Erwartet: Listen der echten Bridges, Gerätetypen und Merkmale.

- [ ] **Schritt 3: Abgleich mit dem Code**

Prüfe drei Dinge und bessere nach, falls sie abweichen:
1. Heißen die Bridge-Felder wirklich `status`, `username`, `name`, `plugin`? Falls nicht → `src/pruefungen/bridges.mjs` anpassen.
2. Kommen in `Vorkommende Merkmale` Namen vor, die in `MESSWERT_MERKMALE` fehlen (etwa herstellereigene Merkmale)? Dann in `src/pruefungen/sensoren.mjs` ergänzen.
3. Stehen in `Gerätetypen` Typen, die in `OHNE_FRISCHE` fehlen und sich nicht laufend ändern? Ergänzen, sonst gibt es Fehlalarme.

- [ ] **Schritt 4: Nachbesserungen committen**

```bash
git add -A && git commit -m "fix: Feldnamen und Merkmalslisten an die echte Anlage angeglichen"
```

---

## Aufgabe 17: Dokumentation

**Dateien:**
- Anlegen: `README.md`
- Anlegen: `~/Documents/Claude/Projects/Vault/Mein Vault/04 Ressourcen/Smart Home/Homebridge/Homebridge-Waechter.md`

- [ ] **Schritt 1: README.md schreiben**

````markdown
# Homebridge-Wächter

Überwacht Homebridge auf dem Raspberry Pi und meldet Auffälligkeiten per Discord.
Läuft als systemd-Timer alle 15 Minuten. Keine Laufzeit-Abhängigkeiten.

## Was geprüft wird

| Bereich | Prüfung | Schwere |
|---|---|---|
| Dienst | `homebridge.service` antwortet nicht | kritisch |
| Child Bridges | Bridge auf `down` (von Hand gestoppte ausgenommen) | kritisch |
| Sensoren | Gerät liefert gar keine Werte mehr | kritisch |
| Sensoren | Messwert seit > 6 h unverändert | warnung |
| Log | `TypeError` / Speichermangel im journal | kritisch |
| Log | `ERROR`, Verbindungsabbrüche | warnung |
| System | Platte ≥ 85 % | kritisch |
| System | RAM ≥ 90 %, Temperatur ≥ 75 °C, Pi drosselt | warnung |

Kontakt-, Bewegungs- und Schaltgeräte werden **nicht** auf Frische geprüft —
dort ist ein unveränderter Wert der Normalfall.

## Wann gemeldet wird

Nur bei **Zustandswechsel**, nie wiederholt:

- Neues Problem → gemeldet, nachdem es **zwei Läufe** hintereinander bestand (Entprellung gegen kurze Aussetzer)
- Problem verschwunden → **Entwarnung**
- Problem besteht weiter → keine neue Nachricht, aber Erwähnung im Tagesbericht
- Warnung wird zu kritisch → erneute Meldung
- Kritische Befunde lösen zusätzlich einen `@`-Ping aus

Einmal täglich (Standard 07:00) kommt ein **Lebenszeichen-Bericht**, auch wenn alles
gesund ist. Bleibt er aus, ist der Pi oder das Netz weg — das ist der bewusste Ersatz
für einen externen Totmann-Dienst.

Zwischen 03:55 und 04:10 wird nicht geprüft: dort läuft der tägliche
Homebridge-Neustart, der sonst jeden Morgen einen Fehlalarm auslösen würde.

## Selbstheilung

Eine tot gemeldete **Child Bridge** wird **genau einmal** neu gestartet; das Ergebnis
steht in der Meldung. Hilft es nicht, wird nicht weiter versucht — sonst würde ein
hartnäckiger Fehler durch endlose Neustarts überdeckt statt behoben.
Der Hauptdienst `homebridge.service` wird **nie** automatisch angefasst.

## Installation

Im Terminal der Homebridge-Oberfläche (Menü oben rechts → Terminal):

```bash
curl -fsSL https://raw.githubusercontent.com/m4rc0815/homebridge-waechter/main/install.sh | bash
```

Der Installer fragt nach Homebridge-Benutzer, Passwort, Discord-Webhook und
Discord-User-ID und legt daraus `/etc/homebridge-waechter/config.json` mit
Rechten 600 an.

**Vorbereitung:** In der Homebridge-Oberfläche unter *Benutzer* einen eigenen
Benutzer `waechter` anlegen. Nicht den eigenen Admin-Zugang eintragen.

## Update

```bash
sudo homebridge-waechter-update
```

## Konfiguration

`/etc/homebridge-waechter/config.json`:

| Feld | Bedeutung | Standard |
|---|---|---|
| `takt.entprellung` | Läufe, die ein Problem bestehen muss | `2` |
| `takt.berichtUm` | Uhrzeit des Tagesberichts | `07:00` |
| `takt.wartungVon` / `wartungBis` | Fenster ohne Prüfung | `03:55` / `04:10` |
| `schwellen.frischeStunden` | ab wann ein Messwert als eingefroren gilt | `6` |
| `schwellen.platteProzent` | Alarmschwelle Speicherplatz | `85` |
| `schwellen.ramProzent` | Warnschwelle Arbeitsspeicher | `90` |
| `schwellen.tempGrad` | Warnschwelle Pi-Temperatur | `75` |
| `sensorAusnahmen` | Gerätenamen, die nie gemeldet werden | `[]` |

Nach jeder Änderung: `sudo systemctl restart homebridge-waechter.timer`

## Fehlersuche

```bash
sudo /opt/homebridge/bin/node /opt/homebridge-waechter/src/waechter.mjs --trocken
```

Prüft alles und zeigt das Ergebnis an, **ohne** etwas nach Discord zu senden.

```bash
journalctl -u homebridge-waechter -n 50 --no-pager
systemctl list-timers homebridge-waechter.timer
```

## Zustandsdatei als Schnittstelle

`/var/lib/homebridge-waechter/zustand.json` hält den kompletten Lagebericht
(offene Probleme mit Zeitpunkt, Verdachtsfälle, letzte Sensorwerte). Sie ist
bewusst als stabile, maschinenlesbare Schnittstelle geführt — ein späteres
Dashboard-Panel kann sie ohne Umbau am Wächter auslesen.

## Sicherheit

`config.json` enthält Passwort und Webhook-URL und steht in `.gitignore`.
Sie gehört **niemals** ins Repo.
````

- [ ] **Schritt 2: Vault-Notiz schreiben**

Anlegen unter `04 Ressourcen/Smart Home/Homebridge/Homebridge-Waechter.md`, nach dem
Muster der vorhandenen Notiz `Homebridge Taeglicher Neustart.md`:

````markdown
---
tags: [smarthome, homebridge, überwachung]
angelegt: 2026-09-07
---

# Homebridge-Wächter

Überwacht [[Homebridge Taeglicher Neustart|Homebridge]] auf dem Pi (192.168.178.116)
alle 15 Minuten und meldet nach Discord. Code: `m4rc0815/homebridge-waechter`,
installiert unter `/opt/homebridge-waechter`.

## Warum die Entscheidungen so fielen

**Entprellung über zwei Läufe.** Ein einzelner Aussetzer — etwa während des
Plugin-Neustarts — soll nicht alarmieren. Erst wenn ein Problem 30 Minuten
besteht, gilt es als echt.

**Wartungsfenster 03:55–04:10.** Der tägliche Neustart nimmt Homebridge rund
30 Sekunden vom Netz. Ohne das Fenster gäbe es jeden Morgen einen Fehlalarm.

**Nur ein Reparaturversuch.** Beim eWeLink-CUBE-Absturz (siehe
[[eWeLink CUBE Bridge Absturz]]) hätten endlose Neustarts die eigentliche
Ursache — der fehlende `/etc/hosts`-Eintrag — dauerhaft überdeckt.

**Frische-Prüfung nur für Messwerte.** Ein Fensterkontakt darf wochenlang
unverändert bleiben. Nur Temperatur, Feuchte, Batterie und ähnliche Größen
müssen sich bewegen.

**Täglicher Bericht statt Totmann-Dienst.** Ein Wächter auf dem überwachten
Gerät kann seinen eigenen Ausfall nicht melden. Bleibt der 07:00-Bericht aus,
ist der Pi weg.

## Zugangsfallen

- Das Terminal der Homebridge-Oberfläche nimmt **keine automatisierten
  Tastatureingaben** an (xterm.js akzeptiert nur echte Events) — Befehle muss
  Marc selbst einfügen.
- `systemctl restart homebridge` reißt die Oberfläche und damit das Terminal
  mit ab. Erwartet, kein Fehler; nach ~30 s Seite neu laden.
- Die Zugangsdaten stehen in `/etc/homebridge-waechter/config.json` (Rechte 600)
  und nie im Repo.

## Bedienung

| Zweck | Befehl |
|---|---|
| Update | `sudo homebridge-waechter-update` |
| Probelauf ohne Senden | `sudo /opt/homebridge/bin/node /opt/homebridge-waechter/src/waechter.mjs --trocken` |
| Log | `journalctl -u homebridge-waechter -n 50 --no-pager` |
| Nächster Lauf | `systemctl list-timers homebridge-waechter.timer` |
| Schwellwerte ändern | `sudo nano /etc/homebridge-waechter/config.json`, danach Timer neu starten |
````

- [ ] **Schritt 3: Committen und Repo veröffentlichen**

```bash
git add README.md
git commit -m "docs: Bedienungsanleitung"
gh repo create m4rc0815/homebridge-waechter --public --source=. --push
```

Erwartet: Das Repo erscheint unter `https://github.com/m4rc0815/homebridge-waechter`.

---

## Abschluss-Prüfung

- [ ] `npm test` — alle Tests grün
- [ ] Installer auf dem Pi gelaufen, Timer aktiv (`systemctl list-timers homebridge-waechter.timer`)
- [ ] Trockenlauf zeigt echte Bridges und Geräte
- [ ] Eine Testmeldung ist in Discord angekommen
- [ ] Erkundungslauf gemacht, Feldnamen bestätigt
- [ ] Vault-Notiz angelegt
