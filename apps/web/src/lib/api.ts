import type {
  DoneEvent,
  ErrorEvent as GenErrorEvent,
  GenerateRequest,
  GenerateResponse,
  JobStatus,
  LogEvent,
  StatusEvent,
} from "@nightwriter/shared";

const BASE = import.meta.env.VITE_API_BASE ?? "";

export async function startGeneration(
  req: GenerateRequest,
): Promise<GenerateResponse> {
  const res = await fetch(`${BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const detail = await safeError(res);
    throw new Error(detail);
  }
  return (await res.json()) as GenerateResponse;
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const res = await fetch(`${BASE}/api/generate/${jobId}`);
  if (!res.ok) throw new Error(await safeError(res));
  return (await res.json()) as JobStatus;
}

export async function cancelJob(jobId: string): Promise<void> {
  await fetch(`${BASE}/api/generate/${jobId}/cancel`, { method: "POST" });
}

export function downloadUrl(jobId: string): string {
  return `${BASE}/api/generate/${jobId}/download`;
}

export interface StreamHandlers {
  onStatus?: (e: StatusEvent) => void;
  onLog?: (e: LogEvent) => void;
  onDone?: (e: DoneEvent) => void;
  onError?: (e: GenErrorEvent) => void;
  /** Network-level failure (connection dropped before a terminal event). */
  onConnectionError?: () => void;
}

/**
 * Subscribe to a job's SSE stream. Returns a function that closes the stream.
 * The stream auto-closes on a `done` or `error` event.
 */
export function streamJob(jobId: string, handlers: StreamHandlers): () => void {
  const es = new EventSource(`${BASE}/api/generate/${jobId}/events`);
  let terminated = false;

  const close = () => {
    terminated = true;
    es.close();
  };

  es.addEventListener("status", (ev) => {
    handlers.onStatus?.(JSON.parse((ev as MessageEvent).data) as StatusEvent);
  });
  es.addEventListener("log", (ev) => {
    handlers.onLog?.(JSON.parse((ev as MessageEvent).data) as LogEvent);
  });
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
      // EventSource transport error (not an app-level error event).
      handlers.onConnectionError?.();
    }
  });

  return close;
}

async function safeError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `request failed (${res.status})`;
  } catch {
    return `request failed (${res.status})`;
  }
}
