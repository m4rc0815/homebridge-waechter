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
