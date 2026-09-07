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

# Eingaben kommen vom Terminal, NICHT von stdin. Bei "curl ... | bash" ist stdin
# die Pipe von curl — read bekaeme dort sofort EOF und uebernaehme leere Werte.
if [ ! -e /dev/tty ] || ! (exec </dev/tty) 2>/dev/null; then
  echo "FEHLER: Kein Terminal für die Eingabe der Zugangsdaten verfügbar."
  echo "Bitte so ausführen:"
  echo "  curl -fsSL https://raw.githubusercontent.com/m4rc0815/homebridge-waechter/main/install.sh -o /tmp/hbw.sh && bash /tmp/hbw.sh"
  exit 1
fi
frage()      { local __v=$1 text=$2 vorgabe=${3:-}; local eing; read -rp "$text" eing </dev/tty; printf -v "$__v" '%s' "${eing:-$vorgabe}"; }
frage_still() { local __v=$1 text=$2; local eing; read -rsp "$text" eing </dev/tty; echo; printf -v "$__v" '%s' "$eing"; }

if [ -d "$ZIEL/.git" ]; then
  echo "==> Vorhandene Installation wird aktualisiert"
  sudo git -C "$ZIEL" pull --ff-only
else
  sudo git clone --depth 1 "$REPO" "$ZIEL"
fi

sudo mkdir -p "$KONFIG_DIR" /var/lib/homebridge-waechter /usr/local/bin

# Eine vorhandene, aber unvollständige Konfiguration (z. B. aus einem
# abgebrochenen Lauf) wird NICHT stillschweigend behalten — sonst laeuft der
# Waechter mit leeren Zugangsdaten und meldet nur noch sich selbst.
konfig_vollstaendig() {
  [ -f "$KONFIG_DIR/config.json" ] || return 1
  sudo "$NODE" -e '
    const k = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const ok = k.homebridge?.benutzer && k.homebridge?.passwort && k.discord?.webhook;
    process.exit(ok ? 0 : 1);
  ' "$KONFIG_DIR/config.json" 2>/dev/null
}

if konfig_vollstaendig; then
  echo "==> Konfiguration existiert und ist vollständig, bleibt unverändert"
else
  if [ -f "$KONFIG_DIR/config.json" ]; then
    echo "==> Vorhandene Konfiguration ist unvollständig — sie wird neu erfragt"
    sudo cp "$KONFIG_DIR/config.json" "$KONFIG_DIR/config.json.alt"
  fi
  echo
  echo "--- Zugangsdaten ---"
  frage       HB_USER "Homebridge-Benutzer für den Wächter [waechter]: " "waechter"
  frage_still HB_PASS "Passwort dieses Benutzers: "
  frage       DC_HOOK "Discord-Webhook-URL: "
  frage       DC_UID  "Deine Discord-User-ID (für @-Ping bei Alarm, leer = kein Ping): "

  [ -n "$HB_PASS" ] || { echo "FEHLER: Ohne Passwort kann der Wächter die API nicht abfragen. Abbruch."; exit 1; }
  [ -n "$DC_HOOK" ] || { echo "FEHLER: Ohne Webhook-URL kann nichts gemeldet werden. Abbruch."; exit 1; }

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
fi

echo "==> Dienst und Timer einrichten"
sudo install -m 644 "$ZIEL/systemd/homebridge-waechter.service" /etc/systemd/system/homebridge-waechter.service
sudo install -m 644 "$ZIEL/systemd/homebridge-waechter.timer"   /etc/systemd/system/homebridge-waechter.timer
sudo install -m 755 "$ZIEL/update.sh" /usr/local/bin/homebridge-waechter-update
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
