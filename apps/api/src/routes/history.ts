import { createReadStream } from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { HistoryListResponse } from "@nightwriter/shared";
import type { HistoryStore } from "../history/store.js";
import { pathExists } from "../util/tmp.js";
import type { Guards } from "../auth/guards.js";

interface IdParams {
  id: string;
}

export function registerHistoryRoutes(
  app: FastifyInstance,
  history: HistoryStore,
  guards: Guards,
): void {
  const authed = { preHandler: [guards.requireAuth, guards.requireActive] };

  app.get("/api/history", authed, async (req, reply) => {
    const res: HistoryListResponse = {
      items: await history.listByOwner(req.user!.id),
    };
    return reply.send(res);
  });

  app.get(
    "/api/history/:id/download",
    authed,
    async (req: FastifyRequest<{ Params: IdParams }>, reply) => {
      const item = await history.get(req.params.id);
      if (!item || item.ownerId !== req.user!.id)
        return reply.code(404).send({ error: "not found" });
      const file = history.artifactPath(item.id);
      if (!(await pathExists(file)))
        return reply.code(410).send({ error: "artifact missing" });
      reply.header("Content-Type", "application/zip");
      reply.header(
        "Content-Disposition",
        `attachment; filename="${item.slug}-${item.target}.zip"`,
      );
      return reply.send(createReadStream(file));
    },
  );

  app.delete(
    "/api/history/:id",
    authed,
    async (req: FastifyRequest<{ Params: IdParams }>, reply) => {
      const ok = await history.delete(req.params.id, req.user!.id);
      if (!ok) return reply.code(404).send({ error: "not found" });
      return reply.send({ ok: true });
    },
  );
}
