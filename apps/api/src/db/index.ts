import type { AppConfig } from "../config.js";
import { SqliteDatabase } from "./sqlite.js";
import type { Database } from "./types.js";

export type {
  Database,
  HistoryRepository,
  PasskeyCredential,
  SettingsRepository,
  UserRecord,
  UserRepository,
} from "./types.js";

/**
 * Open the configured storage backend. SQLite today; a Postgres backend can
 * implement the same `Database` interface and be selected via NIGHTWRITER_DB.
 */
export async function openDatabase(config: AppConfig): Promise<Database> {
  switch (config.db.driver) {
    case "sqlite":
      return SqliteDatabase.open(config.db.sqlitePath);
    case "postgres":
      throw new Error(
        "Postgres backend not implemented yet — implement the Database interface in db/postgres.ts and wire it here.",
      );
    default:
      throw new Error(`unknown NIGHTWRITER_DB driver: ${config.db.driver}`);
  }
}
