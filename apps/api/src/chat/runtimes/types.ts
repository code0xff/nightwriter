import type { Invocation } from "../../adapters/types.js";

/** Inputs for building one conversational turn's subprocess invocation. */
export interface ChatTurnContext {
  /** Agent slug (frontmatter name / installed filename). */
  slug: string;
  /** Model override for this chat (empty = runtime default). */
  model: string;
  /** The runtime CLI's session id used to keep multi-turn context. */
  sessionId: string;
  /** First turn opens the session; later turns resume it. */
  firstTurn: boolean;
}

/**
 * Parses a runtime CLI's streaming stdout for a single chat turn: surfaces
 * assistant text deltas live and exposes the final reply + any error.
 */
export interface ChatTurnParser {
  /** Process one stdout line; return assistant text chunks to stream. */
  onLine(line: string): string[];
  /** The complete assistant reply once the stream ends. */
  result(): string;
  /** A terminal error reported by the stream (undefined on success). */
  errorMessage(): string | undefined;
}

/**
 * A per-target chat runtime: knows how to install the generated agent into an
 * isolated workspace and drive it as a session-resumed subprocess. Mirrors the
 * generation `CliAdapter` abstraction but for interactive turns.
 */
export interface ChatRuntime {
  readonly id: import("@nightwriter/shared").Target;
  /** Whether this runtime's CLI is present on the server (cached). */
  available(): Promise<boolean>;
  /** Mint a fresh session id for a new chat. */
  newSessionId(): string;
  /** Install the agent definition into the (stable) workDir before a turn. */
  install(workDir: string, definition: string, slug: string): Promise<void>;
  /** Build the subprocess invocation for one turn (message fed via stdin). */
  buildTurn(ctx: ChatTurnContext): Invocation;
  createParser(): ChatTurnParser;
}
