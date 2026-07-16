import { randomUUID } from "node:crypto";

/** URL/path-safe job id. */
export function newJobId(): string {
  return `job_${randomUUID().replace(/-/g, "")}`;
}

/** URL/path-safe id with an arbitrary prefix. */
function prefixedId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export const newChatId = (): string => prefixedId("chat");
export const newMessageId = (): string => prefixedId("msg");
export const newTurnId = (): string => prefixedId("turn");

/**
 * Derive a filesystem-safe slug from free text (e.g. the prompt's first words).
 * Always returns a non-empty token.
 */
export function slugify(input: string, fallback = "agent"): string {
  const slug = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || fallback;
}
