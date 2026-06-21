import type { ServerResponse } from "node:http";
import type { SseEventName } from "@nightwriter/shared";

/**
 * Minimal SSE writer over a raw Node response.
 * We use the raw reply (not a Fastify serializer) for full control over
 * heartbeats and event names.
 */
export class SseChannel {
  private closed = false;
  private heartbeat: NodeJS.Timeout;

  constructor(
    private readonly res: ServerResponse,
    heartbeatMs = 15_000,
  ) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    // Prime the stream so proxies flush headers immediately.
    res.write(": connected\n\n");
    this.heartbeat = setInterval(() => this.comment("ping"), heartbeatMs);
    // Avoid keeping the event loop alive solely for the heartbeat.
    this.heartbeat.unref?.();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  send(event: SseEventName, data: unknown, id?: string): void {
    if (this.closed) return;
    let frame = "";
    if (id) frame += `id: ${id}\n`;
    frame += `event: ${event}\n`;
    frame += `data: ${JSON.stringify(data)}\n\n`;
    this.res.write(frame);
  }

  comment(text: string): void {
    if (this.closed) return;
    this.res.write(`: ${text}\n\n`);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    this.res.end();
  }

  /** Register cleanup when the client disconnects. */
  onClose(cb: () => void): void {
    this.res.on("close", () => {
      this.closed = true;
      clearInterval(this.heartbeat);
      cb();
    });
  }
}
