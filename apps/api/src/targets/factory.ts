import type { Target } from "@nightwriter/shared";
import {
  type ArtifactFile,
  type TargetContext,
  type TargetPlugin,
  stripCodeFence,
} from "./types.js";

/** Declarative description of a target runtime, expanded into a plugin. */
export interface TargetSpec {
  id: Target;
  displayName: string;
  /** Describes the exact artifact format the generator must emit. */
  formatInstructions: string;
  /** Path (within the zip) where the parsed definition is written. */
  definitionPath: (slug: string) => string;
  /** install.sh body (without shebang; the factory prepends it). */
  installScript: (ctx: TargetContext, definitionPath: string) => string;
  /** Activation guide written to README.md. */
  activationGuide: (ctx: TargetContext, definitionPath: string) => string;
  /** Optional extra static files (manifests, requirements, __init__, ...). */
  extraFiles?: (ctx: TargetContext, definition: string) => ArtifactFile[];
}

const GENERATION_PROMPT = (
  displayName: string,
  userPrompt: string,
  formatInstructions: string,
): string =>
  [
    `You are an expert agent author. Generate an agent definition for the ${displayName} runtime.`,
    "",
    "## The user's agent request",
    userPrompt.trim(),
    "",
    "## Output requirements",
    `Produce the COMPLETE contents of the agent definition file for ${displayName}.`,
    "Output ONLY the raw file contents. Do NOT include explanations, commentary,",
    "or markdown code fences around the whole file.",
    "",
    "## Required format",
    formatInstructions.trim(),
  ].join("\n");

export function createTargetPlugin(spec: TargetSpec): TargetPlugin {
  return {
    id: spec.id,
    displayName: spec.displayName,
    buildGenerationPrompt(userPrompt: string): string {
      return GENERATION_PROMPT(
        spec.displayName,
        userPrompt,
        spec.formatInstructions,
      );
    },
    buildArtifacts(rawStdout: string, ctx: TargetContext): ArtifactFile[] {
      const definition = stripCodeFence(rawStdout);
      const defPath = spec.definitionPath(ctx.slug);
      const files: ArtifactFile[] = [
        { path: defPath, content: ensureTrailingNewline(definition) },
        {
          path: "install.sh",
          content: `#!/usr/bin/env bash\nset -euo pipefail\n\n${spec.installScript(ctx, defPath)}\n`,
          mode: 0o755,
        },
        {
          path: "README.md",
          content: ensureTrailingNewline(spec.activationGuide(ctx, defPath)),
        },
      ];
      if (spec.extraFiles) files.push(...spec.extraFiles(ctx, definition));
      return files;
    },
  };
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}
