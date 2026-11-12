import type { Logger } from "../utils/logger";
import { errMsg } from "../utils/misc";

export type SemanticModelStatus = "unloaded" | "loading" | "ready" | "error";

/**
 * bge-reranker-v2-m3 is a multilingual cross-encoder: it scores a
 * (query, passage) pair jointly through full attention, instead of comparing
 * two independently produced vectors. That is exactly the difference between
 * "same broad domain" (which cosine similarity cannot separate) and
 * "same specific topic".
 *
 * The ONNX export ships q8 weights as onnx/model_quantized.onnx (~571 MB);
 * Transformers.js maps dtype "q8" to that file.
 */
const MODEL_ID = "onnx-community/bge-reranker-v2-m3-ONNX";
const DTYPE = "q8";
/** Pairs are short (topic + chat message); 512 tokens is plenty and keeps CPU cost low. */
const MAX_LENGTH = 512;
/** How many (key, message) pairs go through the model in one forward pass. */
const PAIR_BATCH_SIZE = 8;

/**
 * The reranker is trained on "query → passage" pairs, while semantic keys are
 * topic descriptions. Wrapping the key in a neutral frame makes the model judge
 * "is this message about that topic" instead of "does this message answer this
 * question", which measurably separates related messages from same-domain ones
 * (0.95 vs 0.01 on the calibration matrix, see scripts/calibrate-semantic.cjs).
 * The threshold presets (0.02 / 0.05 / 0.15) are calibrated for this framing.
 */
const QUERY_PREFIX = "Сообщение на тему: ";

interface ProgressInfo {
  status?: string;
  file?: string;
  progress?: number;
}

interface TensorLike {
  data: ArrayLike<number>;
  dims: number[];
}

interface BatchEncodingLike {
  input_ids: unknown;
  attention_mask: unknown;
}

interface TokenizerLike {
  (text: string | string[], options?: Record<string, unknown>): Promise<BatchEncodingLike>;
}

interface ModelLike {
  (inputs: Record<string, unknown>): Promise<{ logits: TensorLike }>;
}

export interface RerankPair {
  /** Semantic key — treated as the search query. */
  query: string;
  /** Chat message — treated as the candidate document. */
  passage: string;
}

export interface RerankerCoreOptions {
  cacheDir: string;
  logger: Logger;
  onProgress?: (message: string) => void;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

/** Rerankers emit one logit per pair; a multi-class head falls back to the last label. */
function readLogits(tensor: TensorLike, count: number): number[] {
  const dims = tensor.dims ?? [];
  const width = dims.length > 1 ? dims[dims.length - 1] : 1;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(Number(tensor.data[i * width + (width - 1)]));
  }
  return out;
}

/**
 * Local cross-encoder relevance scorer. Loads lazily on first use and runs on
 * ONNX Runtime (CPU), so no external API and no message text ever leaves the
 * machine. Lives inside a worker thread: `RerankerService` (main process) is a
 * thin proxy over this class so a slow forward pass never blocks the UI.
 */
export class RerankerCore {
  private tokenizer: TokenizerLike | null = null;
  private model: ModelLike | null = null;
  private state: SemanticModelStatus = "unloaded";
  private loadPromise: Promise<boolean> | null = null;
  private lastError: string | null = null;

  static get modelId(): string {
    return MODEL_ID;
  }

  constructor(private readonly options: RerankerCoreOptions) {}

  getStatus(): SemanticModelStatus {
    return this.state;
  }

  getError(): string | null {
    return this.lastError;
  }

  async ensureLoaded(): Promise<boolean> {
    if (this.state === "ready") return true;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.load();
    return this.loadPromise;
  }

  private async load(): Promise<boolean> {
    this.state = "loading";
    this.lastError = null;
    try {
      // @huggingface/transformers ships a Node CommonJS build (its "require"
      // export condition), so a plain require works in dev and inside the
      // packaged app. The previous `new Function(...import())` trick could not
      // resolve the bare specifier from within app.asar (ERR_MODULE_NOT_FOUND).
      const mod = require("@huggingface/transformers") as {
        AutoTokenizer: {
          from_pretrained: (id: string, opts?: Record<string, unknown>) => Promise<TokenizerLike>;
        };
        AutoModelForSequenceClassification: {
          from_pretrained: (id: string, opts?: Record<string, unknown>) => Promise<ModelLike>;
        };
        env: { cacheDir: string };
      };
      mod.env.cacheDir = this.options.cacheDir;
      this.options.logger.info(`Loading reranker model ${MODEL_ID} (${DTYPE})...`);

      const progress_callback = (p: unknown): void => {
        const info = p as ProgressInfo;
        if (!info || !this.options.onProgress) return;
        const pct = typeof info.progress === "number" ? Math.round(info.progress) : null;
        const parts = [info.status ?? "downloading", info.file ?? "", pct != null ? `${pct}%` : ""].filter(Boolean);
        this.options.onProgress(parts.join(" "));
      };

      this.tokenizer = await mod.AutoTokenizer.from_pretrained(MODEL_ID);
      this.model = await mod.AutoModelForSequenceClassification.from_pretrained(MODEL_ID, {
        dtype: DTYPE,
        progress_callback,
      });

      this.state = "ready";
      this.options.logger.info("Reranker model ready.");
      await this.selfTest();
      return true;
    } catch (error) {
      this.lastError = errMsg(error);
      this.state = "error";
      this.options.logger.error(`Failed to load reranker model: ${this.lastError}`);
      return false;
    }
  }

  /**
   * Startup sanity check: the whole point of the cross-encoder is telling a
   * related message from one that only shares the same broad domain.
   */
  private async selfTest(): Promise<void> {
    try {
      const key = "перевод пойнтов Loopscale в токены";
      const scores = await this.scorePairs([
        { query: key, passage: "лупскейл пойнты в монеты" },
        { query: key, passage: "finex etf свежие новости про фондовый рынок" },
        { query: key, passage: "продам велосипед в хорошем состоянии" },
      ]);
      this.options.logger.info(
        `Reranker self-test: related=${scores[0].toFixed(3)}, same_domain=${scores[1].toFixed(3)}, unrelated=${scores[2].toFixed(3)}`
      );
    } catch (error) {
      this.options.logger.warn(`Reranker self-test failed: ${errMsg(error)}`);
    }
  }

  /** Relevance in 0..1 (sigmoid of the raw logit; >= 0.5 means "relevant"). */
  async scorePairs(pairs: RerankPair[]): Promise<number[]> {
    if (this.state !== "ready" || !this.tokenizer || !this.model) {
      throw new Error(this.lastError ?? "Reranker model is not loaded.");
    }
    const scores: number[] = [];
    for (let start = 0; start < pairs.length; start += PAIR_BATCH_SIZE) {
      const chunk = pairs.slice(start, start + PAIR_BATCH_SIZE);
      const logits = await this.forward(
        chunk.map((p) => ({ query: QUERY_PREFIX + p.query, passage: p.passage }))
      );
      for (const logit of logits) scores.push(sigmoid(logit));
    }
    return scores;
  }

  async score(query: string, passage: string): Promise<number> {
    const [score] = await this.scorePairs([{ query, passage }]);
    return score;
  }

  private async forward(pairs: RerankPair[]): Promise<number[]> {
    if (!this.tokenizer || !this.model) throw new Error("Reranker model is not loaded.");
    const encoded = await this.tokenizer(
      pairs.map((p) => p.query),
      {
        text_pair: pairs.map((p) => p.passage),
        padding: true,
        truncation: true,
        max_length: MAX_LENGTH,
      }
    );
    let output: { logits: TensorLike };
    try {
      output = await this.model(encoded as unknown as Record<string, unknown>);
    } catch {
      // Some xlm-roberta exports reject token_type_ids; retry with the two
      // inputs every sequence-classification export accepts.
      output = await this.model({
        input_ids: encoded.input_ids,
        attention_mask: encoded.attention_mask,
      });
    }
    return readLogits(output.logits, pairs.length);
  }
}
