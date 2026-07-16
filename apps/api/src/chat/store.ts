import { EventEmitter } from "node:events";
import path from "node:path";
import type {
  ChatDeltaEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatMessage,
  ChatMessageEvent,
  GenerateErrorCode,
  GeneratorCli,
} from "@nightwriter/shared";
import type { AppConfig } from "../config.js";
import type {
  ChatMessageRecord,
  ChatRecord,
  ChatRepository,
  HistoryRepository,
} from "../db/types.js";
import { runCli } from "../generate/spawn.js";
import { GenerateError } from "../jobs/types.js";
import { newChatId, newMessageId, newTurnId } from "../util/ids.js";
import { logger, maskSecrets } from "../util/logger.js";
import { ensureDir, removeDir } from "../util/tmp.js";
import type { RuntimeRegistry } from "./runtimes/index.js";
import { ChatError, type ChatBufferedEvent } from "./types.js";

/**
 * Per-chat live streaming state. Only exists while a chat is being interacted
 * with; the durable transcript lives in the ChatRepository. `buffer` holds the
 * in-progress turn's events for replay to a mid-turn subscriber and is reset at
 * the start of each turn.
 */
interface ChatEntry {
  emitter: EventEmitter;
  buffer: ChatBufferedEvent[];
  seq: number;
  running: boolean;
  controller?: AbortController;
  lastActivity: number;
}

/**
 * Drives interactive, multi-turn conversations with a generated agent. Turns
 * are short-lived subprocesses (spawned via the same `runCli` used for
 * generation) whose runtime keeps context through session resume. Session and
 * message state is persisted; only in-flight turn streaming is in memory.
 */
export class ChatStore {
  private readonly entries = new Map<string, ChatEntry>();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly config: AppConfig,
    private readonly chats: ChatRepository,
    private readonly history: HistoryRepository,
    private readonly runtimes: RuntimeRegistry,
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
    for (const entry of this.entries.values()) entry.controller?.abort();
    this.entries.clear();
  }

  capabilities() {
    return this.runtimes.capabilities();
  }

  /* ------------------------------- reads ------------------------------- */

  getSession(id: string): Promise<ChatRecord | undefined> {
    return this.chats.getChat(id);
  }

  listByOwner(ownerId: string): Promise<ChatRecord[]> {
    return this.chats.listByOwner(ownerId);
  }

  listMessages(chatId: string): Promise<ChatMessageRecord[]> {
    return this.chats.listMessages(chatId);
  }

  /* ------------------------------ mutations ---------------------------- */

  /** Create a chat seeded from a generated agent (history item). */
  async createChat(ownerId: string, historyId: string): Promise<ChatRecord> {
    const item = await this.history.get(historyId);
    if (!item || item.ownerId !== ownerId)
      throw new ChatError(404, "history_not_found", "agent not found");
    if (!item.definition)
      throw new ChatError(400, "no_definition", "agent has no definition");

    const runtime = this.runtimes.get(item.target);
    if (!runtime || !(await runtime.available()))
      throw new ChatError(
        409,
        "runtime_unavailable",
        `no runtime for target "${item.target}" is available on this server`,
      );

    const now = Date.now();
    const record: ChatRecord = {
      id: newChatId(),
      ownerId,
      historyId,
      title: item.slug || item.prompt.slice(0, 60) || "agent",
      target: item.target,
      // Only claude/codex targets are chat-capable, so target ⊆ GeneratorCli.
      runtime: item.target as GeneratorCli,
      model: "", // let the agent definition's own model win
      slug: item.slug,
      definition: item.definition,
      definitionFile: item.definitionFile ?? "agent.md",
      createdAt: now,
      updatedAt: now,
    };
    await this.chats.createChat(record);
    return record;
  }

  /** Delete a chat (aborts any running turn, removes its workspace). */
  async deleteChat(id: string, ownerId: string): Promise<boolean> {
    const entry = this.entries.get(id);
    entry?.controller?.abort();
    this.entries.delete(id);
    await removeDir(this.workDirFor(id)).catch(() => {});
    return this.chats.deleteChat(id, ownerId);
  }

  /**
   * Send a user message and kick off an assistant turn. Persists the user
   * message immediately, returns the turn id, and streams the reply over SSE.
   * Rejects with a 409 if a turn is already in flight for this chat.
   */
  async sendMessage(record: ChatRecord, content: string): Promise<string> {
    const text = content.trim();
    if (!text) throw new ChatError(400, "empty", "message is empty");
    const entry = this.ensureEntry(record.id);
    if (entry.running)
      throw new ChatError(409, "busy", "a turn is already in progress");

    entry.running = true;
    entry.buffer = [];
    entry.seq = 0;
    entry.controller = new AbortController();
    entry.lastActivity = Date.now();

    await this.chats.addMessage({
      id: newMessageId(),
      chatId: record.id,
      role: "user",
      content: maskSecrets(text),
      createdAt: Date.now(),
    });

    const turnId = newTurnId();
    void this.runTurn(record, entry, turnId, text);
    return turnId;
  }

  cancel(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry?.running) return false;
    entry.controller?.abort();
    return true;
  }

  /** Attach a subscriber: replays the in-flight turn's buffer, then live. */
  subscribe(
    id: string,
    onEvent: (e: ChatBufferedEvent) => void,
  ): () => void {
    const entry = this.ensureEntry(id);
    for (const e of entry.buffer) onEvent(e);
    const handler = (e: ChatBufferedEvent) => onEvent(e);
    entry.emitter.on("event", handler);
    return () => entry.emitter.off("event", handler);
  }

  /* ------------------------------ internals ---------------------------- */

  private ensureEntry(id: string): ChatEntry {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = {
        emitter: new EventEmitter(),
        buffer: [],
        seq: 0,
        running: false,
        lastActivity: Date.now(),
      };
      entry.emitter.setMaxListeners(50);
      this.entries.set(id, entry);
    }
    return entry;
  }

  private workDirFor(id: string): string {
    // Stable per-chat path so the runtime's session store (keyed by cwd)
    // resolves across turns and restarts.
    return path.join(this.config.workRoot, "chat", id);
  }

  private emit(
    entry: ChatEntry,
    event: ChatBufferedEvent["event"],
    data: unknown,
  ): void {
    const e: ChatBufferedEvent = { id: ++entry.seq, event, data };
    entry.buffer.push(e);
    entry.emitter.emit("event", e);
  }

  private async runTurn(
    record: ChatRecord,
    entry: ChatEntry,
    turnId: string,
    content: string,
  ): Promise<void> {
    try {
      const runtime = this.runtimes.get(record.target);
      if (!runtime)
        throw new GenerateError("internal", "runtime disappeared");

      const workDir = this.workDirFor(record.id);
      await ensureDir(workDir);
      await runtime.install(workDir, record.definition, record.slug);

      const firstTurn = !record.runtimeSessionId;
      const sessionId = record.runtimeSessionId ?? runtime.newSessionId();
      const inv = runtime.buildTurn({
        slug: record.slug,
        model: record.model,
        sessionId,
        firstTurn,
      });
      const parser = runtime.createParser();

      await runCli({
        command: inv.command,
        args: inv.args,
        cwd: workDir,
        env: inv.env,
        stdin: inv.promptViaStdin ? content : undefined,
        timeoutMs: this.config.jobTimeoutMs,
        signal: entry.controller!.signal,
        onLine: (level, line) => {
          if (level !== "info") return; // session metadata / noise on stderr
          for (const chunk of parser.onLine(line)) {
            this.emit(entry, "delta", {
              turnId,
              text: maskSecrets(chunk),
            } satisfies ChatDeltaEvent);
          }
        },
      });

      const streamErr = parser.errorMessage();
      if (streamErr) throw new GenerateError("cli_failed", streamErr);

      const final = maskSecrets(parser.result().trim());
      if (firstTurn) {
        record.runtimeSessionId = sessionId;
        await this.chats.setRuntimeSession(record.id, sessionId);
      }

      const message: ChatMessage = {
        id: newMessageId(),
        role: "assistant",
        content: final,
        createdAt: Date.now(),
      };
      await this.chats.addMessage({
        id: message.id,
        chatId: record.id,
        role: "assistant",
        content: final,
        createdAt: message.createdAt,
      });
      await this.chats.touch(record.id, Date.now());

      this.emit(entry, "message", { turnId, message } satisfies ChatMessageEvent);
      this.emit(entry, "done", { turnId } satisfies ChatDoneEvent);
    } catch (err) {
      const aborted = entry.controller?.signal.aborted ?? false;
      const code: GenerateErrorCode =
        err instanceof GenerateError
          ? err.code
          : aborted
            ? "canceled"
            : "internal";
      const message = err instanceof Error ? err.message : String(err);
      if (!(err instanceof GenerateError))
        logger.error("chat turn failed", { chatId: record.id, msg: message });
      this.emit(entry, "error", {
        turnId,
        code,
        message: maskSecrets(message),
      } satisfies ChatErrorEvent);
    } finally {
      entry.running = false;
      entry.controller = undefined;
      entry.lastActivity = Date.now();
      // Drop the finished turn's events so a fresh subscriber doesn't replay
      // them (the completed reply is fetched via the detail endpoint instead).
      entry.buffer = [];
    }
  }

  /** Drop idle in-memory entries; durable state lives in the repository. */
  private sweep(): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (entry.running) continue;
      if (
        entry.emitter.listenerCount("event") === 0 &&
        now - entry.lastActivity >= this.config.artifactTtlMs
      ) {
        this.entries.delete(id);
      }
    }
  }
}
