import type { Api } from "telegram";
import path from "node:path";
import type { AppConfig } from "./config/config";
import type { Logger } from "./utils/logger";
import { openDatabase } from "./storage/database";
import { ChatRepository } from "./storage/chatRepository";
import { MessageRepository } from "./storage/messageRepository";
import { KeywordRepository } from "./storage/keywordRepository";
import { SettingsRepository } from "./storage/settingsRepository";
import { NotificationRepository } from "./storage/notificationRepository";
import { BackfillRepository } from "./storage/backfillRepository";
import { SemanticKeyRepository } from "./storage/semanticKeyRepository";
import { KeywordMatcher } from "./matcher/matcher";
import { KeywordManager } from "./matcher/keywordManager";
import { TelegramAccount } from "./telegram/client";
import { MessageProcessor } from "./monitor/messageProcessor";
import { Backfiller } from "./monitor/backfill";
import { Monitor } from "./monitor/monitor";
import { Notifier } from "./notifications/notifier";
import { createRelaySender } from "./notifications/relaySender";
import { RelayBridge } from "./notifications/relayBridge";
import { DigestService } from "./digest/digest";
import { CommandService } from "./bot/commands";
import { RerankerService, type SemanticModelStatus } from "./semantic/rerankerService";
import { SemanticKeyManager, type SemanticKeyView, type SemanticMutationResult } from "./semantic/semanticKeyManager";
import { SemanticMatcher } from "./semantic/semanticMatcher";
import { scheduleDaily, isValidTime, type SchedulerHandle } from "./utils/scheduler";
import { errMsg } from "./utils/misc";
import { unixSeconds } from "./utils/dates";

export interface AppStatus {
  accountConnected: boolean;
  paused: boolean;
  relayConnected: boolean | null;
  semanticStatus: SemanticModelStatus;
}

export interface ChatListItem {
  id: number;
  title: string;
  username: string | null;
  type: string;
  isMonitored: boolean;
}

export interface AppHandle {
  monitor: Monitor;
  account: TelegramAccount;
  relayBridge: RelayBridge | undefined;
  getStatus(): AppStatus;
  listChats(): ChatListItem[];
  setChatMonitored(id: number, monitored: boolean): boolean;
  listSemanticKeys(): SemanticKeyView[];
  addSemanticKey(description: string, threshold: number): Promise<SemanticMutationResult>;
  updateSemanticKey(id: number, description: string, threshold: number): Promise<SemanticMutationResult>;
  removeSemanticKey(id: number): boolean;
  setSemanticEnabled(id: number, enabled: boolean): boolean;
  setSemanticThreshold(id: number, threshold: number): boolean;
  getSemanticStatus(): SemanticModelStatus;
  stop(): Promise<void>;
}

/** Boots the whole monitor (shared by the CLI and the desktop app). */
export async function startApp(config: AppConfig, logger: Logger): Promise<AppHandle> {
  const db = openDatabase(config.dataDir);
  const chatRepo = new ChatRepository(db);
  const messageRepo = new MessageRepository(db);
  const keywordRepo = new KeywordRepository(db);
  const settingsRepo = new SettingsRepository(db);
  const notificationRepo = new NotificationRepository(db);
  const backfillRepo = new BackfillRepository(db);

  const matcher = new KeywordMatcher();
  matcher.setMode(config.searchMode);

  const keywordManager = new KeywordManager(
    config.keywordsFile,
    config.excludeWordsFile,
    keywordRepo,
    matcher,
    logger
  );
  await keywordManager.init();

  const account = new TelegramAccount(config, logger);

  // Connect first so we can derive the recipient chat id from the
  // authenticated account (a private chat with the bot has chat_id == user_id).
  await account.connect();
  const targetChatId = await account.getMe();

  const relaySender = createRelaySender(config.relayUrl, config.relayApiKey);

  const notifier = new Notifier(relaySender, messageRepo, notificationRepo, config, targetChatId, logger);

  const semanticRepo = new SemanticKeyRepository(db);
  const reranker = new RerankerService({
    cacheDir: path.join(config.dataDir, "models"),
    logger,
  });
  const semanticKeys = new SemanticKeyManager(semanticRepo, reranker, logger);
  const semanticMatcher = new SemanticMatcher(
    reranker,
    semanticKeys,
    messageRepo,
    notifier,
    logger,
    config.semanticMinTextLength
  );
  // Normalize stored thresholds and warm the reranker up in the background so
  // startup is not blocked by the model load.
  void semanticKeys.init(config.semanticDefaultThreshold);

  const processor = new MessageProcessor({ chatRepo, messageRepo, matcher, notifier, semanticMatcher, logger });
  const entities = new Map<number, Api.TypeInputPeer>();
  const backfiller = new Backfiller({
    account,
    chatRepo,
    backfillRepo,
    messageRepo,
    processor,
    entities,
    logger,
    reranker,
    semanticKeys,
    semanticMatcher,
  });
  const monitor = new Monitor({
    account,
    chatRepo,
    settingsRepo,
    processor,
    backfiller,
    entities,
    config,
    logger,
  });

  const digest = new DigestService(messageRepo, config.timezone, config.language, relaySender, targetChatId, logger);

  const services = {
    config,
    logger,
    keywordManager,
    semanticKeys,
    chatRepo,
    messageRepo,
    settingsRepo,
    monitor,
    account,
    digest,
    matcher,
  };

  let relayBridge: RelayBridge | undefined;
  const commandService = new CommandService(services);
  relayBridge = new RelayBridge(config.relayUrl, config.relayApiKey, targetChatId, config.language, commandService, logger);
  relayBridge.start();

  await monitor.start();

  let digestScheduler: SchedulerHandle | undefined;
  if (isValidTime(config.digestTime)) {
    digestScheduler = scheduleDaily(
      config.digestTime,
      config.timezone,
      async () => {
        const since = unixSeconds() - 86400;
        const until = unixSeconds();
        const count = messageRepo.getMatchesBetween(since, until).length;
        if (count === 0) return;
        await digest.sendDigest(since, until);
      },
      logger
    );
  }

  return {
    monitor,
    account,
    relayBridge,
    getStatus(): AppStatus {
      return {
        accountConnected: account.isConnected(),
        paused: monitor.isPaused(),
        relayConnected: relayBridge ? relayBridge.isConnected() : null,
        semanticStatus: reranker.getStatus(),
      };
    },
    listChats(): ChatListItem[] {
      return chatRepo.getAll().map((c) => ({
        id: c.id,
        title: c.title,
        username: c.username,
        type: c.type,
        isMonitored: c.is_monitored === 1,
      }));
    },
    setChatMonitored(id: number, monitored: boolean): boolean {
      return chatRepo.setMonitored(id, monitored);
    },
    listSemanticKeys(): SemanticKeyView[] {
      return semanticKeys.list();
    },
    addSemanticKey(description: string, threshold: number): Promise<SemanticMutationResult> {
      return semanticKeys.add(description, threshold);
    },
    updateSemanticKey(id: number, description: string, threshold: number): Promise<SemanticMutationResult> {
      return semanticKeys.update(id, description, threshold);
    },
    removeSemanticKey(id: number): boolean {
      return semanticKeys.remove(id);
    },
    setSemanticEnabled(id: number, enabled: boolean): boolean {
      return semanticKeys.setEnabled(id, enabled);
    },
    setSemanticThreshold(id: number, threshold: number): boolean {
      return semanticKeys.setThreshold(id, threshold);
    },
    getSemanticStatus(): SemanticModelStatus {
      return reranker.getStatus();
    },
    async stop(): Promise<void> {
      digestScheduler?.stop();
      notifier.stop();
      semanticMatcher.stop();
      reranker.dispose();
      relayBridge?.stop();
      await monitor.stop();
      await account.disconnect();
      keywordManager.close();
      try {
        db.close();
      } catch (error) {
        logger.warn(`Database close error: ${errMsg(error)}`);
      }
    },
  };
}
