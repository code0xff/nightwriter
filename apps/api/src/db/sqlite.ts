import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import type { HistoryItem } from "@nightwriter/shared";
import type {
  Database as Db,
  HistoryRepository,
  PasskeyCredential,
  SettingsRepository,
  UserRecord,
  UserRepository,
} from "./types.js";

const SCHEMA_V1 = `
CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role         TEXT NOT NULL,
  status       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  username     TEXT NOT NULL UNIQUE,
  password_hash TEXT
);
CREATE TABLE credentials (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key  TEXT NOT NULL,
  counter     INTEGER NOT NULL DEFAULT 0,
  transports  TEXT
);
CREATE INDEX idx_credentials_user ON credentials(user_id);
CREATE TABLE history (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt     TEXT NOT NULL,
  generator  TEXT NOT NULL,
  target     TEXT NOT NULL,
  slug       TEXT NOT NULL,
  files      TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_history_owner ON history(owner_id, created_at DESC);
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

type DB = Database.Database;

interface UserRow {
  id: string;
  display_name: string;
  role: string;
  status: string;
  created_at: number;
  username: string;
  password_hash: string | null;
}
interface CredRow {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
}
interface HistoryRow {
  id: string;
  owner_id: string;
  prompt: string;
  generator: string;
  target: string;
  slug: string;
  files: string;
  size_bytes: number;
  created_at: number;
}

function migrate(db: DB): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version < 1) {
    db.transaction(() => {
      db.exec(SCHEMA_V1);
      db.pragma("user_version = 1");
    })();
  }
}

function credFromRow(c: CredRow): PasskeyCredential {
  return {
    id: c.id,
    publicKey: c.public_key,
    counter: c.counter,
    transports: c.transports ? (JSON.parse(c.transports) as string[]) : undefined,
  };
}

class SqliteUsers implements UserRepository {
  constructor(private readonly db: DB) {}

  private credsOf(userId: string): PasskeyCredential[] {
    const rows = this.db
      .prepare("SELECT * FROM credentials WHERE user_id = ?")
      .all(userId) as CredRow[];
    return rows.map(credFromRow);
  }

  private toUser(row: UserRow): UserRecord {
    return {
      id: row.id,
      displayName: row.display_name,
      role: row.role as UserRecord["role"],
      status: row.status as UserRecord["status"],
      createdAt: row.created_at,
      username: row.username,
      passwordHash: row.password_hash ?? undefined,
      credentials: this.credsOf(row.id),
    };
  }

  async countAdmins(): Promise<number> {
    const r = this.db
      .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
      .get() as { n: number };
    return r.n;
  }

  async insert(u: UserRecord): Promise<void> {
    const tx = this.db.transaction((user: UserRecord) => {
      this.db
        .prepare(
          `INSERT INTO users (id, display_name, role, status, created_at, username, password_hash)
           VALUES (@id, @displayName, @role, @status, @createdAt, @username, @passwordHash)`,
        )
        .run({
          id: user.id,
          displayName: user.displayName,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt,
          username: user.username,
          passwordHash: user.passwordHash ?? null,
        });
      for (const c of user.credentials ?? []) this.insertCred(user.id, c);
    });
    tx(u);
  }

  private insertCred(userId: string, c: PasskeyCredential): void {
    this.db
      .prepare(
        `INSERT INTO credentials (id, user_id, public_key, counter, transports)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        c.id,
        userId,
        c.publicKey,
        c.counter,
        c.transports ? JSON.stringify(c.transports) : null,
      );
  }

  async list(): Promise<UserRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM users ORDER BY created_at ASC")
      .all() as UserRow[];
    return rows.map((r) => this.toUser(r));
  }

  async findById(id: string): Promise<UserRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
      | UserRow
      | undefined;
    return row ? this.toUser(row) : undefined;
  }

  async findByUsername(username: string): Promise<UserRecord | undefined> {
    const row = this.db
      .prepare("SELECT * FROM users WHERE username = ?")
      .get(username.toLowerCase()) as UserRow | undefined;
    return row ? this.toUser(row) : undefined;
  }

  async findByCredentialId(credId: string) {
    const cred = this.db
      .prepare("SELECT * FROM credentials WHERE id = ?")
      .get(credId) as CredRow | undefined;
    if (!cred) return undefined;
    const user = await this.findById(cred.user_id);
    if (!user) return undefined;
    return { user, credential: credFromRow(cred) };
  }

  async addCredential(userId: string, cred: PasskeyCredential): Promise<void> {
    this.insertCred(userId, cred);
  }

  async updateCredentialCounter(credId: string, counter: number): Promise<void> {
    // Monotonic: never let a concurrent/replayed login regress the counter.
    this.db
      .prepare("UPDATE credentials SET counter = ? WHERE id = ? AND counter < ?")
      .run(counter, credId, counter);
  }

  async setStatus(
    userId: string,
    status: UserRecord["status"],
  ): Promise<boolean> {
    const info = this.db
      .prepare("UPDATE users SET status = ? WHERE id = ? AND role <> 'admin'")
      .run(status, userId);
    return info.changes > 0;
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    this.db
      .prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .run(passwordHash, userId);
  }
}

class SqliteHistory implements HistoryRepository {
  constructor(private readonly db: DB) {}

  private toItem(row: HistoryRow): HistoryItem {
    return {
      id: row.id,
      ownerId: row.owner_id,
      prompt: row.prompt,
      generator: JSON.parse(row.generator) as HistoryItem["generator"],
      target: row.target as HistoryItem["target"],
      slug: row.slug,
      files: JSON.parse(row.files) as string[],
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
    };
  }

  async upsert(item: HistoryItem): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO history (id, owner_id, prompt, generator, target, slug, files, size_bytes, created_at)
         VALUES (@id, @ownerId, @prompt, @generator, @target, @slug, @files, @sizeBytes, @createdAt)
         ON CONFLICT(id) DO UPDATE SET
           prompt=@prompt, generator=@generator, target=@target, slug=@slug,
           files=@files, size_bytes=@sizeBytes, created_at=@createdAt`,
      )
      .run({
        id: item.id,
        ownerId: item.ownerId,
        prompt: item.prompt,
        generator: JSON.stringify(item.generator),
        target: item.target,
        slug: item.slug,
        files: JSON.stringify(item.files),
        sizeBytes: item.sizeBytes,
        createdAt: item.createdAt,
      });
  }

  async listByOwner(ownerId: string): Promise<HistoryItem[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM history WHERE owner_id = ? ORDER BY created_at DESC",
      )
      .all(ownerId) as HistoryRow[];
    return rows.map((r) => this.toItem(r));
  }

  async get(id: string): Promise<HistoryItem | undefined> {
    const row = this.db.prepare("SELECT * FROM history WHERE id = ?").get(id) as
      | HistoryRow
      | undefined;
    return row ? this.toItem(row) : undefined;
  }

  async delete(id: string, ownerId: string): Promise<boolean> {
    const info = this.db
      .prepare("DELETE FROM history WHERE id = ? AND owner_id = ?")
      .run(id, ownerId);
    return info.changes > 0;
  }
}

class SqliteSettings implements SettingsRepository {
  constructor(private readonly db: DB) {}
  async get(key: string): Promise<string | undefined> {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value;
  }
  async set(key: string, value: string): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
      )
      .run(key, value, value);
  }
}

export class SqliteDatabase implements Db {
  readonly users: UserRepository;
  readonly history: HistoryRepository;
  readonly settings: SettingsRepository;

  private constructor(private readonly db: DB) {
    this.users = new SqliteUsers(db);
    this.history = new SqliteHistory(db);
    this.settings = new SqliteSettings(db);
  }

  /** Open (creating dirs/schema as needed). Pass ":memory:" for tests. */
  static open(file: string): SqliteDatabase {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    const db = new Database(file);
    migrate(db);
    return new SqliteDatabase(db);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
