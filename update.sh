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
