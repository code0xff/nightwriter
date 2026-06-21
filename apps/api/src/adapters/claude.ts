import type {
  CliAdapter,
  Invocation,
  InvocationContext,
  StreamParser,
} from "./types.js";

/**
 * Adapter for the Claude Code CLI in non-interactive print mode with streaming
 * JSON output:
 *   claude -p --output-format stream-json --include-partial-messages --verbose [--model <m>]
 * The engineered prompt is fed via stdin. Streaming gives live progress (thinking,
 * text deltas, tool use) which we surface as generation logs; the final
 * definition comes from the terminal `result` event.
 */
export function createClaudeAdapter(bin: string): CliAdapter {
  return {
    id: "claude",
    defaultModel: "claude-sonnet-4-6",
    buildInvocation(ctx: InvocationContext): Invocation {
      const args = [
        "-p",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--verbose",
      ];
      const model = ctx.model ?? this.defaultModel;
      if (model) args.push("--model", model);
      return { command: bin, args, promptViaStdin: true };
    },
    createStreamParser(): StreamParser {
      return new ClaudeStreamParser();
    },
  };
}

class ClaudeStreamParser implements StreamParser {
  private resultText = "";
  private textAcc = ""; // full streamed text (fallback if no result event)
  private lineBuf = ""; // partial line being streamed to logs
  private errored?: string;

  onLine(line: string): string[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return []; // ignore non-JSON noise
    }
    const type = ev.type as string | undefined;

    if (type === "system" && ev.subtype === "init") {
      const model = ev.model ? ` (${ev.model as string})` : "";
      return [`session started${model}`];
    }

    if (type === "stream_event") {
      const event = ev.event as Record<string, unknown> | undefined;
      const et = event?.type as string | undefined;
      if (et === "content_block_start") {
        const cb = event!.content_block as Record<string, unknown> | undefined;
        if (cb?.type === "thinking") return ["thinking…"];
        if (cb?.type === "tool_use") return [`tool: ${cb.name as string}`];
        return [];
      }
      if (et === "content_block_delta") {
        const delta = event!.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta") {
          const text = (delta.text as string) ?? "";
          this.textAcc += text;
          return this.streamText(text);
        }
      }
      return [];
    }

    if (type === "result") {
      const out: string[] = [];
      if (this.lineBuf) {
        out.push(this.lineBuf);
        this.lineBuf = "";
      }
      const isError =
        ev.is_error === true || (ev.subtype != null && ev.subtype !== "success");
      if (isError) {
        // Fail closed: don't package partial output as a successful definition.
        this.errored =
          (ev.result as string) ||
          `claude reported ${(ev.subtype as string) ?? "an error"}`;
        out.push(`✗ ${this.errored}`);
        return out;
      }
      this.resultText = (ev.result as string) ?? "";
      const usage = ev.usage as { output_tokens?: number } | undefined;
      out.push(
        `✓ generated${usage?.output_tokens ? ` (${usage.output_tokens} tokens)` : ""}`,
      );
      return out;
    }

    return [];
  }

  errorMessage(): string | undefined {
    return this.errored;
  }

  /** Buffer streamed text and emit completed lines as logs. */
  private streamText(text: string): string[] {
    this.lineBuf += text;
    const out: string[] = [];
    let idx: number;
    while ((idx = this.lineBuf.indexOf("\n")) >= 0) {
      out.push(this.lineBuf.slice(0, idx));
      this.lineBuf = this.lineBuf.slice(idx + 1);
    }
    return out;
  }

  result(): string {
    if (this.errored) return "";
    return this.resultText || this.textAcc;
  }
}
