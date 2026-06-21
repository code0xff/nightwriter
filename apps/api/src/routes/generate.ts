import { createReadStream } from "node:fs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { GenerateResponse } from "@nightwriter/shared";
import type { JobStore } from "../jobs/store.js";
import type { JobRecord } from "../jobs/types.js";
import { pathExists } from "../util/tmp.js";
import { SseChannel } from "../util/sse.js";
import type { Guards } from "../auth/guards.js";
import { ValidationError, parseGenerateRequest } from "./validate.js";

interface JobParams {
  jobId: string;
}

export function registerGenerateRoutes(
  app: FastifyInstance,
  store: JobStore,
  guards: Guards,
): void {
  const authed = { preHandler: [guards.requireAuth, guards.requireActive] };

  // Owner-scoped lookup: returns the job only if it belongs to the caller,
  // otherwise replies 404 (don't leak other users' job ids).
  const ownedJob = (
    req: FastifyRequest<{ Params: JobParams }>,
    reply: FastifyReply,
  ): JobRecord | undefined => {
    const record = store.get(req.params.jobId);
    if (!record || record.ownerId !== req.user!.id) {
      void reply.code(404).send({ error: "job not found" });
      return undefined;
    }
    return record;
  };

  app.post("/api/generate", authed, async (req, reply) => {
    let parsed;
    try {
      parsed = parseGenerateRequest(req.body);
    } catch (err) {
      if (err instanceof ValidationError)
        return reply.code(400).send({ error: err.message });
      throw err;
    }
    const record = store.create(parsed, req.user!.id);
    const body: GenerateResponse = { jobId: record.id };
    return reply.code(202).send(body);
  });

  app.get(
    "/api/generate/:jobId",
    authed,
    async (req: FastifyRequest<{ Params: JobParams }>, reply) => {
      const record = ownedJob(req, reply);
      if (!record) return reply;
      return reply.send(store.toStatus(record));
    },
  );

  app.post(
    "/api/generate/:jobId/cancel",
    authed,
    async (req: FastifyRequest<{ Params: JobParams }>, reply) => {
      if (!ownedJob(req, reply)) return reply;
      const ok = store.cancel(req.params.jobId);
      if (!ok)
        return reply
          .code(409)
          .send({ error: "job not found or already finished" });
      return reply.send({ ok: true });
    },
  );

  app.get<{ Params: JobParams }>(
    "/api/generate/:jobId/events",
    authed,
    (req, reply) => {
      const record = store.get(req.params.jobId);
      if (!record || record.ownerId !== req.user!.id) {
        void reply.code(404).send({ error: "job not found" });
        return;
      }
      // Take over the raw socket for SSE.
      reply.hijack();
      const channel = new SseChannel(reply.raw);
      const unsubscribe = store.subscribe(req.params.jobId, (e) => {
        channel.send(e.event, e.data, String(e.id));
        if (e.event === "done" || e.event === "error") {
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
    },
  );

  app.get(
    "/api/generate/:jobId/download",
    authed,
    async (req: FastifyRequest<{ Params: JobParams }>, reply) => {
      const record = ownedJob(req, reply);
      if (!record) return reply;
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
