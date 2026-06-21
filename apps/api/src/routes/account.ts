import type { FastifyInstance, FastifyReply } from "fastify";
import type {
  ChangePasswordRequest,
  MeResponse,
  UpdateUsernameRequest,
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

  app.post("/api/account/username", authed, async (req, reply) => {
    const body = (req.body ?? {}) as Partial<UpdateUsernameRequest>;
    if (!body.username)
      return reply.code(400).send({ error: "username required" });
    try {
      const user = await auth.changeUsername(req.user!.id, body.username);
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
