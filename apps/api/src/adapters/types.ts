import type { GeneratorCli } from "@nightwriter/shared";

export interface InvocationContext {
  /** Fully engineered prompt to feed the generator CLI. */
  prompt: string;
  /** Optional model override from the request. */
  model?: string;
  /** Working directory the subprocess runs in (isolated per job). */
  cwd: string;
}

export interface Invocation {
  /** Executable to spawn (never passed through a shell). */
  command: string;
  /** Argv array — array form prevents shell injection. */
  args: string[];
  /** When true, the prompt is written to the child's stdin instead of argv. */
  promptViaStdin: boolean;
  /** Extra environment for the child process. */
  env?: Record<string, string>;
}

/**
 * Stateful parser for a CLI that emits structured streaming output (one record
 * per stdout line). Lets adapters surface live progress logs and extract the
 * final definition text separately.
 */
export interface StreamParser {
  /** Process one stdout line; return human-readable log lines to surface. */
  onLine(line: string): string[];
  /** Final definition text once the stream ends ("" if none seen). */
  result(): string;
  /** A terminal error reported by the stream (e.g. an error result event). */
  errorMessage?(): string | undefined;
}

export interface CliAdapter {
  readonly id: GeneratorCli;
  /** Default model used when the request omits one. */
  readonly defaultModel: string;
  /** Build a non-interactive spawn invocation for this CLI. */
  buildInvocation(ctx: InvocationContext): Invocation;
  /**
   * Optional: when present, the runner feeds each stdout line to the parser to
   * get live logs and the definition. When absent, stdout is the raw definition
   * and each stdout line is surfaced verbatim as a log.
   */
  createStreamParser?(): StreamParser;
}
