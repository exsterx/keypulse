import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import type { AppConfig } from "../config/config";
import type { Logger } from "../utils/logger";
import { errMsg } from "../utils/misc";

const WATCHDOG_INTERVAL_MS = 30 * 1000;
const PING_TIMEOUT_MS = 15 * 1000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Thin wrapper around the GramJS TelegramClient for the *user* account
 * (MTProto). The bot is handled separately via the Telegram Bot API.
 */
export class TelegramAccount {
  private readonly client: TelegramClient;
  private connected = false;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private reconnecting = false;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {
    this.client = new TelegramClient(
      new StringSession(config.sessionString),
      config.apiId,
      config.apiHash,
      {
        connectionRetries: 5,
        requestRetries: 5,
        autoReconnect: true,
      }
    );
  }

  get raw(): TelegramClient {
    return this.client;
  }

  isConnected(): boolean {
    return this.connected && this.client.connected === true;
  }

  async getMe(): Promise<number> {
    const me = await this.client.getMe();
    return Number(me.id);
  }

  async sendMessage(username: string, text: string): Promise<void> {
    const target = username.startsWith("@") ? username : "@" + username;
    await this.client.sendMessage(target, { message: text });
  }

  async connect(): Promise<void> {
    if (!this.config.sessionString) {
      throw new Error(
        "No session found. Run `npm run auth` first to authorize your Telegram account."
      );
    }
    await this.client.connect();
    const authorized = await this.client.isUserAuthorized();
    if (!authorized) {
      await this.client.disconnect();
      throw new Error(
        "The stored session is not authorized (it may be expired or invalid). Re-run `npm run auth`."
      );
    }
    this.connected = true;
    this.logger.info("Telegram user account connected and authorized.");
    this.startWatchdog();
  }

  onNewMessage(handler: (event: NewMessageEvent) => Promise<void> | void): void {
    this.client.addEventHandler(handler, new NewMessage({}));
  }

  async getDialogs(): Promise<unknown[]> {
    try {
      return (await this.client.getDialogs({})) as unknown[];
    } catch (error) {
      this.logger.error(`Failed to fetch dialogs: ${errMsg(error)}`);
      throw error;
    }
  }

  async getMessages(entity: Api.TypeInputPeer, params: { limit?: number; offsetId?: number }): Promise<Api.Message[]> {
    return (await this.client.getMessages(entity as any, params)) as Api.Message[];
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.stopWatchdog();
    try {
      await this.client.disconnect();
    } catch (error) {
      this.logger.warn(`Error while disconnecting Telegram client: ${errMsg(error)}`);
    }
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => void this.watchdog(), WATCHDOG_INTERVAL_MS);
    this.watchdogTimer.unref();
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /** Actively checks that the MTProto connection is alive and reconnects if it died (e.g. after a VPN switch). */
  private async watchdog(): Promise<void> {
    if (!this.connected || this.reconnecting) return;
    try {
      await withTimeout(
        this.client.invoke(new Api.Ping({ pingId: BigInt(Date.now()) as any })),
        PING_TIMEOUT_MS
      );
    } catch (error) {
      this.logger.warn(`Telegram connection check failed: ${errMsg(error)}`);
      await this.reconnect();
    }
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting || !this.connected) return;
    this.reconnecting = true;
    try {
      this.logger.info("Reconnecting Telegram account...");
      await this.client.disconnect();
      const ok = await this.client.connect();
      if (!ok) {
        this.logger.warn("Telegram reconnect attempt returned not-connected.");
        return;
      }
      const authorized = await this.client.isUserAuthorized();
      if (!authorized) {
        this.connected = false;
        this.logger.error("Telegram session lost authorization during reconnect.");
        return;
      }
      this.logger.info("Telegram account reconnected.");
    } catch (error) {
      this.logger.warn(`Telegram reconnect failed: ${errMsg(error)}`);
    } finally {
      this.reconnecting = false;
    }
  }
}
