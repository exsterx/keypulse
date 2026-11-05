/** Unicode-aware case folding used by the matcher. */
export function normalizeText(value: string): string {
  return value.normalize("NFC").toLowerCase();
}

/** Escape text for use inside a Telegram HTML parse_mode message. */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Escape regex metacharacters so a string can be used as a literal regex pattern. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wrap all case-insensitive occurrences of `keywords` in `<b>` (HTML-escaped input). */
export function highlightKeywords(text: string, keywords: string[]): string {
  const escaped = escapeHtml(text);
  const unique = [...new Set(keywords.map((k) => k.trim()).filter((k) => k.length > 0))];
  if (unique.length === 0) return escaped;
  const pattern = unique
    .sort((a, b) => b.length - a.length)
    .map((k) => escapeRegex(escapeHtml(k)))
    .join("|");
  const regex = new RegExp(`(${pattern})`, "gi");
  return escaped.replace(regex, "<b>$1</b>");
}

export function truncate(text: string, maxLength = 4000): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

/**
 * Split text into Telegram-safe chunks (max 4096 chars), preferring newline
 * and space boundaries so words are not cut in half.
 */
export function splitMessage(text: string, maxLength = 4096): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLength) {
    let cut = rest.lastIndexOf("\n", maxLength);
    if (cut <= 0 || cut < maxLength * 0.5) {
      cut = rest.lastIndexOf(" ", maxLength);
    }
    if (cut <= 0 || cut < maxLength * 0.5) {
      cut = maxLength;
    }
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length) chunks.push(rest);
  return chunks;
}

export interface ChatLinkInfo {
  id: number;
  username: string | null;
  type: string;
}

/** Build a t.me link to the original message when possible, otherwise null. */
export function buildMessageLink(chat: ChatLinkInfo, messageId: number): string | null {
  if (chat.username) {
    return `https://t.me/${chat.username}/${messageId}`;
  }
  if (chat.type === "channel" || chat.type === "supergroup") {
    const idStr = String(Math.abs(chat.id));
    if (idStr.startsWith("100")) {
      return `https://t.me/c/${idStr.slice(3)}/${messageId}`;
    }
  }
  return null;
}
