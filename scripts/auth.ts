import path from "node:path";
import dotenv from "dotenv";
import { interactiveAuth } from "../src/telegram/auth";
import { errMsg } from "../src/utils/misc";
import { loadSessionFile, saveSessionFile } from "../src/utils/sessionStore";

async function main(): Promise<void> {
  dotenv.config();

  const apiId = parseInt(process.env.TG_API_ID ?? "0", 10);
  const apiHash = (process.env.TG_API_HASH ?? "").trim();
  if (!apiId || !apiHash) {
    console.error(
      "Set TG_API_ID and TG_API_HASH in .env first. Get them at https://my.telegram.org."
    );
    process.exit(1);
  }

  const sessionFile = path.join(process.cwd(), "data", "session.bin");

  let existing = "";
  try {
    existing = loadSessionFile(sessionFile, process.env.TG_SESSION ?? "");
  } catch (error) {
    console.warn("Warning: could not decrypt existing session, starting fresh:", errMsg(error));
  }

  console.log("Starting interactive Telegram authorization...");
  console.log("You will be asked for your phone number, the code from Telegram and,");
  console.log("if you have two-step verification enabled, its password (locally, never sent anywhere).");

  try {
    const session = await interactiveAuth(apiId, apiHash, existing);
    saveSessionFile(sessionFile, session);
    console.log(`\nSession encrypted with Windows DPAPI and saved to ${sessionFile}`);
    console.log("⚠️  Only the current Windows user on this machine can decrypt it. Keep the file private.");
  } catch (error) {
    console.error("Authorization failed:", errMsg(error));
    process.exit(1);
  }
}

void main();
