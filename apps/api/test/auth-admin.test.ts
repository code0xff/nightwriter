import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type BuiltApp } from "../src/app.js";

const ADMIN = { username: "admin", password: "admin-pw-12345" };
let app: BuiltApp;
let dataRoot: string;
let token: string;

beforeAll(async () => {
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), "nw-admin-"));
  app = await buildApp({
    dataRoot,
    db: { driver: "sqlite", sqlitePath: ":memory:" },
    auth: {
      sessionSecret: "session-secret-long-enough",
      sessionTtlMs: 3_600_000,
      adminUsername: ADMIN.username,
      adminPassword: ADMIN.password,
    },
  });
  await app.app.ready();
  const res = await app.app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: ADMIN,
  });
  token = (res.json() as { token: string }).token;
});

afterAll(async () => {
  await app.app.close();
  await fs.rm(dataRoot, { recursive: true, force: true });
});

const bearer = () => ({ authorization: `Bearer ${token}` });

async function userByName(name: string) {
  const list = await app.app.inject({ url: "/api/admin/users", headers: bearer() });
  return (list.json() as { users: { id: string; displayName: string; status: string }[] }).users.find(
    (u) => u.displayName === name,
  );
}

describe("password auth", () => {
  it("rejects wrong credentials", async () => {
    const res = await app.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "nope" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("blocks admin endpoints without a token", async () => {
    const res = await app.app.inject({ url: "/api/admin/users" });
    expect(res.statusCode).toBe(401);
  });

  it("registers a pending user, blocks login, then admin activates and login works", async () => {
    const reg = await app.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "alice-password", displayName: "Alice" },
    });
    expect(reg.statusCode).toBe(201);

    // pending account cannot log in yet
    const pending = await app.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice", password: "alice-password" },
    });
    expect(pending.statusCode).toBe(403);
    expect((pending.json() as { code: string }).code).toBe("pending_activation");

    const found = await userByName("Alice");
    expect(found?.status).toBe("pending");

    const act = await app.app.inject({
      method: "POST",
      url: `/api/admin/users/${found!.id}/activate`,
      headers: bearer(),
    });
    expect(act.statusCode).toBe(200);

    const ok = await app.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "alice", password: "alice-password" },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { user: { role: string } }).user.role).toBe("user");
  });

  it("rejects duplicate usernames and weak passwords on register", async () => {
    const dup = await app.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "alice", password: "another-password" },
    });
    expect(dup.statusCode).toBe(409);
    const weak = await app.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "bob", password: "short" },
    });
    expect(weak.statusCode).toBe(400);
  });

  it("lets a user change their own username and password", async () => {
    // register + activate a fresh password user
    await app.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { username: "carol", password: "carol-password", displayName: "Carol" },
    });
    const found = await userByName("Carol");
    await app.app.inject({
      method: "POST",
      url: `/api/admin/users/${found!.id}/activate`,
      headers: bearer(),
    });
    const login = await app.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "carol", password: "carol-password" },
    });
    const carol = () => ({
      authorization: `Bearer ${(login.json() as { token: string }).token}`,
    });

    // change username
    const rename = await app.app.inject({
      method: "POST",
      url: "/api/account/username",
      headers: carol(),
      payload: { username: "carol-new" },
    });
    expect(rename.statusCode).toBe(200);
    expect((rename.json() as { user: { username: string } }).user.username).toBe(
      "carol-new",
    );

    // the new username logs in; the old one no longer exists
    expect(
      (
        await app.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { username: "carol-new", password: "carol-password" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { username: "carol", password: "carol-password" },
        })
      ).statusCode,
    ).toBe(401);

    // can't take an existing username
    const clash = await app.app.inject({
      method: "POST",
      url: "/api/account/username",
      headers: carol(),
      payload: { username: "admin" },
    });
    expect(clash.statusCode).toBe(409);

    // change password (wrong current is rejected, correct one works)
    expect(
      (
        await app.app.inject({
          method: "POST",
          url: "/api/account/password",
          headers: carol(),
          payload: { currentPassword: "wrong", newPassword: "carol-updated" },
        })
      ).statusCode,
    ).toBe(401);
    const pw = await app.app.inject({
      method: "POST",
      url: "/api/account/password",
      headers: carol(),
      payload: { currentPassword: "carol-password", newPassword: "carol-updated" },
    });
    expect(pw.statusCode).toBe(200);
    expect(
      (
        await app.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: { username: "carol-new", password: "carol-updated" },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("changes the admin password", async () => {
    const res = await app.app.inject({
      method: "POST",
      url: "/api/admin/password",
      headers: bearer(),
      payload: { currentPassword: ADMIN.password, newPassword: "new-pw-67890" },
    });
    expect(res.statusCode).toBe(200);

    const oldLogin = await app.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: ADMIN,
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: "new-pw-67890" },
    });
    expect(newLogin.statusCode).toBe(200);
  });
});
