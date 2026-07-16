import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Target } from "@nightwriter/shared";
import { buildApp, type BuiltApp } from "../src/app.js";
import type { ChatBufferedEvent } from "../src/chat/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = path.join(here, "fixtures", "fake-cli.mjs");
const ADMIN = { username: "admin", password: "test-admin-pw-123" };

let built: BuiltApp;
let workRoot: string;
let dataRoot: string;
let token: string;

function auth(t = token) {
  return { authorization: `Bearer ${t}` };
}

async function login(username: string, password: string): Promise<string> {
  const res = await built.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { username, password },
  });
  return (res.json() as { token: string }).token;
}

/** Generate an agent for `target` and return its history id (= jobId). */
async function generateAgent(target: Target): Promise<string> {
  const res = await built.app.inject({
    method: "POST",
    url: "/api/generate",
    headers: auth(),
    payload: { prompt: "A helpful assistant", generator: { cli: "claude" }, target },
  });
  const { jobId } = res.json() as { jobId: string };
  await new Promise<void>((resolve, reject) => {
    const unsub = built.store.subscribe(jobId, (e) => {
      if (e.event === "done") {
        unsub?.();
        resolve();
      } else if (e.event === "error") {
        unsub?.();
        reject(new Error(`generation failed: ${JSON.stringify(e.data)}`));
      }
    });
    if (!unsub) reject(new Error("no such job"));
  });
  return jobId;
}

interface TurnResult {
  deltas: string[];
  message?: { role: string; content: string };
  event: string;
  data: unknown;
}

/** Subscribe first (so no events are missed), then send a message. */
async function sendAndWait(
  chatId: string,
  content: string,
  t = token,
): Promise<{ status: number; result: TurnResult }> {
  const done = new Promise<TurnResult>((resolve) => {
    const deltas: string[] = [];
    let message: TurnResult["message"];
    const unsub = built.chatStore.subscribe(chatId, (e: ChatBufferedEvent) => {
      if (e.event === "delta") deltas.push((e.data as { text: string }).text);
      else if (e.event === "message")
        message = (
          e.data as { message: { role: string; content: string } }
        ).message;
      else if (e.event === "done" || e.event === "error") {
        unsub();
        resolve({ deltas, message, event: e.event, data: e.data });
      }
    });
  });
  const res = await built.app.inject({
    method: "POST",
    url: `/api/chat/${chatId}/messages`,
    headers: auth(t),
    payload: { content },
  });
  return { status: res.statusCode, result: await done };
}

beforeAll(async () => {
  await fs.chmod(FAKE_CLI, 0o755);
  workRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nw-chat-"));
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nw-chat-d-"));
  built = await buildApp({
    workRoot,
    dataRoot,
    db: { driver: "sqlite", sqlitePath: ":memory:" },
    bins: { claude: FAKE_CLI, codex: FAKE_CLI },
    jobTimeoutMs: 10_000,
    maxConcurrency: 2,
    auth: {
      sessionSecret: "test-secret-long-enough",
      sessionTtlMs: 3_600_000,
      adminUsername: ADMIN.username,
      adminPassword: ADMIN.password,
    },
  });
  await built.app.ready();
  token = await login(ADMIN.username, ADMIN.password);
});

afterAll(async () => {
  await built.app.close();
  await fs.rm(workRoot, { recursive: true, force: true });
  await fs.rm(dataRoot, { recursive: true, force: true });
});

describe("chat flow", () => {
  it("requires auth", async () => {
    expect(
      (await built.app.inject({ url: "/api/chat/capabilities" })).statusCode,
    ).toBe(401);
    expect(
      (
        await built.app.inject({
          method: "POST",
          url: "/api/chat",
          payload: { historyId: "x" },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("reports runtime capabilities (adapter present AND binary available)", async () => {
    const res = await built.app.inject({
      url: "/api/chat/capabilities",
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    const { runtimes } = res.json() as {
      runtimes: Record<Target, boolean>;
    };
    expect(runtimes.claude).toBe(true);
    // codex binary exists but has no chat runtime adapter yet → not capable.
    expect(runtimes.codex).toBe(false);
    expect(runtimes.openclaw).toBe(false);
    expect(runtimes.hermes).toBe(false);
    expect(runtimes.adk).toBe(false);
  });

  it("404s creating a chat for an unknown agent", async () => {
    const res = await built.app.inject({
      method: "POST",
      url: "/api/chat",
      headers: auth(),
      payload: { historyId: "nope" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("gates chat creation on runtime availability", async () => {
    const historyId = await generateAgent("openclaw");
    const res = await built.app.inject({
      method: "POST",
      url: "/api/chat",
      headers: auth(),
      payload: { historyId },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe("runtime_unavailable");
  });

  it("runs a multi-turn conversation with context retained, persisted durably", async () => {
    const historyId = await generateAgent("claude");
    const created = await built.app.inject({
      method: "POST",
      url: "/api/chat",
      headers: auth(),
      payload: { historyId },
    });
    expect(created.statusCode).toBe(201);
    const { chatId } = created.json() as { chatId: string };
    expect(chatId).toMatch(/^chat_/);

    // Turn 1
    const t1 = await sendAndWait(chatId, "My favorite color is teal.");
    expect(t1.status).toBe(202);
    expect(t1.result.event).toBe("done");
    expect(t1.result.message?.role).toBe("assistant");
    expect(t1.result.message?.content).toContain("Ack");
    expect(t1.result.message?.content).toContain("teal");
    // deltas streamed live reconstruct the final reply
    expect(t1.result.deltas.join("")).toBe(t1.result.message?.content);

    // Turn 2 — resume must recall the first message (stable workdir + --resume)
    const t2 = await sendAndWait(chatId, "What did I say?");
    expect(t2.result.event).toBe("done");
    expect(t2.result.message?.content).toContain("Recall(");
    expect(t2.result.message?.content).toContain("teal");

    // Durable: detail endpoint returns the full ordered transcript
    const detail = await built.app.inject({
      url: `/api/chat/${chatId}`,
      headers: auth(),
    });
    const { session } = detail.json() as {
      session: { messages: { role: string; content: string }[]; title: string };
    };
    expect(session.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(session.messages[0]!.content).toBe("My favorite color is teal.");

    // and it shows up in the owner's session list
    const list = await built.app.inject({ url: "/api/chat", headers: auth() });
    const { sessions } = list.json() as { sessions: { id: string }[] };
    expect(sessions.some((s) => s.id === chatId)).toBe(true);

    // owner isolation: another activated user cannot see or touch it
    await built.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "bob", password: "bob-password", displayName: "Bob" },
    });
    const users = await built.app.inject({
      url: "/api/admin/users",
      headers: auth(),
    });
    const bob = (
      users.json() as { users: { id: string; displayName: string }[] }
    ).users.find((u) => u.displayName === "Bob")!;
    await built.app.inject({
      method: "POST",
      url: `/api/admin/users/${bob.id}/activate`,
      headers: auth(),
    });
    const bobToken = await login("bob", "bob-password");
    expect(
      (
        await built.app.inject({
          url: `/api/chat/${chatId}`,
          headers: auth(bobToken),
        })
      ).statusCode,
    ).toBe(404);
    const bobList = await built.app.inject({
      url: "/api/chat",
      headers: auth(bobToken),
    });
    expect((bobList.json() as { sessions: unknown[] }).sessions).toHaveLength(0);

    // owner can delete it
    const del = await built.app.inject({
      method: "DELETE",
      url: `/api/chat/${chatId}`,
      headers: auth(),
    });
    expect(del.statusCode).toBe(200);
    expect(
      (await built.app.inject({ url: `/api/chat/${chatId}`, headers: auth() }))
        .statusCode,
    ).toBe(404);
  });
});
