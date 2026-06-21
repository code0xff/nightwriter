import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  AdminUsersResponse,
  ChangePasswordRequest,
} from "@nightwriter/shared";
import { AuthError, type AuthService } from "../auth/service.js";
import { toAdminUser } from "../auth/users.js";
import type { Guards } from "../auth/guards.js";

interface IdParams {
  id: string;
}

export function registerAdminRoutes(
  app: FastifyInstance,
  auth: AuthService,
  guards: Guards,
): void {
  const adminOnly = { preHandler: [guards.requireAuth, guards.requireAdmin] };

  app.get("/api/admin/users", adminOnly, async (_req, reply) => {
    const res: AdminUsersResponse = {
      users: (await auth.users.list()).map(toAdminUser),
    };
    return reply.send(res);
  });

  app.post(
    "/api/admin/users/:id/activate",
    adminOnly,
    async (req: FastifyRequest<{ Params: IdParams }>, reply) => {
      const ok = await auth.users.setStatus(req.params.id, "active");
      return finishToggle(ok, reply);
    },
  );

  app.post(
    "/api/admin/users/:id/deactivate",
    adminOnly,
    async (req: FastifyRequest<{ Params: IdParams }>, reply) => {
      const ok = await auth.users.setStatus(req.params.id, "pending");
      return finishToggle(ok, reply);
    },
  );

  app.post("/api/admin/password", adminOnly, async (req, reply) => {
    const body = (req.body ?? {}) as Partial<ChangePasswordRequest>;
    if (!body.currentPassword || !body.newPassword)
      return reply
        .code(400)
        .send({ error: "currentPassword and newPassword required" });
    try {
      await auth.changeAdminPassword(
        req.user!.id,
        body.currentPassword,
        body.newPassword,
      );
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof AuthError)
        return reply.code(err.status).send({ error: err.message, code: err.code });
      throw err;
    }
  });
}

function finishToggle(ok: boolean, reply: FastifyReply) {
  if (!ok)
    return reply.code(404).send({ error: "user not found or is an admin" });
  return reply.send({ ok: true });
}
