import path from "node:path";
import fs from "node:fs";
import winston from "winston";

export type Logger = winston.Logger;

export function createLogger(logsDir: string, level = "info"): Logger {
  fs.mkdirSync(logsDir, { recursive: true });

  const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.printf((info) => {
      const { timestamp, level, message } = info as Record<string, unknown>;
      return `${timestamp} [${String(level).toUpperCase()}] ${message}`;
    })
  );

  const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.printf((info) => {
      const { timestamp, level, message, stack, ...rest } = info as Record<string, unknown>;
      let line = `${timestamp} [${String(level).toUpperCase()}] ${message}`;
      if (stack) line += `\n${stack}`;
      else if (Object.keys(rest).length) line += " " + JSON.stringify(rest);
      return line;
    })
  );

  return winston.createLogger({
    level,
    transports: [
      new winston.transports.Console({ format: consoleFormat }),
      new winston.transports.File({
        filename: path.join(logsDir, "app.log"),
        format: fileFormat,
        maxsize: 20 * 1024 * 1024,
        maxFiles: 5,
        tailable: true,
      }),
    ],
  });
}
