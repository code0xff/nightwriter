import type { CliAdapter, Invocation, InvocationContext } from "./types.js";

/**
 * Adapter for the Codex CLI in non-interactive exec mode:
 *   codex exec [--model <model>] -
 * A trailing "-" tells codex to read the prompt from stdin.
 */
export function createCodexAdapter(bin: string): CliAdapter {
  return {
    id: "codex",
    defaultModel: "gpt-5.5",
    buildInvocation(ctx: InvocationContext): Invocation {
      const args = ["exec"];
      const model = ctx.model ?? this.defaultModel;
      if (model) args.push("--model", model);
      args.push("-");
      return {
        command: bin,
        args,
        promptViaStdin: true,
      };
    },
  };
}
