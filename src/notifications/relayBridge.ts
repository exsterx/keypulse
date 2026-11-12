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
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private alive = true;
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
      this.startHeartbeat();
      ws.send(JSON.stringify({ type: "hello", api_key: this.apiKey, chat_id: this.chatId, lang: this.language }));
    });

    ws.on("message", (data) => {
      void this.handleMessage(data.toString());
    });

    ws.on("pong", () => {
      this.alive = true;
    });

    ws.on("error", (error) => this.logger.error(`Relay WS error: ${errMsg(error)}`));

    ws.on("close", () => {
      this.stopHeartbeat();
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

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.alive = true;
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (!this.alive) {
        this.logger.warn("Relay WS heartbeat timeout; terminating stale connection.");
        this.ws.terminate();
        return;
      }
      this.alive = false;
      this.ws.ping();
    }, 30000);
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async handleMessage(raw: string): Promise<void> {
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
          : await this.runCommand(String(msg.cmd ?? ""), String(msg.args ?? ""));
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

  private async runCommand(cmd: string, args: string): Promise<CommandResult> {
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
        return this.commands.add(args);
      case "remove":
        return this.commands.remove(args);
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
    this.stopHeartbeat();
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
