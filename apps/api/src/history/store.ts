import { promises as fs } from "node:fs";
import path from "node:path";
import type { GeneratorSelection, HistoryItem, Target } from "@nightwriter/shared";
import type { HistoryRepository } from "../db/types.js";
import { logger } from "../util/logger.js";

/** Metadata + source zip needed to persist a finished generation. */
export interface PersistInput {
  id: string;
  ownerId: string;
  prompt: string;
  generator: GeneratorSelection;
  target: Target;
  slug: string;
  files: string[];
  /** Path to the freshly built zip in the (transient) job workspace. */
  zipPath: string;
}

/**
 * Durable history: metadata lives in the database (HistoryRepository) while the
 * zip artifacts live on the filesystem under <dataRoot>/artifacts.
 */
export class HistoryStore {
  private constructor(
    private readonly repo: HistoryRepository,
    private readonly artifactsDir: string,
  ) {}

  static async open(
    repo: HistoryRepository,
    dataRoot: string,
  ): Promise<HistoryStore> {
    const artifactsDir = path.join(dataRoot, "artifacts");
    await fs.mkdir(artifactsDir, { recursive: true });
    return new HistoryStore(repo, artifactsDir);
  }

  artifactPath(id: string): string {
    return path.join(this.artifactsDir, `${id}.zip`);
  }

  /** Copy the zip into durable storage and record the history item. */
  async persist(input: PersistInput): Promise<HistoryItem> {
    const dest = this.artifactPath(input.id);
    await fs.copyFile(input.zipPath, dest);
    const { size } = await fs.stat(dest);
    const item: HistoryItem = {
      id: input.id,
      ownerId: input.ownerId,
      prompt: input.prompt,
      generator: input.generator,
      target: input.target,
      slug: input.slug,
      files: input.files,
      sizeBytes: size,
      createdAt: Date.now(),
    };
    await this.repo.upsert(item);
    logger.info("persisted history item", { id: item.id });
    return item;
  }

  listByOwner(ownerId: string): Promise<HistoryItem[]> {
    return this.repo.listByOwner(ownerId);
  }

  get(id: string): Promise<HistoryItem | undefined> {
    return this.repo.get(id);
  }

  /** Delete an item + its artifact, only if owned by `ownerId`. */
  async delete(id: string, ownerId: string): Promise<boolean> {
    const ok = await this.repo.delete(id, ownerId);
    if (ok) await fs.rm(this.artifactPath(id), { force: true });
    return ok;
  }
}
