import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type BuiltApp } from "../src/app.js";
import { newPasskeyUser } from "../src/auth/users.js";

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
      sessionSecret: "s",
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

describe("admin auth", () => {
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

  it("activates a pending passkey user", async () => {
    const user = newPasskeyUser("usr_pending1", "alice", "Alice");
    await app.db.users.insert(user);
    await app.db.users.addCredential(user.id, {
      id: "cred1",
      publicKey: "AAAA",
      counter: 0,
    });

    let list = await app.app.inject({ url: "/api/admin/users", headers: bearer() });
    let found = (list.json() as { users: { id: string; status: string; passkeyCount: number }[] }).users.find(
      (u) => u.id === user.id,
    );
    expect(found).toMatchObject({ status: "pending", passkeyCount: 1 });

    const act = await app.app.inject({
      method: "POST",
      url: `/api/admin/users/${user.id}/activate`,
      headers: bearer(),
    });
    expect(act.statusCode).toBe(200);

    list = await app.app.inject({ url: "/api/admin/users", headers: bearer() });
    found = (list.json() as { users: { id: string; status: string; passkeyCount: number }[] }).users.find(
      (u) => u.id === user.id,
    );
    expect(found?.status).toBe("active");
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
