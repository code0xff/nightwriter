import type { FastifyInstance, FastifyReply } from "fastify";
import type {
  ChangePasswordRequest,
  MeResponse,
  UpdateDisplayNameRequest,
} from "@nightwriter/shared";
import { AuthError, type AuthService } from "../auth/service.js";
import type { Guards } from "../auth/guards.js";

function handleAuthError(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof AuthError)
    return reply.code(err.status).send({ error: err.message, code: err.code });
  throw err;
}

/** Self-service account routes: a signed-in user manages their own login. */
export function registerAccountRoutes(
  app: FastifyInstance,
  auth: AuthService,
  guards: Guards,
): void {
  const authed = { preHandler: [guards.requireAuth, guards.requireActive] };

  app.post("/api/account/display-name", authed, async (req, reply) => {
    const body = (req.body ?? {}) as Partial<UpdateDisplayNameRequest>;
    if (typeof body.displayName !== "string" || !body.displayName.trim())
      return reply.code(400).send({ error: "displayName required" });
    try {
      const user = await auth.changeDisplayName(req.user!.id, body.displayName);
      const res: MeResponse = { user };
      return reply.send(res);
    } catch (err) {
      return handleAuthError(err, reply);
    }
  });

  app.post("/api/account/password", authed, async (req, reply) => {
    const body = (req.body ?? {}) as Partial<ChangePasswordRequest>;
    if (!body.currentPassword || !body.newPassword)
      return reply
        .code(400)
        .send({ error: "currentPassword and newPassword required" });
    try {
      await auth.changePassword(
        req.user!.id,
        body.currentPassword,
        body.newPassword,
      );
      return reply.send({ ok: true });
    } catch (err) {
      return handleAuthError(err, reply);
    }
  });
}
