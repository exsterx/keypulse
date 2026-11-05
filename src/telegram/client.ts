import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import type { Api } from "telegram";
import type { AppConfig } from "../config/config";
import type { Logger } from "../utils/logger";
import { errMsg } from "../utils/misc";

/**
 * Thin wrapper around the GramJS TelegramClient for the *user* account
 * (MTProto). The bot is handled separately via the Telegram Bot API.
 */
export class TelegramAccount {
  private readonly client: TelegramClient;
  private connected = false;

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
    return this.connected;
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
    try {
      await this.client.disconnect();
    } catch (error) {
      this.logger.warn(`Error while disconnecting Telegram client: ${errMsg(error)}`);
    }
    this.connected = false;
  }
}
