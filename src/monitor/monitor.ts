import type { Api } from "telegram";
import type { NewMessageEvent } from "telegram/events";
import type { AppConfig } from "../config/config";
import type { Logger } from "../utils/logger";
import type { ChatRepository } from "../storage/chatRepository";
import type { SettingsRepository } from "../storage/settingsRepository";
import type { TelegramAccount } from "../telegram/client";
import { discoverChats } from "../telegram/dialogs";
import type { MessageProcessor } from "./messageProcessor";
import type { Backfiller } from "./backfill";
import { errMsg } from "../utils/misc";
import { unixSeconds } from "../utils/dates";

const DISCOVERY_INTERVAL_MS = 30 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

export interface MonitorDeps {
  account: TelegramAccount;
  chatRepo: ChatRepository;
  settingsRepo: SettingsRepository;
  processor: MessageProcessor;
  backfiller: Backfiller;
  entities: Map<number, Api.TypeInputPeer>;
  config: AppConfig;
  logger: Logger;
}

export class Monitor {
  private paused = false;
  private discoveryTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: MonitorDeps) {}

  isPaused(): boolean {
    return this.paused;
  }

  get backfiller(): Backfiller {
    return this.deps.backfiller;
  }

  async start(): Promise<void> {
    await this.discover();

    const now = unixSeconds();
    const lastRun = this.deps.settingsRepo.getNumber("last_run_at", 0) ?? 0;
    // Mark this run immediately so even a short run or a kill during backfill
    // still counts against the restart interval.
    this.deps.settingsRepo.set("last_run_at", now);
    this.startHeartbeat();

    if (this.deps.config.monitorMode === "live" || this.deps.config.monitorMode === "both") {
      this.deps.account.onNewMessage((event) => this.onMessage(event));
      this.deps.logger.info("Live message monitoring enabled.");
    }

    if (this.deps.config.monitorMode === "backfill" || this.deps.config.monitorMode === "both") {
      const recentRun =
        this.deps.config.monitorMode === "both" &&
        lastRun > 0 &&
        now - lastRun < this.deps.config.backfillMinIntervalSeconds;

      if (recentRun) {
        this.deps.logger.info(
          `Skipping startup backfill: last run ${Math.round(now - lastRun)}s ago (min ${this.deps.config.backfillMinIntervalSeconds}s).`
        );
      } else {
        this.deps.logger.info("Starting history backfill...");
        // Run in the background so startup (and the desktop UI, which shows the
        // semantic topics once the engine handle exists) is not blocked by a
        // multi-minute scan.
        void this.deps.backfiller
          .scanAll(
            this.deps.config.backfillDays * 86400,
            this.deps.config.backfillLimit,
            false,
            { semantic: this.deps.config.backfillSemantic }
          )
          .catch((error) => this.deps.logger.error(`Backfill failed: ${errMsg(error)}`));
      }
    }

    this.paused = this.deps.settingsRepo.getBoolean("monitor_paused", false);
    this.startDiscoveryLoop();
  }

  pause(): void {
    this.paused = true;
    this.deps.settingsRepo.set("monitor_paused", true);
    this.deps.logger.info("Monitoring paused.");
  }

  resume(): void {
    this.paused = false;
    this.deps.settingsRepo.set("monitor_paused", false);
    this.deps.logger.info("Monitoring resumed.");
  }

  private async discover(): Promise<void> {
    try {
      const discovered = await discoverChats(this.deps.account);
      const known = new Set(this.deps.chatRepo.getAll().map((c) => c.id));
      let newCount = 0;
      for (const chat of discovered) {
        this.deps.entities.set(chat.id, chat.inputEntity);
        if (!known.has(chat.id)) newCount++;
        this.deps.chatRepo.upsert(chat);
      }
      this.deps.logger.info(`Discovered ${discovered.length} chats (${newCount} new).`);
    } catch (error) {
      this.deps.logger.error(`Chat discovery failed: ${errMsg(error)}`);
    }
  }

  private async onMessage(event: NewMessageEvent): Promise<void> {
    if (this.paused) return;
    try {
      await this.deps.processor.process(event.message);
    } catch (error) {
      this.deps.logger.error(`Error processing live message: ${errMsg(error)}`);
    }
  }

  private startDiscoveryLoop(): void {
    this.discoveryTimer = setInterval(() => {
      void this.discover();
    }, DISCOVERY_INTERVAL_MS);
    this.discoveryTimer.unref();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.deps.settingsRepo.set("last_run_at", unixSeconds());
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async stop(): Promise<void> {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = null;
    }
    this.stopHeartbeat();
    this.deps.settingsRepo.set("last_run_at", unixSeconds());
  }
}
