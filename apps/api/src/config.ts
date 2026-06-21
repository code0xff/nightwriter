import os from "node:os";
import path from "node:path";

/** Parse an int env var, falling back to a default when unset/invalid. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export interface AppConfig {
  host: string;
  port: number;
  /** Allowed CORS origins; "*" allows all (dev default). */
  corsOrigin: string;
  /** Max concurrent CLI subprocesses; excess jobs are queued. */
  maxConcurrency: number;
  /** Per-job CLI subprocess timeout (ms). */
  jobTimeoutMs: number;
  /** Time-to-live for finished job artifacts before cleanup (ms). */
  artifactTtlMs: number;
  /** How often the cleanup sweep runs (ms). */
  cleanupIntervalMs: number;
  /** Root directory under which per-job working dirs are created. */
  workRoot: string;
  /** Resolved CLI binaries (overridable for tests / custom installs). */
  bins: {
    claude: string;
    codex: string;
  };
}

export function loadConfig(): AppConfig {
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: envInt("PORT", 8787),
    corsOrigin: process.env.CORS_ORIGIN ?? "*",
    maxConcurrency: envInt("NIGHTWRITER_MAX_CONCURRENCY", 2),
    jobTimeoutMs: envInt("NIGHTWRITER_JOB_TIMEOUT_MS", 120_000),
    artifactTtlMs: envInt("NIGHTWRITER_ARTIFACT_TTL_MS", 30 * 60_000),
    cleanupIntervalMs: envInt("NIGHTWRITER_CLEANUP_INTERVAL_MS", 60_000),
    workRoot:
      process.env.NIGHTWRITER_WORK_ROOT ??
      path.join(os.tmpdir(), "nightwriter-jobs"),
    bins: {
      claude: process.env.NIGHTWRITER_CLAUDE_BIN ?? "claude",
      codex: process.env.NIGHTWRITER_CODEX_BIN ?? "codex",
    },
  };
}

export type Config = AppConfig;
