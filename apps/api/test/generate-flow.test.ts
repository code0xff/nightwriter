import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BufferedEvent } from "../src/jobs/types.js";
import { buildApp, type BuiltApp } from "../src/app.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = path.join(here, "fixtures", "fake-cli.mjs");
const ADMIN = { username: "admin", password: "test-admin-pw-123" };

let built: BuiltApp;
let workRoot: string;
let dataRoot: string;
let token: string;

async function adminToken(b: BuiltApp): Promise<string> {
  const res = await b.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: ADMIN,
  });
  return (res.json() as { token: string }).token;
}

function auth(t = token) {
  return { authorization: `Bearer ${t}` };
}

beforeAll(async () => {
  await fs.chmod(FAKE_CLI, 0o755);
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nw-test-"));
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nw-data-"));
  built = await buildApp({
    workRoot,
    dataRoot,
    db: { driver: "sqlite", sqlitePath: ":memory:" },
    bins: { claude: FAKE_CLI, codex: FAKE_CLI },
    jobTimeoutMs: 10_000,
    maxConcurrency: 2,
    auth: {
      sessionSecret: "test-secret",
      sessionTtlMs: 3_600_000,
      adminUsername: ADMIN.username,
      adminPassword: ADMIN.password,
    },
  });
  await built.app.ready();
  token = await adminToken(built);
});

afterAll(async () => {
  await built.app.close();
  await fs.rm(workRoot, { recursive: true, force: true });
  await fs.rm(dataRoot, { recursive: true, force: true });
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
  it("rejects unauthenticated generation", async () => {
    const res = await built.app.inject({
      method: "POST",
      url: "/api/generate",
      payload: { prompt: "x", generator: { cli: "claude" }, target: "claude" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("runs a job end to end and produces a downloadable zip", async () => {
    const res = await built.app.inject({
      method: "POST",
      url: "/api/generate",
      headers: auth(),
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
    expect(done.files).toContain("agent.md");
    expect(done.files).toContain("install.sh");
    expect(done.files).toContain("README.md");

    const status = await built.app.inject({
      url: `/api/generate/${jobId}`,
      headers: auth(),
    });
    expect(status.json()).toMatchObject({
      state: "succeeded",
      stage: "ready",
      downloadReady: true,
    });

    const dl = await built.app.inject({
      url: `/api/generate/${jobId}/download`,
      headers: auth(),
    });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-type"]).toBe("application/zip");
    expect(dl.rawPayload.subarray(0, 2).toString("latin1")).toBe("PK");

    // The finished job is persisted to durable history and re-downloadable.
    const hist = await built.app.inject({ url: "/api/history", headers: auth() });
    const items = (hist.json() as { items: { id: string }[] }).items;
    expect(items.some((i) => i.id === jobId)).toBe(true);
    const reDl = await built.app.inject({
      url: `/api/history/${jobId}/download`,
      headers: auth(),
    });
    expect(reDl.statusCode).toBe(200);
    expect(reDl.rawPayload.subarray(0, 2).toString("latin1")).toBe("PK");

    // the detail endpoint includes the generated definition text
    const detail = await built.app.inject({
      url: `/api/history/${jobId}`,
      headers: auth(),
    });
    const item = (
      detail.json() as { item: { definition?: string; definitionFile?: string } }
    ).item;
    expect(item.definitionFile).toBe("agent.md");
    expect(item.definition).toContain("You are a test agent");
    // the frontmatter name is normalized to the slug derived from the prompt
    expect(item.definition).toContain("name: build-a-meticulous-code-review-agent");
  });

  it("returns 400 on invalid target", async () => {
    const res = await built.app.inject({
      method: "POST",
      url: "/api/generate",
      headers: auth(),
      payload: { prompt: "x", generator: { cli: "claude" }, target: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("surfaces cli_not_found when the binary is missing", async () => {
    const localRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nw-missing-"));
    const localData = await fs.mkdtemp(path.join(os.tmpdir(), "nw-missing-d-"));
    const app2 = await buildApp({
      workRoot: localRoot,
      dataRoot: localData,
      db: { driver: "sqlite", sqlitePath: ":memory:" },
      bins: { claude: "/nonexistent/definitely-not-a-cli", codex: "x" },
      auth: {
        sessionSecret: "test-secret",
        sessionTtlMs: 3_600_000,
        adminUsername: ADMIN.username,
        adminPassword: ADMIN.password,
      },
    });
    await app2.app.ready();
    try {
      const t = await adminToken(app2);
      const res = await app2.app.inject({
        method: "POST",
        url: "/api/generate",
        headers: { authorization: `Bearer ${t}` },
        payload: { prompt: "x", generator: { cli: "claude" }, target: "claude" },
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
      await fs.rm(localData, { recursive: true, force: true });
    }
  });
});
