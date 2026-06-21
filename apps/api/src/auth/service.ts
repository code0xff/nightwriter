import {
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { PublicUser, WebAuthnJSON } from "@nightwriter/shared";
import type { AppConfig } from "../config.js";
import type { Database, UserRecord } from "../db/types.js";
import { logger } from "../util/logger.js";
import {
  type SessionClaims,
  hashPassword,
  newId,
  randomSecret,
  signToken,
  verifyPassword,
  verifyToken,
} from "./crypto.js";
import { newPasskeyUser, seedAdmin, toPublicUser } from "./users.js";

/** Error with a stable code for HTTP mapping. */
export class AuthError extends Error {
  constructor(
    readonly code:
      | "invalid_credentials"
      | "username_taken"
      | "unknown_credential"
      | "not_verified"
      | "pending_activation"
      | "bad_flow",
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface Flow {
  type: "register" | "login";
  challenge: string;
  userId?: string;
  username?: string;
  displayName?: string;
  expires: number;
}

const FLOW_TTL_MS = 5 * 60_000;
const MAX_FLOWS = 1000;
const SECRET_KEY = "session-secret";

export class AuthService {
  private flows = new Map<string, Flow>();

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

  /* ------------------------------ admin ------------------------------- */

  async adminLogin(
    username: string,
    password: string,
  ): Promise<{ token: string; user: PublicUser }> {
    const user = await this.db.users.findByUsername(username);
    if (
      !user ||
      user.role !== "admin" ||
      !user.passwordHash ||
      !(await verifyPassword(password, user.passwordHash))
    ) {
      throw new AuthError("invalid_credentials", 401, "Invalid credentials");
    }
    return { token: this.issueToken(user), user: toPublicUser(user) };
  }

  async changeAdminPassword(
    userId: string,
    current: string,
    next: string,
  ): Promise<void> {
    const user = await this.db.users.findById(userId);
    if (
      !user ||
      !user.passwordHash ||
      !(await verifyPassword(current, user.passwordHash))
    ) {
      throw new AuthError("invalid_credentials", 401, "Current password is wrong");
    }
    if (next.length < 8)
      throw new AuthError("not_verified", 400, "New password too short");
    await this.db.users.setPassword(userId, await hashPassword(next));
  }

  /* --------------------------- passkey: register ---------------------- */

  async startRegistration(
    username: string,
    displayName?: string,
  ): Promise<{ flowId: string; options: WebAuthnJSON }> {
    if (!username || username.length < 3)
      throw new AuthError("not_verified", 400, "Username too short");
    if (await this.db.users.findByUsername(username))
      throw new AuthError("username_taken", 409, "Username is taken");

    const userId = newId("usr");
    const options = await generateRegistrationOptions({
      rpName: this.cfg.webauthn.rpName,
      rpID: this.cfg.webauthn.rpID,
      userID: new TextEncoder().encode(userId),
      userName: username,
      userDisplayName: displayName || username,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });
    const flowId = this.newFlow({
      type: "register",
      challenge: options.challenge,
      userId,
      username,
      displayName,
    });
    return { flowId, options: options as unknown as WebAuthnJSON };
  }

  async finishRegistration(
    flowId: string,
    response: WebAuthnJSON,
  ): Promise<{ user: PublicUser }> {
    const flow = this.takeFlow(flowId, "register");
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: response as unknown as RegistrationResponseJSON,
        expectedChallenge: flow.challenge,
        expectedOrigin: this.cfg.webauthn.origins,
        expectedRPID: this.cfg.webauthn.rpID,
        requireUserVerification: false,
      });
    } catch (err) {
      throw new AuthError(
        "not_verified",
        400,
        `Passkey registration failed: ${(err as Error).message}`,
      );
    }
    if (!verification.verified || !verification.registrationInfo)
      throw new AuthError("not_verified", 400, "Passkey not verified");

    const cred = verification.registrationInfo.credential;
    const user = newPasskeyUser(
      flow.userId!,
      flow.username!,
      flow.displayName ?? flow.username!,
    );
    user.credentials = [
      {
        id: cred.id,
        publicKey: Buffer.from(cred.publicKey).toString("base64url"),
        counter: cred.counter,
        transports: cred.transports,
      },
    ];
    // Guard against a race where the username was taken between start + finish.
    if (await this.db.users.findByUsername(flow.username!))
      throw new AuthError("username_taken", 409, "Username is taken");
    await this.db.users.insert(user);
    return { user: toPublicUser(user) };
  }

  /* ---------------------------- passkey: login ------------------------ */

  async startLogin(): Promise<{ flowId: string; options: WebAuthnJSON }> {
    const options = await generateAuthenticationOptions({
      rpID: this.cfg.webauthn.rpID,
      userVerification: "preferred",
    });
    const flowId = this.newFlow({ type: "login", challenge: options.challenge });
    return { flowId, options: options as unknown as WebAuthnJSON };
  }

  async finishLogin(
    flowId: string,
    response: WebAuthnJSON,
  ): Promise<{ token: string; user: PublicUser }> {
    const flow = this.takeFlow(flowId, "login");
    const credId = (response as { id?: string }).id;
    if (!credId) throw new AuthError("bad_flow", 400, "Malformed response");
    const found = await this.db.users.findByCredentialId(credId);
    if (!found)
      throw new AuthError("unknown_credential", 401, "Unknown passkey");

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: response as unknown as AuthenticationResponseJSON,
        expectedChallenge: flow.challenge,
        expectedOrigin: this.cfg.webauthn.origins,
        expectedRPID: this.cfg.webauthn.rpID,
        requireUserVerification: false,
        credential: {
          id: found.credential.id,
          publicKey: Buffer.from(found.credential.publicKey, "base64url"),
          counter: found.credential.counter,
          transports: found.credential.transports as never,
        },
      });
    } catch (err) {
      throw new AuthError(
        "not_verified",
        401,
        `Passkey verification failed: ${(err as Error).message}`,
      );
    }
    if (!verification.verified)
      throw new AuthError("not_verified", 401, "Passkey not verified");

    await this.db.users.updateCredentialCounter(
      found.credential.id,
      verification.authenticationInfo.newCounter,
    );
    if (found.user.status !== "active")
      throw new AuthError(
        "pending_activation",
        403,
        "Account awaiting admin approval",
      );
    return {
      token: this.issueToken(found.user),
      user: toPublicUser(found.user),
    };
  }

  /* ----------------------------- flow helpers ------------------------- */

  private newFlow(f: Omit<Flow, "expires">): string {
    this.sweepFlows();
    // Bound the map so anonymous start calls can't exhaust memory.
    while (this.flows.size >= MAX_FLOWS) {
      const oldest = this.flows.keys().next().value;
      if (oldest === undefined) break;
      this.flows.delete(oldest);
    }
    const id = newId("flw");
    this.flows.set(id, { ...f, expires: Date.now() + FLOW_TTL_MS });
    return id;
  }

  private takeFlow(id: string, type: Flow["type"]): Flow {
    const flow = this.flows.get(id);
    this.flows.delete(id);
    if (!flow || flow.type !== type || flow.expires < Date.now())
      throw new AuthError("bad_flow", 400, "Expired or invalid ceremony");
    return flow;
  }

  private sweepFlows(): void {
    const now = Date.now();
    for (const [id, f] of this.flows) if (f.expires < now) this.flows.delete(id);
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
