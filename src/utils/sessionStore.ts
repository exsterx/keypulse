import fs from "node:fs";
import path from "node:path";
import { dpapiProtect, dpapiUnprotect } from "./dpapi";
import { errMsg } from "./misc";

/**
 * Session storage. The plaintext GramJS session string is encrypted with
 * Windows DPAPI and only the encrypted form is written to disk (session.bin).
 */

export function encryptSession(session: string): string {
  return dpapiProtect(session);
}

export function decryptSession(ciphertext: string): string {
  try {
    return dpapiUnprotect(ciphertext);
  } catch (error) {
    throw new Error(
      `Failed to decrypt session file with Windows DPAPI. It can only be decrypted ` +
        `by the same Windows user on this machine. Re-run "npm run auth". Details: ${errMsg(error)}`
    );
  }
}

/**
 * Reads and decrypts the session file if present; otherwise falls back to an
 * optional environment-provided session string.
 */
export function loadSessionFile(sessionFile: string, envFallback = ""): string {
  if (fs.existsSync(sessionFile)) {
    const content = fs.readFileSync(sessionFile, "utf8").trim();
    if (content) return decryptSession(content);
  }
  return envFallback.trim();
}

/** Encrypts and writes the session to disk (overwrites any existing file). */
export function saveSessionFile(sessionFile: string, session: string): void {
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  const encrypted = encryptSession(session);
  fs.writeFileSync(sessionFile, encrypted, "utf8");
}
