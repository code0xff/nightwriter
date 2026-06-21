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
  /** Durable data root (database file + persisted artifacts). */
  dataRoot: string;
  /** Storage backend selection. */
  db: {
    driver: "sqlite" | "postgres";
    /** SQLite file path (":memory:" for tests). */
    sqlitePath: string;
  };
  /** Auth / session settings. */
  auth: {
    /** HMAC secret for session tokens; auto-generated + persisted if empty. */
    sessionSecret: string;
    sessionTtlMs: number;
    /** Seed admin credentials (password auto-generated if empty). */
    adminUsername: string;
    adminPassword: string;
  };
  /** WebAuthn / passkey relying-party settings. */
  webauthn: {
    rpName: string;
    rpID: string;
    /** Allowed origins (comma-separated env → array). */
    origins: string[];
  };
}

export function loadConfig(): AppConfig {
  const dataRoot = process.env.NIGHTWRITER_DATA_ROOT ?? path.resolve("data");
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: envInt("PORT", 8787),
    // Restrict to the local web origin by default; a malicious site must not
    // be able to drive the user's authenticated local CLIs. Override for
    // custom deployments via CORS_ORIGIN.
    corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
    // Clamp to >= 1 so a bad value can't permanently stall the queue.
    maxConcurrency: Math.max(1, envInt("NIGHTWRITER_MAX_CONCURRENCY", 2)),
    jobTimeoutMs: Math.max(1_000, envInt("NIGHTWRITER_JOB_TIMEOUT_MS", 120_000)),
    artifactTtlMs: envInt("NIGHTWRITER_ARTIFACT_TTL_MS", 30 * 60_000),
    cleanupIntervalMs: envInt("NIGHTWRITER_CLEANUP_INTERVAL_MS", 60_000),
    workRoot:
      process.env.NIGHTWRITER_WORK_ROOT ??
      path.join(os.tmpdir(), "nightwriter-jobs"),
    bins: {
      claude: process.env.NIGHTWRITER_CLAUDE_BIN ?? "claude",
      codex: process.env.NIGHTWRITER_CODEX_BIN ?? "codex",
    },
    dataRoot,
    db: {
      driver:
        (process.env.NIGHTWRITER_DB as "sqlite" | "postgres" | undefined) ??
        "sqlite",
      sqlitePath:
        process.env.NIGHTWRITER_SQLITE_PATH ??
        path.join(dataRoot, "nightwriter.db"),
    },
    auth: {
      sessionSecret: process.env.NIGHTWRITER_SESSION_SECRET ?? "",
      sessionTtlMs: Math.max(
        60_000,
        envInt("NIGHTWRITER_SESSION_TTL_MS", 7 * 24 * 60 * 60_000),
      ),
      adminUsername: process.env.NIGHTWRITER_ADMIN_USERNAME ?? "admin",
      adminPassword: process.env.NIGHTWRITER_ADMIN_PASSWORD ?? "",
    },
    webauthn: {
      rpName: process.env.NIGHTWRITER_RP_NAME ?? "Nightwriter",
      rpID: process.env.NIGHTWRITER_RP_ID ?? "localhost",
      // Origin host must match rpID (default "localhost"); 127.0.0.1 would not.
      origins: (process.env.NIGHTWRITER_ORIGIN ?? "http://localhost:5173")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
  };
}

export type Config = AppConfig;
