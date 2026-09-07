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
