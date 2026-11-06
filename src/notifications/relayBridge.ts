import WebSocket from "ws";
import type { Logger } from "../utils/logger";
import { CommandService, type CommandResult } from "../bot/commands";
import { errMsg } from "../utils/misc";
import { t, type Lang } from "../utils/i18n";

interface RequestMessage {
  type: string;
  id: string;
  kind: "command" | "callback";
  cmd?: string;
  args?: string;
  data?: string;
}

/**
 * Keeps a WebSocket connection to the relay and answers command/callback
 * requests routed from the shared bot. This makes /status, /chats, the
 * "exclude chat" button, etc. work through the relay bot.
 */
export class RelayBridge {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly relayUrl: string,
    private readonly apiKey: string,
    private readonly chatId: number,
    private readonly language: Lang,
    private readonly commands: CommandService,
    private readonly logger: Logger
  ) {}

  start(): void {
    this.connect();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private connect(): void {
    if (this.stopped) return;
    const wsUrl =
      this.relayUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:").replace(/\/+$/, "") + "/ws";
    this.logger.info(`Relay WebSocket: ${wsUrl}`);

    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "hello", api_key: this.apiKey, chat_id: this.chatId, lang: this.language }));
    });

    ws.on("message", (data) => this.handleMessage(data.toString()));

    ws.on("error", (error) => this.logger.error(`Relay WS error: ${errMsg(error)}`));

    ws.on("close", () => {
      this.logger.warn("Relay WS closed; reconnecting in 5s.");
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
    this.reconnectTimer.unref();
  }

  private handleMessage(raw: string): void {
    let msg: RequestMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type !== "req") return;

    let result: CommandResult;
    try {
      result =
        msg.kind === "callback"
          ? this.commands.handleCallback(String(msg.data ?? ""))
          : this.runCommand(String(msg.cmd ?? ""), String(msg.args ?? ""));
    } catch (error) {
      result = { text: t(this.language, "bridge.error", { error: errMsg(error) }) };
    }

    this.ws?.send(
      JSON.stringify({
        type: "res",
        id: msg.id,
        text: result.text ?? null,
        callbackAnswer: result.callbackAnswer ?? null,
        parseMode: result.parseMode ?? null,
      })
    );
  }

  private runCommand(cmd: string, args: string): CommandResult {
    switch (cmd) {
      case "help":
        return this.commands.help();
      case "status":
        return this.commands.status();
      case "chats":
        return this.commands.chats();
      case "keywords":
        return this.commands.keywords();
      case "add":
        return this.commands.addKeyword(args);
      case "remove":
        return this.commands.removeKeyword(args);
      case "enable":
        return this.commands.enableKeyword(args);
      case "disable":
        return this.commands.disableKeyword(args);
      case "pause":
        return this.commands.pause();
      case "resume":
        return this.commands.resume();
      case "stats":
        return this.commands.stats();
      case "digest":
        return this.commands.digest();
      case "scan":
        return this.commands.scan(args);
      case "exclude":
        return this.commands.exclude();
      case "exclude_chat":
        return this.commands.excludeChat(args);
      case "include_chat":
        return this.commands.includeChat(args);
      default:
        return { text: t(this.language, "bridge.unknownCommand", { cmd }) };
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}
