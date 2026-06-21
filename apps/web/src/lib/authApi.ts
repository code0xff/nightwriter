import type {
  AdminUsersResponse,
  AuthSession,
  MeResponse,
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

/* ------------------------------- admin -------------------------------- */

export function listUsers(): Promise<AdminUsersResponse> {
  return request<AdminUsersResponse>("/api/admin/users");
}

export async function setUserActive(id: string, active: boolean): Promise<void> {
  await request(`/api/admin/users/${id}/${active ? "activate" : "deactivate"}`, {
    method: "POST",
  });
}

export async function changeAdminPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await request("/api/admin/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}
