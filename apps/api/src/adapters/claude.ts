import type { CliAdapter, Invocation, InvocationContext } from "./types.js";

/**
 * Adapter for the Claude Code CLI in non-interactive print mode:
 *   claude -p --output-format text [--model <model>]
 * The engineered prompt is fed via stdin to avoid argv length/charset limits.
 */
export function createClaudeAdapter(bin: string): CliAdapter {
  return {
    id: "claude",
    defaultModel: "claude-sonnet-4-6",
    buildInvocation(ctx: InvocationContext): Invocation {
      const args = ["-p", "--output-format", "text"];
      const model = ctx.model ?? this.defaultModel;
      if (model) args.push("--model", model);
      return {
        command: bin,
        args,
        promptViaStdin: true,
      };
    },
  };
}
