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
