import { loadConfig } from "./config/config";
import { createLogger } from "./utils/logger";
import { startApp } from "./bootstrap";
import { errMsg } from "./utils/misc";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logsDir, config.logLevel);

  logger.info("Starting Telegram Keyword Monitor...");
  logger.info(
    `Mode: ${config.monitorMode} | search: ${config.searchMode} | timezone: ${config.timezone}`
  );

  const app = await startApp(config, logger);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down...`);
    await app.stop();
    logger.info("Shutdown complete.");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("uncaughtException", (error) => {
    logger.error(`Uncaught exception: ${errMsg(error)}`);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error(`Unhandled rejection: ${errMsg(reason)}`);
  });

  logger.info("Telegram Keyword Monitor is running.");
}

main().catch((error) => {
  console.error("Fatal error:", errMsg(error));
  process.exit(1);
});
