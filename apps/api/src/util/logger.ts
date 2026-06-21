/**
 * Lightweight logging helpers with sensitive-value masking.
 * Masking is best-effort and applied to any text that is surfaced to the
 * client (SSE log lines) or written to server logs.
 */

const SECRET_PATTERNS: RegExp[] = [
  // Common API-key prefixes (Anthropic, OpenAI, GitHub, generic sk-).
  /\b(sk-ant-[A-Za-z0-9_-]{8,})\b/g,
  /\b(sk-[A-Za-z0-9]{16,})\b/g,
  /\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g,
  // Bearer tokens.
  /\b(Bearer\s+)[A-Za-z0-9._-]{12,}/g,
  // key=value style secrets.
  /\b((?:api[_-]?key|token|secret|password|passwd|authorization)\s*[=:]\s*)\S+/gi,
];

export function maskSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (_m, prefix: string | undefined) =>
      prefix ? `${prefix}***` : "***",
    );
  }
  return out;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

function emit(
  level: "info" | "warn" | "error",
  msg: string,
  meta?: Record<string, unknown>,
): void {
  const line = maskSecrets(msg);
  const payload = meta ? ` ${maskSecrets(JSON.stringify(meta))}` : "";
  const record = `[${level}] ${line}${payload}`;
  if (level === "error") console.error(record);
  else if (level === "warn") console.warn(record);
  else console.log(record);
}

export const logger: Logger = {
  info: (m, meta) => emit("info", m, meta),
  warn: (m, meta) => emit("warn", m, meta),
  error: (m, meta) => emit("error", m, meta),
};
