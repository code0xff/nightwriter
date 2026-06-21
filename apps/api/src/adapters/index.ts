import type { GeneratorCli } from "@nightwriter/shared";
import type { AppConfig } from "../config.js";
import { createClaudeAdapter } from "./claude.js";
import { createCodexAdapter } from "./codex.js";
import type { CliAdapter } from "./types.js";

export type { CliAdapter, Invocation, InvocationContext } from "./types.js";

export function createAdapterRegistry(
  config: AppConfig,
): Record<GeneratorCli, CliAdapter> {
  return {
    claude: createClaudeAdapter(config.bins.claude),
    codex: createCodexAdapter(config.bins.codex),
  };
}

export function getAdapter(
  registry: Record<GeneratorCli, CliAdapter>,
  cli: GeneratorCli,
): CliAdapter {
  const adapter = registry[cli];
  if (!adapter) throw new Error(`unknown generator cli: ${cli}`);
  return adapter;
}
