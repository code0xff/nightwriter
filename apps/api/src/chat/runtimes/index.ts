import type { RuntimeCapabilities, Target } from "@nightwriter/shared";
import { TARGETS } from "@nightwriter/shared";
import type { AppConfig } from "../../config.js";
import { createClaudeChatRuntime } from "./claude.js";
import type { ChatRuntime } from "./types.js";

export type { ChatRuntime, ChatTurnContext, ChatTurnParser } from "./types.js";

/**
 * Registry of per-target chat runtimes. A target is chat-capable only when it
 * has a runtime adapter here AND that runtime's CLI is installed on the server.
 * Targets without an adapter (openclaw/hermes/adk) report unavailable, so the
 * web UI disables their "Chat" button.
 */
export interface RuntimeRegistry {
  get(target: Target): ChatRuntime | undefined;
  capabilities(): Promise<RuntimeCapabilities>;
}

export function createRuntimeRegistry(config: AppConfig): RuntimeRegistry {
  const runtimes: Partial<Record<Target, ChatRuntime>> = {
    claude: createClaudeChatRuntime(config.bins.claude),
    // codex added in a later change; others have no server-side runtime.
  };

  return {
    get(target) {
      return runtimes[target];
    },
    async capabilities() {
      const caps = {} as RuntimeCapabilities;
      await Promise.all(
        TARGETS.map(async (t) => {
          const rt = runtimes[t];
          caps[t] = rt ? await rt.available() : false;
        }),
      );
      return caps;
    },
  };
}
