import path from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import type { HistoryItem } from "@nightwriter/shared";
import type {
  ChatMessageRecord,
  ChatRecord,
  ChatRepository,
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

// v3: interactive chat sessions with a generated agent + their messages.
const SCHEMA_V3 = `
CREATE TABLE chats (
  id                 TEXT PRIMARY KEY,
  owner_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  history_id         TEXT,
  title              TEXT NOT NULL,
  target             TEXT NOT NULL,
  runtime            TEXT NOT NULL,
  model              TEXT NOT NULL,
  slug               TEXT NOT NULL,
  definition         TEXT NOT NULL,
  definition_file    TEXT NOT NULL,
  runtime_session_id TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX idx_chats_owner ON chats(owner_id, updated_at DESC);
CREATE TABLE chat_messages (
  id         TEXT PRIMARY KEY,
  chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_chat_messages_chat ON chat_messages(chat_id, seq);
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
  definition: string | null;
  definition_file: string | null;
}
interface ChatRow {
  id: string;
  owner_id: string;
  history_id: string | null;
  title: string;
  target: string;
  runtime: string;
  model: string;
  slug: string;
  definition: string;
  definition_file: string;
  runtime_session_id: string | null;
  created_at: number;
  updated_at: number;
}
interface ChatMessageRow {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  seq: number;
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
  if (version < 2) {
    db.transaction(() => {
      db.exec(
        `ALTER TABLE history ADD COLUMN definition TEXT;
         ALTER TABLE history ADD COLUMN definition_file TEXT;`,
      );
      db.pragma("user_version = 2");
    })();
  }
  if (version < 3) {
    db.transaction(() => {
      db.exec(SCHEMA_V3);
      db.pragma("user_version = 3");
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

  async setDisplayName(userId: string, displayName: string): Promise<void> {
    this.db
      .prepare("UPDATE users SET display_name = ? WHERE id = ?")
      .run(displayName, userId);
  }
}

class SqliteHistory implements HistoryRepository {
  constructor(private readonly db: DB) {}

  private toItem(row: HistoryRow, withDefinition = false): HistoryItem {
    const item: HistoryItem = {
      id: row.id,
      ownerId: row.owner_id,
      prompt: row.prompt,
      generator: JSON.parse(row.generator) as HistoryItem["generator"],
      target: row.target as HistoryItem["target"],
      slug: row.slug,
      files: JSON.parse(row.files) as string[],
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
      definitionFile: row.definition_file ?? undefined,
    };
    if (withDefinition) item.definition = row.definition ?? undefined;
    return item;
  }

  async upsert(item: HistoryItem): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO history (id, owner_id, prompt, generator, target, slug, files, size_bytes, created_at, definition, definition_file)
         VALUES (@id, @ownerId, @prompt, @generator, @target, @slug, @files, @sizeBytes, @createdAt, @definition, @definitionFile)
         ON CONFLICT(id) DO UPDATE SET
           prompt=@prompt, generator=@generator, target=@target, slug=@slug,
           files=@files, size_bytes=@sizeBytes, created_at=@createdAt,
           definition=@definition, definition_file=@definitionFile`,
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
        definition: item.definition ?? null,
        definitionFile: item.definitionFile ?? null,
      });
  }

  async listByOwner(ownerId: string): Promise<HistoryItem[]> {
    // Exclude the (potentially large) definition column from list payloads.
    const rows = this.db
      .prepare(
        `SELECT id, owner_id, prompt, generator, target, slug, files, size_bytes, created_at, definition_file, NULL AS definition
         FROM history WHERE owner_id = ? ORDER BY created_at DESC`,
      )
      .all(ownerId) as HistoryRow[];
    return rows.map((r) => this.toItem(r));
  }

  async get(id: string): Promise<HistoryItem | undefined> {
    const row = this.db.prepare("SELECT * FROM history WHERE id = ?").get(id) as
      | HistoryRow
      | undefined;
    return row ? this.toItem(row, true) : undefined;
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

class SqliteChats implements ChatRepository {
  constructor(private readonly db: DB) {}

  private toRecord(row: ChatRow): ChatRecord {
    return {
      id: row.id,
      ownerId: row.owner_id,
      historyId: row.history_id ?? undefined,
      title: row.title,
      target: row.target as ChatRecord["target"],
      runtime: row.runtime as ChatRecord["runtime"],
      model: row.model,
      slug: row.slug,
      definition: row.definition,
      definitionFile: row.definition_file,
      runtimeSessionId: row.runtime_session_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async createChat(chat: ChatRecord): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO chats (id, owner_id, history_id, title, target, runtime, model, slug, definition, definition_file, runtime_session_id, created_at, updated_at)
         VALUES (@id, @ownerId, @historyId, @title, @target, @runtime, @model, @slug, @definition, @definitionFile, @runtimeSessionId, @createdAt, @updatedAt)`,
      )
      .run({
        id: chat.id,
        ownerId: chat.ownerId,
        historyId: chat.historyId ?? null,
        title: chat.title,
        target: chat.target,
        runtime: chat.runtime,
        model: chat.model,
        slug: chat.slug,
        definition: chat.definition,
        definitionFile: chat.definitionFile,
        runtimeSessionId: chat.runtimeSessionId ?? null,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      });
  }

  async getChat(id: string): Promise<ChatRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM chats WHERE id = ?").get(id) as
      | ChatRow
      | undefined;
    return row ? this.toRecord(row) : undefined;
  }

  async listByOwner(ownerId: string): Promise<ChatRecord[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM chats WHERE owner_id = ? ORDER BY updated_at DESC",
      )
      .all(ownerId) as ChatRow[];
    return rows.map((r) => this.toRecord(r));
  }

  async deleteChat(id: string, ownerId: string): Promise<boolean> {
    // chat_messages cascade via the FK (foreign_keys pragma is ON).
    const info = this.db
      .prepare("DELETE FROM chats WHERE id = ? AND owner_id = ?")
      .run(id, ownerId);
    return info.changes > 0;
  }

  async addMessage(msg: Omit<ChatMessageRecord, "seq">): Promise<void> {
    const tx = this.db.transaction((m: Omit<ChatMessageRecord, "seq">) => {
      const { n } = this.db
        .prepare(
          "SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM chat_messages WHERE chat_id = ?",
        )
        .get(m.chatId) as { n: number };
      this.db
        .prepare(
          `INSERT INTO chat_messages (id, chat_id, role, content, seq, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(m.id, m.chatId, m.role, m.content, n, m.createdAt);
    });
    tx(msg);
  }

  async listMessages(chatId: string): Promise<ChatMessageRecord[]> {
    const rows = this.db
      .prepare(
        "SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY seq ASC",
      )
      .all(chatId) as ChatMessageRow[];
    return rows.map((r) => ({
      id: r.id,
      chatId: r.chat_id,
      role: r.role as ChatMessageRecord["role"],
      content: r.content,
      seq: r.seq,
      createdAt: r.created_at,
    }));
  }

  async setRuntimeSession(id: string, sessionId: string): Promise<void> {
    this.db
      .prepare("UPDATE chats SET runtime_session_id = ? WHERE id = ?")
      .run(sessionId, id);
  }

  async touch(id: string, updatedAt: number): Promise<void> {
    this.db
      .prepare("UPDATE chats SET updated_at = ? WHERE id = ?")
      .run(updatedAt, id);
  }
}

export class SqliteDatabase implements Db {
  readonly users: UserRepository;
  readonly history: HistoryRepository;
  readonly settings: SettingsRepository;
  readonly chats: ChatRepository;

  private constructor(private readonly db: DB) {
    this.users = new SqliteUsers(db);
    this.history = new SqliteHistory(db);
    this.settings = new SqliteSettings(db);
    this.chats = new SqliteChats(db);
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
