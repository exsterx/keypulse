import path from "node:path";
import { fork, type ChildProcess } from "node:child_process";
import type { Logger } from "../utils/logger";
import { errMsg } from "../utils/misc";
import { RerankerCore, type RerankPair, type SemanticModelStatus } from "./rerankerCore";

export type { RerankPair, SemanticModelStatus } from "./rerankerCore";

export interface RerankerServiceOptions {
  cacheDir: string;
  logger: Logger;
  onProgress?: (message: string) => void;
}

interface WorkerMessage {
  type: "log" | "status" | "result";
  id?: number;
  level?: string;
  message?: string;
  status?: SemanticModelStatus;
  error?: string;
  ok?: boolean;
  value?: unknown;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Proxy for the cross-encoder. The actual model (tokenizer + ONNX Runtime)
 * lives in a separate child process so a slow forward pass never blocks the
 * Electron main process — that is what used to freeze the window and time out
 * the Telegram update loop during scans. A child process (not a worker thread)
 * is required because onnxruntime-node calls V8 from its own native threads,
 * which crashes a worker_thread with "HandleScope ... without proper locking".
 */
export class RerankerService {
  private state: SemanticModelStatus = "unloaded";
  private lastError: string | null = null;
  private readonly child: ChildProcess;
  private readonly pending = new Map<number, Pending>();
  private seq = 0;

  static get modelId(): string {
    return RerankerCore.modelId;
  }

  constructor(private readonly options: RerankerServiceOptions) {
    this.child = fork(path.join(__dirname, "rerankerWorker.js"), [], {
      // In Electron the engine runs on the Electron binary; ELECTRON_RUN_AS_NODE
      // makes a forked child behave as plain Node (harmless under real Node).
      env: { ...process.env, RERANKER_CACHE_DIR: options.cacheDir, ELECTRON_RUN_AS_NODE: "1" },
      execArgv: [],
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    this.child.on("message", (msg: WorkerMessage) => this.onMessage(msg));
    this.child.on("error", (error) => {
      this.lastError = errMsg(error);
      this.state = "error";
      this.failAll(this.lastError);
    });
    this.child.on("exit", (code) => {
      if (code !== 0) {
        this.lastError = `Semantic worker exited with code ${code ?? "unknown"}.`;
        this.state = "error";
        this.failAll(this.lastError);
      }
    });
  }

  getStatus(): SemanticModelStatus {
    return this.state;
  }

  getError(): string | null {
    return this.lastError;
  }

  async ensureLoaded(): Promise<boolean> {
    try {
      const ready = await this.request<boolean>("ensureLoaded");
      this.state = ready ? "ready" : "error";
      return ready;
    } catch (error) {
      this.lastError = errMsg(error);
      this.state = "error";
      return false;
    }
  }

  async scorePairs(pairs: RerankPair[]): Promise<number[]> {
    if (this.state !== "ready") {
      const ready = await this.ensureLoaded();
      if (!ready) throw new Error(this.lastError ?? "Reranker model is not loaded.");
    }
    return this.request<number[]>("scorePairs", { pairs });
  }

  async score(query: string, passage: string): Promise<number> {
    const [score] = await this.scorePairs([{ query, passage }]);
    return score;
  }

  /** Terminates the child process; called on engine shutdown. */
  dispose(): void {
    this.failAll("Semantic worker disposed.");
    this.child.kill();
  }

  private request<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.child.send({ type, id, ...payload });
    });
  }

  private failAll(error: string): void {
    for (const [, pending] of this.pending) pending.reject(new Error(error));
    this.pending.clear();
  }

  private onMessage(msg: WorkerMessage): void {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "log") {
      const level = msg.level === "error" || msg.level === "warn" || msg.level === "debug" ? msg.level : "info";
      this.options.logger[level](String(msg.message ?? ""));
      return;
    }
    if (msg.type === "status") {
      if (msg.status) this.state = msg.status;
      if (typeof msg.error === "string") this.lastError = msg.error || null;
      return;
    }
    if (msg.type === "result") {
      const pending = this.pending.get(msg.id ?? -1);
      if (!pending) return;
      this.pending.delete(msg.id ?? -1);
      if (msg.ok) pending.resolve(msg.value);
      else pending.reject(new Error(msg.error ?? "Semantic worker error."));
    }
  }
}
