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
   * Optional: turn the raw generated definition into one or more files (e.g. a
   * multi-file workspace). When omitted, the definition is a single file at
   * `definitionFile`. Paths are sanitized against traversal before zipping.
   */
  expandDefinition?: (definition: string, ctx: TargetContext) => ArtifactFile[];
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

/**
 * Sanitize a zip-entry path from (possibly LLM-generated) content to prevent
 * zip-slip when the recipient extracts the archive: drop drive/leading slashes,
 * `.`/`..` segments, and restrict each segment to a safe charset.
 */
export function safeZipPath(input: string, fallback: string): string {
  const segments = input
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .map((s) => s.replace(/[^A-Za-z0-9._-]/g, "_"))
    .filter(Boolean);
  return segments.length ? segments.join("/") : fallback;
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
      // Definition file(s): a single visible file, or a multi-file workspace.
      // Paths are sanitized (zip-slip safe) since they may be LLM-generated.
      // Reserve our own filenames and de-duplicate so colliding (LLM-generated)
      // paths can't clobber install.sh/README.md or create ambiguous zip entries.
      const taken = new Set<string>(["install.sh", "README.md"]);
      const defFiles = (
        spec.expandDefinition
          ? spec.expandDefinition(definition, ctx)
          : [{ path: spec.definitionFile, content: ensureTrailingNewline(definition) }]
      ).map((f) => {
        const path = uniquePath(safeZipPath(f.path, spec.definitionFile), taken);
        taken.add(path);
        return { ...f, path, content: ensureTrailingNewline(f.content) };
      });
      const files: ArtifactFile[] = [
        ...defFiles,
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

/** Return `path`, or a `-2`/`-3`/… variant if it's already taken. */
function uniquePath(path: string, taken: Set<string>): string {
  if (!taken.has(path)) return path;
  const dot = path.lastIndexOf(".");
  const base = dot > 0 ? path.slice(0, dot) : path;
  const ext = dot > 0 ? path.slice(dot) : "";
  let i = 2;
  while (taken.has(`${base}-${i}${ext}`)) i++;
  return `${base}-${i}${ext}`;
}
