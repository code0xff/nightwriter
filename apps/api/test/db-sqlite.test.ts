import { describe, expect, it } from "vitest";
import type { HistoryItem } from "@nightwriter/shared";
import { SqliteDatabase } from "../src/db/sqlite.js";
import type { UserRecord } from "../src/db/types.js";

function db() {
  return SqliteDatabase.open(":memory:");
}

const user = (id: string, over: Partial<UserRecord> = {}): UserRecord => ({
  id,
  displayName: id,
  role: "user",
  status: "pending",
  authMethod: "passkey",
  createdAt: 1,
  username: id,
  credentials: [],
  ...over,
});

const item = (id: string, ownerId: string): HistoryItem => ({
  id,
  ownerId,
  prompt: "p",
  generator: { cli: "claude" },
  target: "claude",
  slug: "s",
  files: ["a.md"],
  sizeBytes: 10,
  createdAt: Date.now(),
});

describe("sqlite user repository", () => {
  it("inserts and looks up by id, username, and credential", async () => {
    const d = db();
    await d.users.insert(
      user("usr_1", { credentials: [{ id: "credA", publicKey: "PK", counter: 0 }] }),
    );
    expect((await d.users.findById("usr_1"))?.username).toBe("usr_1");
    expect((await d.users.findByUsername("USR_1"))?.id).toBe("usr_1");
    const byCred = await d.users.findByCredentialId("credA");
    expect(byCred?.user.id).toBe("usr_1");
    expect(byCred?.credential.publicKey).toBe("PK");
  });

  it("activates users but refuses to change admins; counts admins", async () => {
    const d = db();
    await d.users.insert(user("usr_admin", { role: "admin", status: "active" }));
    await d.users.insert(user("usr_2"));
    expect(await d.users.countAdmins()).toBe(1);
    expect(await d.users.setStatus("usr_2", "active")).toBe(true);
    expect((await d.users.findById("usr_2"))?.status).toBe("active");
    expect(await d.users.setStatus("usr_admin", "pending")).toBe(false);
  });
});

describe("sqlite history repository", () => {
  it("lists by owner and only lets the owner delete", async () => {
    const d = db();
    // history.owner_id has a FK to users, so the owners must exist first.
    await d.users.insert(user("owner1"));
    await d.users.insert(user("owner2"));
    await d.history.upsert(item("h1", "owner1"));
    await d.history.upsert(item("h2", "owner1"));
    await d.history.upsert(item("h3", "owner2"));

    expect((await d.history.listByOwner("owner1")).map((i) => i.id).sort()).toEqual([
      "h1",
      "h2",
    ]);
    // a different owner cannot delete it
    expect(await d.history.delete("h1", "owner2")).toBe(false);
    expect(await d.history.get("h1")).toBeDefined();
    // the owner can
    expect(await d.history.delete("h1", "owner1")).toBe(true);
    expect(await d.history.get("h1")).toBeUndefined();
  });
});
