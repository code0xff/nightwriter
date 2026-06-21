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
  /** Visible filename for the definition at the zip root (e.g. "agent.md"). */
  definitionFile: string;
  /**
   * install.sh body (no shebang). Runs with `set -euo pipefail`; `$HERE` is the
   * script's own directory, so it should `cp "$HERE/<definitionFile>" …` into
   * the runtime's location.
   */
  installScript: (ctx: TargetContext) => string;
  /** Activation guide written to README.md. */
  activationGuide: (ctx: TargetContext) => string;
  /** Optional extra files placed at the zip root (manifests, requirements …). */
  extraFiles?: (ctx: TargetContext) => ArtifactFile[];
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

const INSTALL_HEADER = `#!/usr/bin/env bash
set -euo pipefail
# Resolve this script's own directory so it works no matter where it is run from.
HERE="$(cd "$(dirname "\${BASH_SOURCE[0]:-$0}")" && pwd)"
`;

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
      const files: ArtifactFile[] = [
        // The definition lives at the zip root (visible) — install.sh copies it
        // into the runtime's expected location.
        { path: spec.definitionFile, content: ensureTrailingNewline(definition) },
        {
          path: "install.sh",
          content: `${INSTALL_HEADER}\n${spec.installScript(ctx)}\n`,
          mode: 0o755,
        },
        {
          path: "README.md",
          content: ensureTrailingNewline(spec.activationGuide(ctx)),
        },
      ];
      if (spec.extraFiles) files.push(...spec.extraFiles(ctx));
      return files;
    },
  };
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}
