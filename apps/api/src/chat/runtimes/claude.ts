import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Invocation } from "../../adapters/types.js";
import { safeResolve } from "../../util/tmp.js";
import { binResolves } from "./probe.js";
import type { ChatRuntime, ChatTurnContext, ChatTurnParser } from "./types.js";

/**
 * Claude Code chat runtime. Installs the generated subagent into
 * `<workDir>/.claude/agents/<slug>.md` and drives it with:
 *   claude -p --output-format stream-json --include-partial-messages --verbose
 *          --agent <slug> (--session-id <id> | --resume <id>) [--model <m>]
 * The user message is fed via stdin. `--agent` honors the definition's
 * frontmatter (tools/model); `-p` fails closed on tools needing permission, so
 * the agent cannot take side effects on the server. Multi-turn context is kept
 * by the CLI's own session store (keyed by session id + cwd), so workDir must
 * be stable across a chat's turns.
 */
export function createClaudeChatRuntime(bin: string): ChatRuntime {
  let availability: Promise<boolean> | undefined;
  return {
    id: "claude",
    available() {
      availability ??= binResolves(bin);
      return availability;
    },
    newSessionId() {
      return randomUUID();
    },
    async install(workDir, definition, slug) {
      const dest = safeResolve(workDir, ".claude", "agents", `${slug}.md`);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, definition, { mode: 0o644 });
    },
    buildTurn(ctx: ChatTurnContext): Invocation {
      const args = [
        "-p",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--agent",
        ctx.slug,
      ];
      args.push(ctx.firstTurn ? "--session-id" : "--resume", ctx.sessionId);
      if (ctx.model) args.push("--model", ctx.model);
      return { command: bin, args, promptViaStdin: true };
    },
    createParser(): ChatTurnParser {
      return new ClaudeChatParser();
    },
  };
}

/**
 * Extracts assistant text from claude's stream-json output. Streams raw
 * `text_delta` chunks live and captures the terminal `result` event as the
 * authoritative reply; fails closed on an error result.
 */
class ClaudeChatParser implements ChatTurnParser {
  private resultText = "";
  private textAcc = "";
  private errored?: string;

  onLine(line: string): string[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return [];
    }
    const type = ev.type as string | undefined;

    if (type === "stream_event") {
      const event = ev.event as Record<string, unknown> | undefined;
      if ((event?.type as string) === "content_block_delta") {
        const delta = event!.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta") {
          const text = (delta.text as string) ?? "";
          this.textAcc += text;
          return text ? [text] : [];
        }
      }
      return [];
    }

    if (type === "result") {
      const isError =
        ev.is_error === true || (ev.subtype != null && ev.subtype !== "success");
      if (isError) {
        this.errored =
          (ev.result as string) ||
          `claude reported ${(ev.subtype as string) ?? "an error"}`;
        return [];
      }
      this.resultText = (ev.result as string) ?? "";
      return [];
    }

    return [];
  }

  result(): string {
    if (this.errored) return "";
    return this.resultText || this.textAcc;
  }

  errorMessage(): string | undefined {
    return this.errored;
  }
}
