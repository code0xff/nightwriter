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

export interface CliAdapter {
  readonly id: GeneratorCli;
  /** Default model used when the request omits one. */
  readonly defaultModel: string;
  /** Build a non-interactive spawn invocation for this CLI. */
  buildInvocation(ctx: InvocationContext): Invocation;
}
