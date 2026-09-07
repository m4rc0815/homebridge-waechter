# Homebridge-Wächter

Überwacht Homebridge auf dem Raspberry Pi und meldet Auffälligkeiten per Discord.
Läuft als systemd-Timer alle 15 Minuten. **Keine Laufzeit-Abhängigkeiten** — kein
`npm install` auf dem Pi nötig.

## Was geprüft wird

| Bereich | Prüfung | Schwere |
|---|---|---|
| Dienst | Homebridge antwortet nicht | kritisch |
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

- Neues Problem → gemeldet, nachdem es **zwei Läufe** hintereinander bestand
  (Entprellung gegen kurze Aussetzer)
- Problem verschwunden → **Entwarnung**
- Problem besteht weiter → keine neue Nachricht, aber Erwähnung im Tagesbericht
- Warnung wird zu kritisch → erneute Meldung
- Kritische Befunde lösen zusätzlich einen `@`-Ping aus

Einmal täglich (Standard 07:00) kommt ein **Lebenszeichen-Bericht**, auch wenn
alles gesund ist. Bleibt er aus, ist der Pi oder das Netz weg — das ist der
bewusste Ersatz für einen externen Totmann-Dienst.

Zwischen 03:55 und 04:10 wird nicht geprüft: dort läuft der tägliche
Homebridge-Neustart, der sonst jeden Morgen einen Fehlalarm auslösen würde.

## Selbstheilung

Eine tot gemeldete **Child Bridge** wird **genau einmal** neu gestartet; das
Ergebnis steht in der Meldung. Hilft es nicht, wird nicht weiter versucht — sonst
würde ein hartnäckiger Fehler durch endlose Neustarts überdeckt statt behoben.
Der Hauptdienst `homebridge.service` wird **nie** automatisch angefasst.

## Installation

**Vorbereitung:** In der Homebridge-Oberfläche unter *Benutzer* einen eigenen
Benutzer `waechter` anlegen. Nicht den eigenen Admin-Zugang eintragen.

Im Terminal der Homebridge-Oberfläche (Menü oben rechts → Terminal):

```bash
curl -fsSL https://raw.githubusercontent.com/m4rc0815/homebridge-waechter/main/install.sh | bash
```

Der Installer fragt nach Homebridge-Benutzer, Passwort, Discord-Webhook und
Discord-User-ID und legt daraus `/etc/homebridge-waechter/config.json` mit
Rechten 600 an.

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

Probelauf, der alles prüft und anzeigt, aber **nichts** nach Discord sendet:

```bash
sudo /opt/homebridge/bin/node /opt/homebridge-waechter/src/waechter.mjs --trocken
```

```bash
journalctl -u homebridge-waechter -n 50 --no-pager
systemctl list-timers homebridge-waechter.timer
```

Echte Feldnamen der eigenen Anlage anzeigen:

```bash
sudo /opt/homebridge/bin/node /opt/homebridge-waechter/tools/erkunde.mjs
```

## Aufbau

| Datei | Verantwortung |
|---|---|
| `src/waechter.mjs` | Orchestrierung eines Laufs, Wartungsfenster |
| `src/zustand.mjs` | Entprellung, Wechselerkennung — Herzstück |
| `src/befund.mjs` | Befund-Datentyp mit stabilen IDs |
| `src/hbapi.mjs` | Homebridge-API-Client |
| `src/pruefungen/*.mjs` | die vier Prüfbereiche |
| `src/sammler.mjs` | Kennzahlen vom Betriebssystem |
| `src/melder.mjs` | Discord-Nachrichten |
| `src/bericht.mjs` | Tagesbericht |

Alle Prüfmodule sind reine Funktionen über eingespeiste Daten — deshalb laufen
die 70 Tests ohne Pi und ohne Netz:

```bash
npm test
```

## Zustandsdatei als Schnittstelle

`/var/lib/homebridge-waechter/zustand.json` hält den kompletten Lagebericht
(offene Probleme mit Zeitpunkt, Verdachtsfälle, letzte Sensorwerte). Sie ist
bewusst als stabile, maschinenlesbare Schnittstelle geführt — ein späteres
Dashboard-Panel kann sie ohne Umbau am Wächter auslesen.

## Sicherheit

`config.json` enthält Passwort und Webhook-URL und steht in `.gitignore`.
Sie gehört **niemals** ins Repo.
