import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import type { AppConfig } from "../config/config";
import type { Logger } from "../utils/logger";
import { errMsg } from "../utils/misc";

const WATCHDOG_INTERVAL_MS = 30 * 1000;
const PING_TIMEOUT_MS = 15 * 1000;
/** A single slow ping (CPU load, flaky VPN) must not trigger a reconnect. */
const RECONNECT_FAILURE_THRESHOLD = 2;
/** Never reconnect more often than this, no matter how many pings fail. */
const RECONNECT_MIN_INTERVAL_MS = 60 * 1000;
/** Give up on a stuck connect() so a dead handshake cannot block recovery. */
const RECONNECT_TIMEOUT_MS = 60 * 1000;
/** Upper bound for one dialog page; Telegram caps a single slice at 100 anyway. */
const DIALOG_FETCH_LIMIT = 1000;

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
  private failedPings = 0;
  private lastReconnectAt = 0;
  private watchdogPaused = false;

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
    // GramJS prints its internal update-loop ping timeouts (Error: TIMEOUT) via
    // console.error; on a flaky connection that is just noise and it already
    // auto-reconnects. Our own winston logger covers real diagnostics, so keep
    // the console quiet.
    (this.client as unknown as { setLogLevel(level: string): void }).setLogLevel("none");
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

  /**
   * Suspends the liveness ping while a history scan is running. A deep scan
   * keeps the connection busy with getMessages and pegs the CPU, which made the
   * watchdog mistake a healthy connection for a dead one and reconnect on every
   * tick — that reconnect storm is what froze the app.
   */
  setWatchdogPaused(paused: boolean): void {
    if (this.watchdogPaused === paused) return;
    this.watchdogPaused = paused;
    this.failedPings = 0;
    this.logger.debug(`Telegram watchdog ${paused ? "paused" : "resumed"}.`);
  }

  async getDialogs(): Promise<unknown[]> {
    try {
      // Telegram keeps archived chats in a separate folder (folder id 1) and
      // `getDialogs({})` only walks the main one. Fetching both keeps the entity
      // cache complete, otherwise archived (but still monitored) chats are
      // silently skipped by the history scan.
      const dialogs: unknown[] = [];
      for (const folder of [0, 1]) {
        try {
          const slice = (await this.client.getDialogs({
            limit: DIALOG_FETCH_LIMIT,
            folder,
          })) as unknown[];
          dialogs.push(...slice);
        } catch (error) {
          // An account can have no folder 1 at all; that is not an error.
          this.logger.debug(`Failed to fetch dialogs for folder ${folder}: ${errMsg(error)}`);
        }
      }
      return dialogs;
    } catch (error) {
      this.logger.error(`Failed to fetch dialogs: ${errMsg(error)}`);
      throw error;
    }
  }

  /**
   * Last-resort peer lookup for chats missing from the dialog cache (e.g. a
   * monitored chat that was archived after the last discovery run).
   */
  async resolveInputEntity(id: number): Promise<Api.TypeInputPeer | null> {
    try {
      return (await this.client.getInputEntity(id)) as Api.TypeInputPeer;
    } catch (error) {
      this.logger.debug(`Could not resolve input entity for ${id}: ${errMsg(error)}`);
      return null;
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
    if (this.reconnecting || this.watchdogPaused) return;
    try {
      await withTimeout(
        this.client.invoke(new Api.Ping({ pingId: BigInt(Date.now()) as any })),
        PING_TIMEOUT_MS
      );
      this.failedPings = 0;
      // A successful ping is proof the link is healthy, even if a previous
      // reconnect attempt left the local flag cleared.
      this.connected = true;
    } catch (error) {
      this.failedPings += 1;
      this.logger.warn(
        `Telegram connection check failed (${this.failedPings}/${RECONNECT_FAILURE_THRESHOLD}): ${errMsg(error)}`
      );
      if (this.failedPings >= RECONNECT_FAILURE_THRESHOLD) {
        this.failedPings = 0;
        await this.reconnect();
      }
    }
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting) return;
    const now = Date.now();
    if (now - this.lastReconnectAt < RECONNECT_MIN_INTERVAL_MS) {
      this.logger.warn(
        `Skipping reconnect: last attempt ${Math.round((now - this.lastReconnectAt) / 1000)}s ago.`
      );
      return;
    }
    this.lastReconnectAt = now;
    this.reconnecting = true;
    // The connection is gone: reflect it immediately so the watchdog does not
    // keep pinging a dead client while the handshake below is in flight.
    this.connected = false;
    try {
      this.logger.info("Reconnecting Telegram account...");
      try {
        await this.client.disconnect();
      } catch {
        /* The socket is already gone; that is the normal case here. */
      }
      const ok = await withTimeout(this.client.connect(), RECONNECT_TIMEOUT_MS);
      if (!ok) {
        this.logger.warn("Telegram reconnect attempt returned not-connected.");
        return;
      }
      const authorized = await this.client.isUserAuthorized();
      if (!authorized) {
        this.logger.error("Telegram session lost authorization during reconnect.");
        return;
      }
      this.connected = true;
      this.logger.info("Telegram account reconnected.");
    } catch (error) {
      this.logger.warn(`Telegram reconnect failed: ${errMsg(error)}`);
    } finally {
      this.reconnecting = false;
    }
  }
}
