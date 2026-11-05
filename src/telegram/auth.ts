import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import readline from "node:readline";
import { errMsg } from "../utils/misc";

/**
 * Interactive first-time authorization of the personal Telegram account.
 * Prompts for the phone number, the verification code and the two-step
 * verification password (if set). Returns the saved session string.
 *
 * NEVER enter your account password in the bot — this flow is local only.
 */
export async function interactiveAuth(
  apiId: number,
  apiHash: string,
  existingSession = ""
): Promise<string> {
  const client = new TelegramClient(new StringSession(existingSession), apiId, apiHash, {
    connectionRetries: 5,
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (prompt: string) =>
    new Promise<string>((resolve) => rl.question(prompt, resolve));

  try {
    await client.start({
      phoneNumber: async () =>
        (await question("Phone number (international format, e.g. +79991234567): ")).trim(),
      password: async () =>
        (await question("Two-step verification password (press Enter if not set): ")).trim(),
      phoneCode: async () =>
        (await question("Verification code from Telegram: ")).trim(),
      onError: (error) => console.error("Authorization error:", errMsg(error)),
    });
  } finally {
    rl.close();
  }

  const session = client.session.save() as unknown as string;
  await client.disconnect();
  return session;
}
