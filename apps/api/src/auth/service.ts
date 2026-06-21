import type { PublicUser } from "@nightwriter/shared";
import type { AppConfig } from "../config.js";
import type { Database, UserRecord } from "../db/types.js";
import { logger } from "../util/logger.js";
import {
  type SessionClaims,
  hashPassword,
  randomSecret,
  signToken,
  verifyPassword,
  verifyToken,
} from "./crypto.js";
import { newPasswordUser, seedAdmin, toPublicUser } from "./users.js";

/** Error with a stable code for HTTP mapping. */
export class AuthError extends Error {
  constructor(
    readonly code:
      | "invalid_credentials"
      | "username_taken"
      | "pending_activation"
      | "weak_password"
      | "invalid_input",
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const SECRET_KEY = "session-secret";
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/i;
const MIN_PASSWORD = 8;

export class AuthService {
  private constructor(
    readonly db: Database,
    private readonly secret: string,
    private readonly cfg: AppConfig,
  ) {}

  /** Convenience accessor used by admin routes. */
  get users() {
    return this.db.users;
  }

  static async open(cfg: AppConfig, db: Database): Promise<AuthService> {
    await seedAdmin(db.users, cfg.auth.adminUsername, cfg.auth.adminPassword);
    const secret = await resolveSecret(cfg, db);
    return new AuthService(db, secret, cfg);
  }

  /* ----------------------------- sessions ----------------------------- */

  private issueToken(user: UserRecord): string {
    const now = Date.now();
    const claims: SessionClaims = {
      sub: user.id,
      role: user.role,
      iat: now,
      exp: now + this.cfg.auth.sessionTtlMs,
    };
    return signToken(claims, this.secret);
  }

  async userFromToken(token: string): Promise<UserRecord | null> {
    const claims = verifyToken(token, this.secret, Date.now());
    if (!claims) return null;
    return (await this.db.users.findById(claims.sub)) ?? null;
  }

  /* --------------------------- password auth -------------------------- */

  /** Username + password sign-in for any role. Pending users are blocked. */
  async login(
    username: string,
    password: string,
  ): Promise<{ token: string; user: PublicUser }> {
    const user = await this.db.users.findByUsername(username);
    if (!user || !(await verifyPassword(password, user.passwordHash)))
      throw new AuthError("invalid_credentials", 401, "Invalid credentials");
    if (user.role !== "admin" && user.status !== "active")
      throw new AuthError(
        "pending_activation",
        403,
        "Account awaiting admin approval",
      );
    return { token: this.issueToken(user), user: toPublicUser(user) };
  }

  /** Self-signup. Creates a pending user that an admin must activate. */
  async register(
    username: string,
    password: string,
    displayName?: string,
  ): Promise<{ user: PublicUser }> {
    if (!USERNAME_RE.test(username))
      throw new AuthError(
        "invalid_input",
        400,
        "Username must be 3–32 chars (letters, digits, . _ -)",
      );
    if (password.length < MIN_PASSWORD)
      throw new AuthError(
        "weak_password",
        400,
        `Password must be at least ${MIN_PASSWORD} characters`,
      );
    if (await this.db.users.findByUsername(username))
      throw new AuthError("username_taken", 409, "Username is taken");

    const user = await newPasswordUser(username, password, displayName);
    try {
      await this.db.users.insert(user);
    } catch {
      // Unique-constraint race between the check and the insert.
      throw new AuthError("username_taken", 409, "Username is taken");
    }
    return { user: toPublicUser(user) };
  }

  async changeAdminPassword(
    userId: string,
    current: string,
    next: string,
  ): Promise<void> {
    const user = await this.db.users.findById(userId);
    if (!user || !(await verifyPassword(current, user.passwordHash)))
      throw new AuthError("invalid_credentials", 401, "Current password is wrong");
    if (next.length < MIN_PASSWORD)
      throw new AuthError("weak_password", 400, "New password too short");
    await this.db.users.setPassword(userId, await hashPassword(next));
  }
}

/** Read the session secret from settings, or generate + persist one. */
async function resolveSecret(cfg: AppConfig, db: Database): Promise<string> {
  if (cfg.auth.sessionSecret) {
    if (cfg.auth.sessionSecret.length < 16)
      logger.warn(
        "NIGHTWRITER_SESSION_SECRET is short (<16 chars); use a long random value",
      );
    return cfg.auth.sessionSecret;
  }
  const existing = await db.settings.get(SECRET_KEY);
  if (existing) return existing;
  const secret = randomSecret(48);
  await db.settings.set(SECRET_KEY, secret);
  return secret;
}
