import type { FastifyInstance, FastifyReply } from "fastify";
import type {
  LoginRequest,
  MeResponse,
  PasskeyLoginFinishRequest,
  PasskeyRegisterFinishRequest,
  PasskeyRegisterStartRequest,
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

  /* ------------------------------ passkey ----------------------------- */

  app.post("/api/auth/passkey/register/start", async (req, reply) => {
    const body = (req.body ?? {}) as Partial<PasskeyRegisterStartRequest>;
    if (!body.username)
      return reply.code(400).send({ error: "username required" });
    try {
      return reply.send(
        await auth.startRegistration(body.username, body.displayName),
      );
    } catch (err) {
      return handleAuthError(err, reply);
    }
  });

  app.post("/api/auth/passkey/register/finish", async (req, reply) => {
    const body = (req.body ?? {}) as Partial<PasskeyRegisterFinishRequest>;
    if (!body.flowId || !body.response)
      return reply.code(400).send({ error: "flowId and response required" });
    try {
      return reply
        .code(201)
        .send(await auth.finishRegistration(body.flowId, body.response));
    } catch (err) {
      return handleAuthError(err, reply);
    }
  });

  app.post("/api/auth/passkey/login/start", async (_req, reply) => {
    return reply.send(await auth.startLogin());
  });

  app.post("/api/auth/passkey/login/finish", async (req, reply) => {
    const body = (req.body ?? {}) as Partial<PasskeyLoginFinishRequest>;
    if (!body.flowId || !body.response)
      return reply.code(400).send({ error: "flowId and response required" });
    try {
      return reply.send(await auth.finishLogin(body.flowId, body.response));
    } catch (err) {
      return handleAuthError(err, reply);
    }
  });
}
