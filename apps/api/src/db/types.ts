import type {
  ChatRole,
  GeneratorCli,
  HistoryItem,
  Role,
  Target,
  UserStatus,
} from "@nightwriter/shared";

/* --------------------------- persistence records -------------------------- */

export interface PasskeyCredential {
  /** credential id, base64url */
  id: string;
  /** COSE public key, base64url */
  publicKey: string;
  counter: number;
  transports?: string[];
}

/** A user can authenticate by password and/or passkey (either may be absent). */
export interface UserRecord {
  id: string;
  displayName: string;
  role: Role;
  status: UserStatus;
  createdAt: number;
  username: string;
  passwordHash?: string;
  credentials?: PasskeyCredential[];
}

/* ------------------------------ repositories ------------------------------ *
 * All methods are async so a synchronous backend (better-sqlite3) and an
 * asynchronous one (e.g. pg/Postgres) can implement the same contract.
 * ------------------------------------------------------------------------- */

export interface UserRepository {
  countAdmins(): Promise<number>;
  insert(user: UserRecord): Promise<void>;
  list(): Promise<UserRecord[]>;
  findById(id: string): Promise<UserRecord | undefined>;
  findByUsername(username: string): Promise<UserRecord | undefined>;
  findByCredentialId(
    credId: string,
  ): Promise<{ user: UserRecord; credential: PasskeyCredential } | undefined>;
  addCredential(userId: string, cred: PasskeyCredential): Promise<void>;
  updateCredentialCounter(credId: string, counter: number): Promise<void>;
  /** Returns false if the user doesn't exist or is an admin. */
  setStatus(userId: string, status: UserStatus): Promise<boolean>;
  setPassword(userId: string, passwordHash: string): Promise<void>;
  /** Change the free-form display name (no uniqueness constraint). */
  setDisplayName(userId: string, displayName: string): Promise<void>;
}

export interface HistoryRepository {
  upsert(item: HistoryItem): Promise<void>;
  listByOwner(ownerId: string): Promise<HistoryItem[]>;
  get(id: string): Promise<HistoryItem | undefined>;
  /** Returns false if missing or not owned by ownerId. */
  delete(id: string, ownerId: string): Promise<boolean>;
}

export interface SettingsRepository {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

/**
 * A persisted chat session. Carries server-only fields (the agent definition
 * and the runtime's session id) that the client-facing `ChatSession` omits.
 */
export interface ChatRecord {
  id: string;
  ownerId: string;
  historyId?: string;
  title: string;
  target: Target;
  runtime: GeneratorCli;
  model: string;
  /** Slug used when installing the agent into the runtime's agents dir. */
  slug: string;
  /** The agent definition text driven as the runtime agent. */
  definition: string;
  /** Root filename of the definition (e.g. "agent.md"). */
  definitionFile: string;
  /** The runtime CLI's own session id, set after the first turn (for resume). */
  runtimeSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessageRecord {
  id: string;
  chatId: string;
  role: ChatRole;
  content: string;
  /** Monotonic per-chat ordering; assigned by the repository on insert. */
  seq: number;
  createdAt: number;
}

export interface ChatRepository {
  createChat(chat: ChatRecord): Promise<void>;
  getChat(id: string): Promise<ChatRecord | undefined>;
  listByOwner(ownerId: string): Promise<ChatRecord[]>;
  /** Returns false if missing or not owned by ownerId (cascades messages). */
  deleteChat(id: string, ownerId: string): Promise<boolean>;
  /** Append a message; the repository assigns the next seq. */
  addMessage(msg: Omit<ChatMessageRecord, "seq">): Promise<void>;
  listMessages(chatId: string): Promise<ChatMessageRecord[]>;
  setRuntimeSession(id: string, sessionId: string): Promise<void>;
  touch(id: string, updatedAt: number): Promise<void>;
}

/** A storage backend bundles the repositories and a shutdown hook. */
export interface Database {
  readonly users: UserRepository;
  readonly history: HistoryRepository;
  readonly settings: SettingsRepository;
  readonly chats: ChatRepository;
  close(): Promise<void>;
}
