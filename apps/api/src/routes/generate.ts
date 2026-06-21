import { createReadStream } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { GenerateResponse } from "@nightwriter/shared";
import type { JobStore } from "../jobs/store.js";
import { pathExists } from "../util/tmp.js";
import { SseChannel } from "../util/sse.js";
import { ValidationError, parseGenerateRequest } from "./validate.js";

interface JobParams {
  jobId: string;
}

export function registerGenerateRoutes(
  app: FastifyInstance,
  store: JobStore,
): void {
  app.post("/api/generate", async (req, reply) => {
    let parsed;
    try {
      parsed = parseGenerateRequest(req.body);
    } catch (err) {
      if (err instanceof ValidationError)
        return reply.code(400).send({ error: err.message });
      throw err;
    }
    const record = store.create(parsed);
    const body: GenerateResponse = { jobId: record.id };
    return reply.code(202).send(body);
  });

  app.get(
    "/api/generate/:jobId",
    async (req: FastifyRequest<{ Params: JobParams }>, reply) => {
      const record = store.get(req.params.jobId);
      if (!record) return reply.code(404).send({ error: "job not found" });
      return reply.send(store.toStatus(record));
    },
  );

  app.post(
    "/api/generate/:jobId/cancel",
    async (req: FastifyRequest<{ Params: JobParams }>, reply) => {
      const ok = store.cancel(req.params.jobId);
      if (!ok)
        return reply
          .code(409)
          .send({ error: "job not found or already finished" });
      return reply.send({ ok: true });
    },
  );

  app.get(
    "/api/generate/:jobId/events",
    (req: FastifyRequest<{ Params: JobParams }>, reply: FastifyReply) => {
      const { jobId } = req.params;
      if (!store.get(jobId)) {
        void reply.code(404).send({ error: "job not found" });
        return;
      }
      // Take over the raw socket for SSE.
      reply.hijack();
      const channel = new SseChannel(reply.raw);
      const unsubscribe = store.subscribe(jobId, (e) => {
        channel.send(e.event, e.data, String(e.id));
        if (e.event === "done" || e.event === "error") {
          // Allow the frame to flush, then close.
          setTimeout(() => {
            unsubscribe?.();
            channel.close();
          }, 10);
        }
      });
      if (!unsubscribe) {
        channel.close();
        return;
      }
      channel.onClose(() => unsubscribe());
      // If the job already finished before subscription, buffered events
      // (including the terminal one) were replayed synchronously above.
    },
  );

  app.get(
    "/api/generate/:jobId/download",
    async (req: FastifyRequest<{ Params: JobParams }>, reply) => {
      const record = store.get(req.params.jobId);
      if (!record) return reply.code(404).send({ error: "job not found" });
      if (!record.downloadReady || !(await pathExists(record.zipPath)))
        return reply.code(409).send({ error: "artifact not ready" });
      reply.header("Content-Type", "application/zip");
      reply.header(
        "Content-Disposition",
        `attachment; filename="${record.slug}-${record.target}.zip"`,
      );
      return reply.send(createReadStream(record.zipPath));
    },
  );
}
