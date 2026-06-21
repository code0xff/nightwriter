import { promises as fs } from "node:fs";
import path from "node:path";
import type { GeneratorCli } from "@nightwriter/shared";
import { type CliAdapter, getAdapter } from "../adapters/index.js";
import type { AppConfig } from "../config.js";
import { GenerateError, type JobRunner } from "../jobs/types.js";
import { createZip } from "../packaging/zip.js";
import { type ArtifactFile, getTargetPlugin } from "../targets/index.js";
import { safeResolve } from "../util/tmp.js";
import { runCli } from "./spawn.js";

/**
 * Build a JobRunner bound to the given config and adapter registry.
 * The runner: engineers the prompt, spawns the generator CLI, parses its
 * output into target-specific artifacts, and zips them.
 */
export function createRunner(
  config: AppConfig,
  registry: Record<GeneratorCli, CliAdapter>,
): JobRunner {
  return async (job, sink) => {
    const target = getTargetPlugin(job.target);
    const adapter = getAdapter(registry, job.generator.cli);
    const model = job.model || adapter.defaultModel;

    const enginePrompt = target.buildGenerationPrompt(job.prompt, job.slug);

    sink.setStage("generating", `Running ${adapter.id} (${model})`);
    const invocation = adapter.buildInvocation({
      prompt: enginePrompt,
      model,
      cwd: job.outDir,
    });

    // When the adapter emits structured streaming output, parse stdout lines
    // into live logs + the definition; otherwise stdout is the raw definition.
    const parser = adapter.createStreamParser?.();
    const { stdout } = await runCli({
      command: invocation.command,
      args: invocation.args,
      cwd: job.outDir,
      env: invocation.env,
      stdin: invocation.promptViaStdin ? enginePrompt : undefined,
      timeoutMs: config.jobTimeoutMs,
      signal: sink.signal,
      onLine: (level, line) => {
        if (parser && level === "info") {
          for (const log of parser.onLine(line)) sink.log("info", log);
        } else {
          sink.log(level, line);
        }
      },
    });

    const streamError = parser?.errorMessage?.();
    if (streamError) throw new GenerateError("cli_failed", streamError);

    const raw = (parser ? parser.result() : stdout).trim();
    if (!raw) {
      throw new GenerateError(
        "cli_failed",
        "CLI produced no output for the definition file",
      );
    }

    sink.setStage("packaging", "Packaging artifacts");
    const artifacts = target.buildArtifacts(raw, {
      slug: job.slug,
      userPrompt: job.prompt,
      generatorCli: adapter.id,
      model,
    });

    // Write artifacts to the isolated out dir (path-traversal guarded),
    // then zip them.
    await writeArtifacts(job.outDir, artifacts);
    const bytes = await createZip(job.zipPath, artifacts);
    sink.log("info", `Created artifact.zip (${bytes} bytes)`);

    // The factory emits the definition as the first artifact.
    const definitionArtifact = artifacts[0];
    return {
      files: artifacts.map((a) => a.path),
      definition: definitionArtifact?.content ?? raw,
      definitionFile: definitionArtifact?.path ?? "agent.md",
    };
  };
}

async function writeArtifacts(
  outDir: string,
  artifacts: ArtifactFile[],
): Promise<void> {
  for (const file of artifacts) {
    const dest = safeResolve(outDir, file.path);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, file.content, { mode: file.mode ?? 0o644 });
  }
}
