import type { AdminUser, PublicUser } from "@nightwriter/shared";
import type { UserRecord, UserRepository } from "../db/types.js";
import { logger } from "../util/logger.js";
import { hashPassword, newId, randomSecret } from "./crypto.js";

export type { UserRecord } from "../db/types.js";

export function toPublicUser(u: UserRecord): PublicUser {
  return {
    id: u.id,
    displayName: u.displayName,
    role: u.role,
    status: u.status,
    createdAt: u.createdAt,
  };
}

export function toAdminUser(u: UserRecord): AdminUser {
  return {
    ...toPublicUser(u),
    hasPassword: !!u.passwordHash,
    passkeyCount: u.credentials?.length ?? 0,
  };
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
    createdAt: Date.now(),
    username: username.toLowerCase(),
    passwordHash: await hashPassword(pw),
  });
  logger.info(`Seeded admin user "${username}"`);
}

/** Build a pending self-signup user record (password auth). */
export async function newPasswordUser(
  username: string,
  password: string,
  displayName: string | undefined,
): Promise<UserRecord> {
  return {
    id: newId("usr"),
    displayName: displayName || username,
    role: "user",
    status: "pending",
    createdAt: Date.now(),
    username: username.toLowerCase(),
    passwordHash: await hashPassword(password),
  };
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
    createdAt: Date.now(),
    username: username.toLowerCase(),
    credentials: [],
  };
}
