import { EventEmitter } from "node:events";
import path from "node:path";
import type {
  DoneEvent,
  ErrorEvent,
  GenerateRequest,
  JobStage,
  JobStatus,
  LogEvent,
  LogLevel,
  StatusEvent,
} from "@nightwriter/shared";
import type { AppConfig } from "../config.js";
import { newJobId, slugify } from "../util/ids.js";
import { logger, maskSecrets } from "../util/logger.js";
import { ensureDir, removeDir } from "../util/tmp.js";
import {
  type BufferedEvent,
  GenerateError,
  type JobRecord,
  type JobRunner,
  type JobSink,
} from "./types.js";

interface JobEntry {
  record: JobRecord;
  emitter: EventEmitter;
  buffer: BufferedEvent[];
  seq: number;
  controller: AbortController;
}

export class JobStore {
  private readonly jobs = new Map<string, JobEntry>();
  private readonly queue: string[] = [];
  private active = 0;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: AppConfig,
    private readonly runner: JobRunner,
    /** Invoked after a job succeeds (e.g. to persist it to history). */
    private readonly onSucceeded?: (record: JobRecord) => Promise<void>,
  ) {}

  start(): void {
    this.cleanupTimer = setInterval(
      () => this.sweep(),
      this.config.cleanupIntervalMs,
    );
    this.cleanupTimer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    for (const entry of this.jobs.values()) {
      entry.controller.abort();
      await removeDir(entry.record.workDir).catch(() => {});
    }
    this.jobs.clear();
  }

  create(req: GenerateRequest, ownerId: string): JobRecord {
    const id = newJobId();
    const now = Date.now();
    const slug = slugify(req.prompt);
    const workDir = path.join(this.config.workRoot, id);
    const model = req.generator.model ?? "";
    const record: JobRecord = {
      id,
      ownerId,
      state: "queued",
      stage: "queued",
      prompt: req.prompt,
      slug,
      generator: req.generator,
      target: req.target,
      model,
      createdAt: now,
      updatedAt: now,
      files: [],
      workDir,
      outDir: path.join(workDir, "out"),
      zipPath: path.join(workDir, "artifact.zip"),
      downloadReady: false,
    };
    const entry: JobEntry = {
      record,
      emitter: new EventEmitter(),
      buffer: [],
      seq: 0,
      controller: new AbortController(),
    };
    entry.emitter.setMaxListeners(50);
    this.jobs.set(id, entry);
    this.queue.push(id);
    this.pump();
    return record;
  }

  get(id: string): JobRecord | undefined {
    return this.jobs.get(id)?.record;
  }

  toStatus(record: JobRecord): JobStatus {
    return {
      jobId: record.id,
      state: record.state,
      stage: record.stage,
      generator: record.generator,
      target: record.target,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      error: record.error,
      downloadReady: record.downloadReady,
    };
  }

  cancel(id: string): boolean {
    const entry = this.jobs.get(id);
    if (!entry) return false;
    const { record } = entry;
    if (record.state === "succeeded" || record.state === "failed") return false;
    entry.controller.abort();
    // If still queued (never started), finalize directly.
    if (record.state === "queued") {
      const idx = this.queue.indexOf(id);
      if (idx >= 0) this.queue.splice(idx, 1);
      this.finishError(entry, "canceled", "Job canceled before start");
    }
    return true;
  }

  /**
   * Attach a subscriber. Replays buffered events first, then forwards live
   * ones via `onEvent`. Returns an unsubscribe function.
   */
  subscribe(
    id: string,
    onEvent: (e: BufferedEvent) => void,
  ): (() => void) | undefined {
    const entry = this.jobs.get(id);
    if (!entry) return undefined;
    for (const e of entry.buffer) onEvent(e);
    const handler = (e: BufferedEvent) => onEvent(e);
    entry.emitter.on("event", handler);
    return () => entry.emitter.off("event", handler);
  }

  /** True once a terminal event has been buffered. */
  isTerminal(id: string): boolean {
    const entry = this.jobs.get(id);
    if (!entry) return true;
    return (
      entry.record.state === "succeeded" ||
      entry.record.state === "failed" ||
      entry.record.state === "canceled"
    );
  }

  /* ----------------------------- internals ----------------------------- */

  private emit(entry: JobEntry, event: BufferedEvent["event"], data: unknown) {
    const e: BufferedEvent = { id: ++entry.seq, event, data };
    entry.buffer.push(e);
    entry.emitter.emit("event", e);
  }

  private touch(record: JobRecord) {
    record.updatedAt = Date.now();
  }

  private makeSink(entry: JobEntry): JobSink {
    const { record } = entry;
    return {
      signal: entry.controller.signal,
      setSlug: (slug: string) => {
        record.slug = slug;
      },
      setStage: (stage: JobStage, message?: string) => {
        record.stage = stage;
        if (stage === "generating" || stage === "packaging")
          record.state = "running";
        this.touch(record);
        const payload: StatusEvent = {
          state: record.state,
          stage,
          message: message ? maskSecrets(message) : undefined,
        };
        this.emit(entry, "status", payload);
      },
      log: (level: LogLevel, line: string) => {
        const payload: LogEvent = {
          level,
          line: maskSecrets(line),
          ts: Date.now(),
        };
        this.emit(entry, "log", payload);
      },
    };
  }

  private pump(): void {
    while (this.active < this.config.maxConcurrency && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const entry = this.jobs.get(id);
      if (!entry) continue;
      if (entry.controller.signal.aborted) continue;
      this.active++;
      void this.run(entry).finally(() => {
        this.active--;
        this.pump();
      });
    }
  }

  private async run(entry: JobEntry): Promise<void> {
    const { record } = entry;
    const sink = this.makeSink(entry);
    try {
      await ensureDir(record.outDir);
      sink.setStage("preparing", "Preparing workspace");
      const result = await this.runner(record, sink);
      if (entry.controller.signal.aborted) {
        this.finishError(entry, "canceled", "Job canceled");
        return;
      }
      record.files = result.files;
      record.downloadReady = true;
      record.state = "succeeded";
      record.stage = "ready";
      record.finishedAt = Date.now();
      this.touch(record);
      // Persist to durable history before announcing completion. A persist
      // failure must not fail the job — the live download still works.
      if (this.onSucceeded) {
        try {
          await this.onSucceeded(record);
        } catch (err) {
          logger.error("history persist failed", {
            jobId: record.id,
            msg: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const done: DoneEvent = {
        jobId: record.id,
        downloadUrl: `/api/generate/${record.id}/download`,
        files: result.files,
      };
      this.emit(entry, "status", {
        state: "succeeded",
        stage: "ready",
      } satisfies StatusEvent);
      this.emit(entry, "done", done);
    } catch (err) {
      if (entry.controller.signal.aborted) {
        this.finishError(entry, "canceled", "Job canceled");
        return;
      }
      if (err instanceof GenerateError) {
        this.finishError(entry, err.code, err.message);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("job failed", { jobId: record.id, msg });
        this.finishError(entry, "internal", msg);
      }
    }
  }

  private finishError(
    entry: JobEntry,
    code: ErrorEvent["code"],
    message: string,
  ): void {
    const { record } = entry;
    if (record.state === "failed" || record.state === "canceled") return;
    record.state = code === "canceled" ? "canceled" : "failed";
    record.stage = "error";
    record.error = maskSecrets(message);
    record.errorCode = code;
    record.finishedAt = Date.now();
    this.touch(record);
    this.emit(entry, "status", {
      state: record.state,
      stage: "error",
    } satisfies StatusEvent);
    this.emit(entry, "error", {
      code,
      message: record.error,
    } satisfies ErrorEvent);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.jobs) {
      const { record } = entry;
      const terminal =
        record.state === "succeeded" ||
        record.state === "failed" ||
        record.state === "canceled";
      if (!terminal) continue;
      const ref = record.finishedAt ?? record.updatedAt;
      if (now - ref >= this.config.artifactTtlMs) {
        this.jobs.delete(id);
        void removeDir(record.workDir).catch(() => {});
        logger.info("cleaned up job", { jobId: id });
      }
    }
  }
}
