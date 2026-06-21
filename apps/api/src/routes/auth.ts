import type { FastifyInstance, FastifyReply } from "fastify";
import type {
  LoginRequest,
  MeResponse,
  RegisterRequest,
} from "@nightwriter/shared";
import { AuthError, type AuthService } from "../auth/service.js";
import { toPublicUser } from "../auth/users.js";
import type { Guards } from "../auth/guards.js";

function handleAuthError(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof AuthError)
    return reply.code(err.status).send({ error: err.message, code: err.code });
  throw err;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthService,
  guards: Guards,
): void {
  app.post("/api/auth/login", async (req, reply) => {
    const body = (req.body ?? {}) as Partial<LoginRequest>;
    if (!body.username || !body.password)
      return reply.code(400).send({ error: "username and password required" });
    try {
      return reply.send(await auth.login(body.username, body.password));
    } catch (err) {
      return handleAuthError(err, reply);
    }
  });

  app.post("/api/auth/register", async (req, reply) => {
    const body = (req.body ?? {}) as Partial<RegisterRequest>;
    if (!body.username || !body.password)
      return reply.code(400).send({ error: "username and password required" });
    try {
      return reply
        .code(201)
        .send(await auth.register(body.username, body.password, body.displayName));
    } catch (err) {
      return handleAuthError(err, reply);
    }
  });

  app.get(
    "/api/auth/me",
    { preHandler: guards.requireAuth },
    async (req, reply) => {
      const res: MeResponse = { user: toPublicUser(req.user!) };
      return reply.send(res);
    },
  );
}
