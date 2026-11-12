import { RerankerCore, type RerankPair } from "./rerankerCore";

// Child-process entry point for the reranker. onnxruntime-node calls V8 from
// its own native threads, which crashes inside a worker_thread (no isolate
// lock); a separate Node process has its own isolate and is safe.
const cacheDir = String(process.env.RERANKER_CACHE_DIR ?? "");

const post = (msg: object): void => {
  if (typeof process.send === "function") process.send(msg);
};

/** Minimal logger that forwards entries to the owning process over IPC. */
const logger = {
  info: (message: string) => post({ type: "log", level: "info", message }),
  warn: (message: string) => post({ type: "log", level: "warn", message }),
  error: (message: string) => post({ type: "log", level: "error", message }),
  debug: (message: string) => post({ type: "log", level: "debug", message }),
};

const core = new RerankerCore({
  cacheDir,
  logger: logger as unknown as import("../utils/logger").Logger,
  onProgress: (message) => post({ type: "log", level: "info", message }),
});

interface Request {
  type?: string;
  id?: number;
  pairs?: RerankPair[];
}

// Serialize requests so ensureLoaded is always processed before scorePairs.
let queue: Promise<void> = Promise.resolve();

process.on("message", (raw: Request) => {
  queue = queue.then(() => handle(raw));
});

process.on("disconnect", () => {
  process.exit(0);
});

async function handle(msg: Request): Promise<void> {
  const id = msg.id ?? 0;
  try {
    if (msg.type === "ensureLoaded") {
      const ready = await core.ensureLoaded();
      post({ type: "result", id, ok: true, value: ready });
      post({ type: "status", status: core.getStatus(), error: core.getError() ?? undefined });
    } else if (msg.type === "scorePairs") {
      const scores = await core.scorePairs(msg.pairs ?? []);
      post({ type: "result", id, ok: true, value: scores });
    } else if (msg.type === "status") {
      post({ type: "result", id, ok: true, value: core.getStatus() });
    }
  } catch (error) {
    post({ type: "result", id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
