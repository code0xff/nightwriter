import type {
  DoneEvent,
  ErrorEvent as GenErrorEvent,
  GenerateRequest,
  GenerateResponse,
  HistoryItem,
  HistoryItemResponse,
  HistoryListResponse,
  JobStatus,
  LogEvent,
  StatusEvent,
} from "@nightwriter/shared";

const BASE = import.meta.env.VITE_API_BASE ?? "";

/* ------------------------------ auth token ------------------------------ */

let authToken: string | null = null;
export function setAuthToken(token: string | null): void {
  authToken = token;
}

let onUnauthorized: (() => void) | null = null;
/** Called when an authenticated request gets a 401 (e.g. expired session). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return authToken ? { ...extra, Authorization: `Bearer ${authToken}` } : extra;
}

/** Append the token as a query param (for URLs that can't carry a header). */
function withToken(url: string): string {
  if (!authToken) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(authToken)}`;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: authHeaders({
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...((init?.headers as Record<string, string>) ?? {}),
    }),
  });
  if (!res.ok) {
    let message = `request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      if (body.error) message = body.error;
      code = body.code;
    } catch {
      /* ignore */
    }
    // A *session* 401 (the auth guard's code-less "unauthorized") while we hold
    // a token means the session is gone/expired — drop it so the app falls back
    // to the login screen. Operation-level 401s carry a code (e.g. a wrong
    // current password on /account/password) and must NOT log the user out.
    if (res.status === 401 && authToken && !code) onUnauthorized?.();
    throw new ApiError(res.status, message, code);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/* ------------------------------ generation ------------------------------ */

export function startGeneration(req: GenerateRequest): Promise<GenerateResponse> {
  return request<GenerateResponse>("/api/generate", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export function getJobStatus(jobId: string): Promise<JobStatus> {
  return request<JobStatus>(`/api/generate/${jobId}`);
}

export async function cancelJob(jobId: string): Promise<void> {
  await request(`/api/generate/${jobId}/cancel`, { method: "POST" });
}

export function downloadUrl(jobId: string): string {
  return withToken(`${BASE}/api/generate/${jobId}/download`);
}

export interface StreamHandlers {
  onStatus?: (e: StatusEvent) => void;
  onLog?: (e: LogEvent) => void;
  onDone?: (e: DoneEvent) => void;
  onError?: (e: GenErrorEvent) => void;
  onConnectionError?: () => void;
}

export function streamJob(jobId: string, handlers: StreamHandlers): () => void {
  const es = new EventSource(withToken(`${BASE}/api/generate/${jobId}/events`));
  let terminated = false;
  const close = () => {
    terminated = true;
    es.close();
  };

  es.addEventListener("status", (ev) =>
    handlers.onStatus?.(JSON.parse((ev as MessageEvent).data) as StatusEvent),
  );
  es.addEventListener("log", (ev) =>
    handlers.onLog?.(JSON.parse((ev as MessageEvent).data) as LogEvent),
  );
  es.addEventListener("done", (ev) => {
    handlers.onDone?.(JSON.parse((ev as MessageEvent).data) as DoneEvent);
    close();
  });
  es.addEventListener("error", (ev) => {
    const me = ev as MessageEvent;
    if (me.data) {
      handlers.onError?.(JSON.parse(me.data) as GenErrorEvent);
      close();
    } else if (!terminated) {
      handlers.onConnectionError?.();
    }
  });
  return close;
}

/* ------------------------------- history -------------------------------- */

export function listHistory(): Promise<HistoryListResponse> {
  return request<HistoryListResponse>("/api/history");
}

export async function getHistoryItem(id: string): Promise<HistoryItem> {
  const res = await request<HistoryItemResponse>(`/api/history/${id}`);
  return res.item;
}

export function historyDownloadUrl(id: string): string {
  return withToken(`${BASE}/api/history/${id}/download`);
}

export async function deleteHistory(id: string): Promise<void> {
  await request(`/api/history/${id}`, { method: "DELETE" });
}
