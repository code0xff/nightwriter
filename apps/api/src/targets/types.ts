import type { GeneratorCli, Target } from "@nightwriter/shared";

export interface ArtifactFile {
  /** Path relative to the zip root. */
  path: string;
  content: string;
  /** Unix file mode (e.g. 0o755 for scripts). Defaults to 0o644. */
  mode?: number;
}

export interface TargetContext {
  slug: string;
  userPrompt: string;
  generatorCli: GeneratorCli;
  model: string;
}

export interface TargetPlugin {
  readonly id: Target;
  readonly displayName: string;
  /** Engineered prompt steering the generator CLI toward this format. */
  buildGenerationPrompt(userPrompt: string, slug: string): string;
  /** Turn raw CLI stdout into the full set of files for the zip. */
  buildArtifacts(rawStdout: string, ctx: TargetContext): ArtifactFile[];
}

/**
 * Strip a single surrounding markdown code fence if the model wrapped its
 * output in one. Leaves inner fences intact.
 */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```[^\n]*\n([\s\S]*?)\n```$/;
  const m = fence.exec(trimmed);
  return m ? m[1]!.trim() : trimmed;
}
