import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { AuthService } from "./service.js";
import type { UserRecord } from "./users.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: UserRecord;
  }
}

export interface Guards {
  /** 401 unless a valid session token is present (sets req.user). */
  requireAuth: preHandlerHookHandler;
  /** Use after requireAuth: 403 unless the user is active (admins always pass). */
  requireActive: preHandlerHookHandler;
  /** Use after requireAuth: 403 unless the user is an admin. */
  requireAdmin: preHandlerHookHandler;
}

function extractToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  // EventSource can't set headers, so SSE passes the token as a query param.
  const q = (req.query as { token?: unknown } | undefined)?.token;
  return typeof q === "string" ? q : undefined;
}

export function makeGuards(auth: AuthService): Guards {
  const requireAuth: preHandlerHookHandler = async (req, reply) => {
    const token = extractToken(req);
    const user = token ? await auth.userFromToken(token) : null;
    if (!user) return unauthorized(reply);
    req.user = user;
  };

  const requireActive: preHandlerHookHandler = async (req, reply) => {
    const user = req.user;
    if (!user) return unauthorized(reply);
    if (user.role !== "admin" && user.status !== "active")
      return reply.code(403).send({ error: "account is awaiting approval" });
  };

  const requireAdmin: preHandlerHookHandler = async (req, reply) => {
    if (req.user?.role !== "admin")
      return reply.code(403).send({ error: "admin only" });
  };

  return { requireAuth, requireActive, requireAdmin };
}

function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ error: "unauthorized" });
}
