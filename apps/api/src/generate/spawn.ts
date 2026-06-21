import { type ChildProcess, spawn } from "node:child_process";
import type { LogLevel } from "@nightwriter/shared";
import { GenerateError } from "../jobs/types.js";

export interface SpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  /** Prompt to write to stdin (when promptViaStdin). */
  stdin?: string;
  timeoutMs: number;
  signal: AbortSignal;
  onLine: (level: LogLevel, line: string) => void;
}

export interface SpawnResult {
  stdout: string;
}

/**
 * Run a CLI subprocess to completion. stdout is captured and returned;
 * stdout/stderr are also streamed line-by-line via onLine.
 * Maps ENOENT -> cli_not_found, non-zero exit -> cli_failed,
 * timeout -> timeout, abort -> canceled.
 */
export function runCli(opts: SpawnOptions): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(opts.command, opts.args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      reject(
        new GenerateError(
          "internal",
          `failed to spawn ${opts.command}: ${(err as Error).message}`,
        ),
      );
      return;
    }

    let stdout = "";
    let settled = false;
    const lineBufs = { out: "", err: "" };

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal.removeEventListener("abort", onAbort);
      fn();
    };

    const flush = (which: "out" | "err", chunk: string, level: LogLevel) => {
      lineBufs[which] += chunk;
      let idx: number;
      while ((idx = lineBufs[which].indexOf("\n")) >= 0) {
        const line = lineBufs[which].slice(0, idx);
        lineBufs[which] = lineBufs[which].slice(idx + 1);
        if (line.length > 0) opts.onLine(level, line);
      }
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() =>
        reject(
          new GenerateError(
            "timeout",
            `CLI timed out after ${opts.timeoutMs}ms`,
          ),
        ),
      );
    }, opts.timeoutMs);
    timer.unref?.();

    const onAbort = () => {
      child.kill("SIGKILL");
      finish(() => reject(new GenerateError("canceled", "Job canceled")));
    };
    if (opts.signal.aborted) {
      onAbort();
      return;
    }
    opts.signal.addEventListener("abort", onAbort, { once: true });

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d: string) => {
      stdout += d;
      flush("out", d, "info");
    });
    child.stderr?.on("data", (d: string) => flush("err", d, "warn"));

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        finish(() =>
          reject(
            new GenerateError(
              "cli_not_found",
              `CLI not found: ${opts.command}. Is it installed and on PATH?`,
            ),
          ),
        );
      } else {
        finish(() =>
          reject(new GenerateError("cli_failed", err.message)),
        );
      }
    });

    child.on("close", (code, signal) => {
      // Flush any trailing partial lines.
      if (lineBufs.out) opts.onLine("info", lineBufs.out);
      if (lineBufs.err) opts.onLine("warn", lineBufs.err);
      if (code === 0) {
        finish(() => resolve({ stdout }));
      } else {
        finish(() =>
          reject(
            new GenerateError(
              "cli_failed",
              `CLI exited with code ${code ?? "null"}${
                signal ? ` (signal ${signal})` : ""
              }`,
            ),
          ),
        );
      }
    });

    if (opts.stdin !== undefined && child.stdin) {
      child.stdin.end(opts.stdin);
    } else {
      child.stdin?.end();
    }
  });
}
