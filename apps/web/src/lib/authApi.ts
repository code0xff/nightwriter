import {
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type {
  AdminUsersResponse,
  AuthSession,
  MeResponse,
  PasskeyLoginStartResponse,
  PasskeyRegisterStartResponse,
  PublicUser,
} from "@nightwriter/shared";
import { request } from "./api";

export function login(username: string, password: string): Promise<AuthSession> {
  return request<AuthSession>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

/** Self-signup; the returned user is pending until an admin activates it. */
export async function register(
  username: string,
  password: string,
  displayName?: string,
): Promise<PublicUser> {
  const res = await request<{ user: PublicUser }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password, displayName }),
  });
  return res.user;
}

export function fetchMe(): Promise<MeResponse> {
  return request<MeResponse>("/api/auth/me");
}

/* ------------------------------ passkey ------------------------------- */

/** Register a passkey for a new user (created pending; admin must activate). */
export async function registerPasskey(
  username: string,
  displayName?: string,
): Promise<PublicUser> {
  const start = await request<PasskeyRegisterStartResponse>(
    "/api/auth/passkey/register/start",
    { method: "POST", body: JSON.stringify({ username, displayName }) },
  );
  const response = await startRegistration({
    optionsJSON: start.options as never,
  });
  const res = await request<{ user: PublicUser }>(
    "/api/auth/passkey/register/finish",
    { method: "POST", body: JSON.stringify({ flowId: start.flowId, response }) },
  );
  return res.user;
}

/** Sign in with a passkey. Throws ApiError (pending_activation) if not approved. */
export async function loginPasskey(): Promise<AuthSession> {
  const start = await request<PasskeyLoginStartResponse>(
    "/api/auth/passkey/login/start",
    { method: "POST" },
  );
  const response = await startAuthentication({
    optionsJSON: start.options as never,
  });
  return request<AuthSession>("/api/auth/passkey/login/finish", {
    method: "POST",
    body: JSON.stringify({ flowId: start.flowId, response }),
  });
}

/* ------------------------------- admin -------------------------------- */

export function listUsers(): Promise<AdminUsersResponse> {
  return request<AdminUsersResponse>("/api/admin/users");
}

export async function setUserActive(id: string, active: boolean): Promise<void> {
  await request(`/api/admin/users/${id}/${active ? "activate" : "deactivate"}`, {
    method: "POST",
  });
}

/* ------------------------------ account ------------------------------- */

/** Change your own login handle. Returns the updated user. */
export async function updateUsername(username: string): Promise<PublicUser> {
  const res = await request<{ user: PublicUser }>("/api/account/username", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
  return res.user;
}

/** Change your own password (password accounts only). */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await request("/api/account/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}
