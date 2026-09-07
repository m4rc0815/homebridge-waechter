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
