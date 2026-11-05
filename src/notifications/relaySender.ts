import type { NotifierSendExtra } from "./notifier";

/**
 * Creates a send function that delivers notifications through a central relay
 * server (POST /notify) instead of the local bot. The relay holds the shared
 * bot token and renders HTML + disables link previews itself.
 */
export function createRelaySender(
  relayUrl: string,
  apiKey: string
): (chatId: number, text: string, extra?: NotifierSendExtra) => Promise<unknown> {
  const endpoint = relayUrl.replace(/\/+$/, "") + "/notify";
  return async (chatId, text, extra) => {
    const payload: Record<string, unknown> = { chat_id: chatId, text };
    if (extra?.reply_markup) payload.reply_markup = extra.reply_markup;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Relay HTTP ${response.status}: ${body}`);
    }
    return response;
  };
}
