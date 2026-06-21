import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BufferedEvent } from "../src/jobs/types.js";
import { buildApp, type BuiltApp } from "../src/app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = path.join(here, "fixtures", "fake-cli.mjs");

let built: BuiltApp;
let workRoot: string;

beforeAll(async () => {
  await fs.chmod(FAKE_CLI, 0o755);
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nw-test-"));
  built = await buildApp({
    workRoot,
    bins: { claude: FAKE_CLI, codex: FAKE_CLI },
    jobTimeoutMs: 10_000,
    maxConcurrency: 2,
  });
  await built.app.ready();
});

afterAll(async () => {
  await built.app.close();
  await fs.rm(workRoot, { recursive: true, force: true });
});

function waitForTerminal(jobId: string): Promise<BufferedEvent> {
  return new Promise((resolve, reject) => {
    const unsub = built.store.subscribe(jobId, (e) => {
      if (e.event === "done" || e.event === "error") {
        unsub?.();
        resolve(e);
      }
    });
    if (!unsub) reject(new Error("no such job"));
  });
}

describe("generate flow", () => {
  it("runs a job end to end and produces a downloadable zip", async () => {
    const res = await built.app.inject({
      method: "POST",
      url: "/api/generate",
      payload: {
        prompt: "Build a meticulous code review agent",
        generator: { cli: "claude" },
        target: "claude",
      },
    });
    expect(res.statusCode).toBe(202);
    const { jobId } = res.json() as { jobId: string };
    expect(jobId).toMatch(/^job_/);

    const terminal = await waitForTerminal(jobId);
    expect(terminal.event).toBe("done");
    const done = terminal.data as { files: string[]; downloadUrl: string };
    // definition is written under .claude/agents/<slug>.md plus install + readme
    expect(done.files.some((f) => f.startsWith(".claude/agents/"))).toBe(true);
    expect(done.files).toContain("install.sh");
    expect(done.files).toContain("README.md");

    const status = await built.app.inject({
      url: `/api/generate/${jobId}`,
    });
    expect(status.json()).toMatchObject({
      state: "succeeded",
      stage: "ready",
      downloadReady: true,
    });

    const dl = await built.app.inject({
      url: `/api/generate/${jobId}/download`,
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toBe("application/zip");
    // PK zip magic bytes
    expect(dl.rawPayload.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("returns 400 on invalid target", async () => {
    const res = await built.app.inject({
      method: "POST",
      url: "/api/generate",
      payload: {
        prompt: "x",
        generator: { cli: "claude" },
        target: "nope",
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("surfaces cli_not_found when the binary is missing", async () => {
    const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nw-missing-"));
    const app2 = await buildApp({
      workRoot: localRoot,
      bins: { claude: "/nonexistent/definitely-not-a-cli", codex: "x" },
    });
    await app2.app.ready();
    try {
      const res = await app2.app.inject({
        method: "POST",
        url: "/api/generate",
        payload: {
          prompt: "x",
          generator: { cli: "claude" },
          target: "claude",
        },
      });
      const { jobId } = res.json() as { jobId: string };
      const terminal = await new Promise<BufferedEvent>((resolve) => {
        const unsub = app2.store.subscribe(jobId, (e) => {
          if (e.event === "error") {
            unsub?.();
            resolve(e);
          }
        });
      });
      expect((terminal.data as { code: string }).code).toBe("cli_not_found");
    } finally {
      await app2.app.close();
      await fs.rm(localRoot, { recursive: true, force: true });
    }
  });
});
