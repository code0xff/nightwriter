import type { Target } from "@nightwriter/shared";
import { createTargetPlugin } from "./factory.js";
import { TARGET_SPECS } from "./specs.js";
import type { TargetPlugin } from "./types.js";

export type { ArtifactFile, TargetContext, TargetPlugin } from "./types.js";

const registry: Record<string, TargetPlugin> = Object.fromEntries(
  TARGET_SPECS.map((spec) => [spec.id, createTargetPlugin(spec)]),
);

export function getTargetPlugin(target: Target): TargetPlugin {
  const plugin = registry[target];
  if (!plugin) throw new Error(`unknown target: ${target}`);
  return plugin;
}
