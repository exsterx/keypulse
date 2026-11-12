import type { Logger } from "../utils/logger";
import { SemanticKeyRepository, type SemanticKeyRecord } from "../storage/semanticKeyRepository";
import { RerankerService } from "./rerankerService";
import { errMsg } from "../utils/misc";

export interface SemanticKeyView {
  id: number;
  description: string;
  threshold: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SemanticMutationResult {
  ok: boolean;
  exists?: boolean;
  error?: string;
}

function clampThreshold(t: number): number {
  if (!Number.isFinite(t)) return 0.05;
  return Math.min(1, Math.max(0, t));
}

function toView(record: SemanticKeyRecord): SemanticKeyView {
  return {
    id: record.id,
    description: record.description,
    threshold: record.threshold,
    enabled: record.enabled === 1,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

/**
 * Business logic for semantic keys. Keys are stored purely as text: a
 * cross-encoder scores every (key, message) pair at match time, so adding or
 * editing a key never needs a model download or a re-embedding pass.
 */
export class SemanticKeyManager {
  constructor(
    private readonly repo: SemanticKeyRepository,
    private readonly reranker: RerankerService,
    private readonly logger: Logger
  ) {}

  list(): SemanticKeyView[] {
    return this.repo.list().map(toView);
  }

  /**
   * Sanity-checks stored thresholds and starts loading the reranker in the
   * background so the first matching message is not delayed.
   */
  async init(defaultThreshold: number): Promise<void> {
    const fallback = clampThreshold(defaultThreshold);
    let fixed = 0;
    for (const record of this.repo.list()) {
      if (record.threshold >= 0.005 && record.threshold <= 1) continue;
      this.repo.setThreshold(record.id, fallback);
      fixed++;
    }
    if (fixed > 0) {
      this.logger.warn(`Reset ${fixed} semantic key threshold(s) to ${fallback}.`);
    }
    this.logger.info(
      `Semantic keys: ${this.repo.list().length} stored, scoring via ${RerankerService.modelId}.`
    );
    void this.reranker.ensureLoaded();
  }

  async add(description: string, threshold: number): Promise<SemanticMutationResult> {
    const clean = description.trim();
    if (!clean) return { ok: false, error: "empty" };
    if (this.repo.getByDescription(clean)) return { ok: false, exists: true };
    try {
      const id = this.repo.add({ description: clean, threshold: clampThreshold(threshold) });
      return id > 0 ? { ok: true } : { ok: false, exists: true };
    } catch (error) {
      return { ok: false, error: errMsg(error) };
    }
  }

  async update(id: number, description: string, threshold: number): Promise<SemanticMutationResult> {
    const clean = description.trim();
    if (!clean) return { ok: false, error: "empty" };
    const existing = this.repo.getById(id);
    if (!existing) return { ok: false, error: "not found" };
    const duplicate = this.repo.getByDescription(clean);
    if (duplicate && duplicate.id !== id) return { ok: false, exists: true };
    try {
      this.repo.update(id, { description: clean, threshold: clampThreshold(threshold) });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errMsg(error) };
    }
  }

  remove(id: number): boolean {
    return this.repo.remove(id);
  }

  removeByDescription(description: string): boolean {
    const record = this.repo.getByDescription(description.trim());
    if (!record) return false;
    return this.repo.remove(record.id);
  }

  setEnabled(id: number, enabled: boolean): boolean {
    return this.repo.setEnabled(id, enabled);
  }

  setThreshold(id: number, threshold: number): boolean {
    return this.repo.setThreshold(id, clampThreshold(threshold));
  }

  /** Active semantic keys, ready to be scored against an incoming message. */
  activeKeys(): SemanticKeyRecord[] {
    return this.repo.list().filter((k) => k.enabled === 1);
  }
}
