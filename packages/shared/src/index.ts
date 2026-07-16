/**
 * Shared contract types between @nightwriter/web and @nightwriter/api.
 * Keep this package dependency-free so it can be consumed by both
 * the browser bundle and the Node server.
 */

/** LLM CLI used to *generate* the agent definition. */
export type GeneratorCli = "claude" | "codex";

/** Runtime the generated artifact is *built for*. */
export type Target = "claude" | "codex" | "openclaw" | "hermes" | "adk";

export const GENERATOR_CLIS: readonly GeneratorCli[] = ["claude", "codex"];
export const TARGETS: readonly Target[] = [
  "claude",
  "codex",
  "openclaw",
  "hermes",
  "adk",
];

export interface GeneratorSelection {
  cli: GeneratorCli;
  /** Optional model override; adapter picks a sensible default when omitted. */
  model?: string;
}

/** Request body for POST /api/generate. */
export interface GenerateRequest {
  prompt: string;
  generator: GeneratorSelection;
  target: Target;
}

/** Response body for POST /api/generate. */
export interface GenerateResponse {
  jobId: string;
}

export type JobState =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

/** Coarse pipeline stage, surfaced to the UI as a progress indicator. */
export type JobStage =
  | "queued"
  | "preparing"
  | "generating"
  | "packaging"
  | "ready"
  | "error";

/** Snapshot returned by GET /api/generate/:jobId (polling fallback). */
export interface JobStatus {
  jobId: string;
  state: JobState;
  stage: JobStage;
  generator: GeneratorSelection;
  target: Target;
  createdAt: number;
  updatedAt: number;
  error?: string;
  /** True once the zip artifact is available for download. */
  downloadReady: boolean;
}

/* ------------------------------------------------------------------ *
 * SSE event payloads — GET /api/generate/:jobId/events
 * Each `event:` name maps to one of the interfaces below.
 * ------------------------------------------------------------------ */

export interface StatusEvent {
  state: JobState;
  stage: JobStage;
  /** Human-readable, already sanitized message. */
  message?: string;
}

export type LogLevel = "info" | "warn" | "error";

export interface LogEvent {
  level: LogLevel;
  line: string;
  ts: number;
}

export interface DoneEvent {
  jobId: string;
  downloadUrl: string;
  files: string[];
}

export interface ErrorEvent {
  code: GenerateErrorCode;
  message: string;
}

export type GenerateErrorCode =
  | "cli_not_found"
  | "cli_failed"
  | "timeout"
  | "canceled"
  | "packaging_failed"
  | "internal";

/** Discriminated union mirroring the SSE `event:` names. */
export type SseEvent =
  | { event: "status"; data: StatusEvent }
  | { event: "log"; data: LogEvent }
  | { event: "done"; data: DoneEvent }
  | { event: "error"; data: ErrorEvent };

export const SSE_EVENT_NAMES = ["status", "log", "done", "error"] as const;
export type SseEventName = (typeof SSE_EVENT_NAMES)[number];

/* ------------------------------------------------------------------ *
 * Auth & users
 * ------------------------------------------------------------------ */

export type Role = "admin" | "user";
/** Regular users start "pending" and must be activated by an admin. */
export type UserStatus = "active" | "pending";

/** User shape safe to expose to the client (no secrets). */
export interface PublicUser {
  id: string;
  /** Login handle (unique, lowercased). */
  username: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  createdAt: number;
  /** Whether the account can sign in with a password. */
  hasPassword: boolean;
  /** Number of registered passkeys. */
  passkeyCount: number;
}

export interface AuthSession {
  token: string;
  user: PublicUser;
}

/** GET /api/auth/me — current session, or 401. */
export interface MeResponse {
  user: PublicUser;
}

/** POST /api/auth/login — username + password, any role. */
export interface LoginRequest {
  username: string;
  password: string;
}

/** POST /api/auth/register — self-signup (created pending, admin-activated). */
export interface RegisterRequest {
  username: string;
  password: string;
  displayName?: string;
}

/**
 * POST /api/account/password — change your own password (requires the current
 * one). Also used by POST /api/admin/password for the admin account.
 */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** POST /api/account/display-name — change your own display name. */
export interface UpdateDisplayNameRequest {
  displayName: string;
}

/* ---- Passkeys (WebAuthn) — an alternative to password, can coexist ---- *
 * Payloads are passed through opaquely to keep this package dependency-free;
 * the server validates them with @simplewebauthn/server.
 */
export type WebAuthnJSON = Record<string, unknown>;

export interface PasskeyRegisterStartRequest {
  username: string;
  displayName?: string;
}
export interface PasskeyRegisterStartResponse {
  flowId: string;
  options: WebAuthnJSON;
}
export interface PasskeyRegisterFinishRequest {
  flowId: string;
  response: WebAuthnJSON;
}
export interface PasskeyLoginStartResponse {
  flowId: string;
  options: WebAuthnJSON;
}
export interface PasskeyLoginFinishRequest {
  flowId: string;
  response: WebAuthnJSON;
}

/** Admin view of a user (GET /api/admin/users). Same shape as PublicUser. */
export type AdminUser = PublicUser;
export interface AdminUsersResponse {
  users: AdminUser[];
}

/* ------------------------------------------------------------------ *
 * History
 * ------------------------------------------------------------------ */

/** A persisted, re-downloadable past generation, owned by its creator. */
export interface HistoryItem {
  id: string;
  ownerId: string;
  prompt: string;
  generator: GeneratorSelection;
  target: Target;
  slug: string;
  files: string[];
  sizeBytes: number;
  createdAt: number;
  /**
   * The generated definition text (e.g. agent.md contents). Populated on the
   * single-item detail endpoint; omitted from list responses to keep them light.
   */
  definition?: string;
  /** Root filename of the definition in the zip (e.g. "agent.md"). */
  definitionFile?: string;
}

export interface HistoryListResponse {
  items: HistoryItem[];
}

export interface HistoryItemResponse {
  item: HistoryItem;
}

/* ------------------------------------------------------------------ *
 * Chat — interactive multi-turn conversation with a generated agent.
 * The agent definition (from a history item) is run on its native
 * runtime CLI (claude/codex) via short-lived, session-resumed turns.
 * ------------------------------------------------------------------ */

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
}

/** A conversation seeded from a generated agent, owned by its creator. */
export interface ChatSession {
  id: string;
  ownerId: string;
  /** Source generation (history item) the agent definition came from. */
  historyId?: string;
  /** Display title (derived from the source prompt/slug). */
  title: string;
  /** Runtime the agent is chatted on (mirrors the generation target). */
  target: Target;
  /** CLI driving the conversation (claude/codex). */
  runtime: GeneratorCli;
  model: string;
  createdAt: number;
  updatedAt: number;
}

/** A session plus its full message history (detail endpoint). */
export type ChatSessionDetail = ChatSession & { messages: ChatMessage[] };

/** POST /api/chat — start a chat from a generated agent. */
export interface CreateChatRequest {
  historyId: string;
}
export interface CreateChatResponse {
  chatId: string;
}

/** POST /api/chat/:id/messages — send a user turn. */
export interface SendMessageRequest {
  content: string;
}
export interface SendMessageResponse {
  /** Identifier for the assistant turn this message kicked off. */
  turnId: string;
}

export interface ChatListResponse {
  sessions: ChatSession[];
}
export interface ChatDetailResponse {
  session: ChatSessionDetail;
}

/* ---- Chat SSE event payloads — GET /api/chat/:id/events ---- */

/** A streamed chunk of the assistant's in-progress reply. */
export interface ChatDeltaEvent {
  turnId: string;
  text: string;
}
/** A completed message (assistant final, or the echoed user message). */
export interface ChatMessageEvent {
  turnId: string;
  message: ChatMessage;
}
/** The assistant turn finished successfully. */
export interface ChatDoneEvent {
  turnId: string;
}
/** The assistant turn failed. */
export interface ChatErrorEvent {
  turnId: string;
  code: GenerateErrorCode;
  message: string;
}

/** Discriminated union mirroring the chat SSE `event:` names. */
export type ChatSseEvent =
  | { event: "delta"; data: ChatDeltaEvent }
  | { event: "message"; data: ChatMessageEvent }
  | { event: "done"; data: ChatDoneEvent }
  | { event: "error"; data: ChatErrorEvent };

export const CHAT_SSE_EVENT_NAMES = [
  "delta",
  "message",
  "done",
  "error",
] as const;
export type ChatSseEventName = (typeof CHAT_SSE_EVENT_NAMES)[number];

/* ---- Runtime capabilities — which targets can be chatted on ---- */

/** Whether each target's native runtime is available on the server. */
export type RuntimeCapabilities = Record<Target, boolean>;

/** GET /api/chat/capabilities — drives the "Chat" button gating. */
export interface CapabilitiesResponse {
  runtimes: RuntimeCapabilities;
}
