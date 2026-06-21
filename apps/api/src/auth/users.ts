import type { AdminUser, PublicUser } from "@nightwriter/shared";
import type { UserRecord, UserRepository } from "../db/types.js";
import { logger } from "../util/logger.js";
import { hashPassword, newId, randomSecret } from "./crypto.js";

export type { PasskeyCredential, UserRecord } from "../db/types.js";

export function toPublicUser(u: UserRecord): PublicUser {
  return {
    id: u.id,
    displayName: u.displayName,
    role: u.role,
    status: u.status,
    authMethod: u.authMethod,
    createdAt: u.createdAt,
  };
}

export function toAdminUser(u: UserRecord): AdminUser {
  return { ...toPublicUser(u), passkeyCount: u.credentials?.length ?? 0 };
}

/** Ensure an admin exists, seeding from env (password generated if absent). */
export async function seedAdmin(
  users: UserRepository,
  username: string,
  password: string,
): Promise<void> {
  if ((await users.countAdmins()) > 0) return;
  let pw = password;
  if (!pw) {
    pw = randomSecret(9);
    logger.warn(
      `No NIGHTWRITER_ADMIN_PASSWORD set — generated one for "${username}": ${pw}`,
    );
  }
  await users.insert({
    id: newId("usr"),
    displayName: username,
    role: "admin",
    status: "active",
    authMethod: "password",
    createdAt: Date.now(),
    username: username.toLowerCase(),
    passwordHash: hashPassword(pw),
  });
  logger.info(`Seeded admin user "${username}"`);
}

/** Build a pending passkey user record (credential added on finish). */
export function newPasskeyUser(
  id: string,
  username: string,
  displayName: string,
): UserRecord {
  return {
    id,
    displayName: displayName || username,
    role: "user",
    status: "pending",
    authMethod: "passkey",
    createdAt: Date.now(),
    username: username.toLowerCase(),
    credentials: [],
  };
}
