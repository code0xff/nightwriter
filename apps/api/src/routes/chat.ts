import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  ChatDetailResponse,
  ChatListResponse,
  ChatMessage,
  ChatSession,
  CapabilitiesResponse,
  CreateChatRequest,
  CreateChatResponse,
  SendMessageRequest,
  SendMessageResponse,
} from "@nightwriter/shared";
import type { Guards } from "../auth/guards.js";
import { ChatError } from "../chat/types.js";
import type { ChatStore } from "../chat/store.js";
import type { ChatMessageRecord, ChatRecord } from "../db/types.js";
import { SseChannel } from "../util/sse.js";

interface ChatParams {
  id: string;
}

function toSession(rec: ChatRecord): ChatSession {
  return {
    id: rec.id,
    ownerId: rec.ownerId,
    historyId: rec.historyId,
    title: rec.title,
    target: rec.target,
    runtime: rec.runtime,
    model: rec.model,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
  };
}

function toMessage(m: ChatMessageRecord): ChatMessage {
  return { id: m.id, role: m.role, content: m.content, createdAt: m.createdAt };
}

function handleChatError(err: unknown, reply: FastifyReply): FastifyReply {
  if (err instanceof ChatError)
    return reply.code(err.status).send({ error: err.message, code: err.code });
  throw err;
}

export function registerChatRoutes(
  app: FastifyInstance,
  store: ChatStore,
  guards: Guards,
): void {
  const authed = { preHandler: [guards.requireAuth, guards.requireActive] };

  // Owner-scoped lookup: 404 (not 403) so ids of other users don't leak.
  const ownedChat = async (
    req: FastifyRequest<{ Params: ChatParams }>,
    reply: FastifyReply,
  ): Promise<ChatRecord | undefined> => {
    const rec = await store.getSession(req.params.id);
    if (!rec || rec.ownerId !== req.user!.id) {
      void reply.code(404).send({ error: "chat not found" });
      return undefined;
    }
    return rec;
  };

  app.get("/api/chat/capabilities", authed, async () => {
    const runtimes = await store.capabilities();
    return { runtimes } satisfies CapabilitiesResponse;
  });

  app.post("/api/chat", authed, async (req, reply) => {
    const body = req.body as Partial<CreateChatRequest> | undefined;
    if (!body || typeof body.historyId !== "string")
      return reply.code(400).send({ error: "historyId is required" });
    try {
      const rec = await store.createChat(req.user!.id, body.historyId);
      return reply.code(201).send({ chatId: rec.id } satisfies CreateChatResponse);
    } catch (err) {
      return handleChatError(err, reply);
    }
  });

  app.get("/api/chat", authed, async (req) => {
    const sessions = (await store.listByOwner(req.user!.id)).map(toSession);
    return { sessions } satisfies ChatListResponse;
  });

  app.get(
    "/api/chat/:id",
    authed,
    async (req: FastifyRequest<{ Params: ChatParams }>, reply) => {
      const rec = await ownedChat(req, reply);
      if (!rec) return reply;
      const messages = (await store.listMessages(rec.id)).map(toMessage);
      return {
        session: { ...toSession(rec), messages },
      } satisfies ChatDetailResponse;
    },
  );

  app.post(
    "/api/chat/:id/messages",
    authed,
    async (req: FastifyRequest<{ Params: ChatParams }>, reply) => {
      const rec = await ownedChat(req, reply);
      if (!rec) return reply;
      const body = req.body as Partial<SendMessageRequest> | undefined;
      if (!body || typeof body.content !== "string" || !body.content.trim())
        return reply.code(400).send({ error: "content is required" });
      try {
        const turnId = await store.sendMessage(rec, body.content);
        return reply.code(202).send({ turnId } satisfies SendMessageResponse);
      } catch (err) {
        return handleChatError(err, reply);
      }
    },
  );

  app.post(
    "/api/chat/:id/cancel",
    authed,
    async (req: FastifyRequest<{ Params: ChatParams }>, reply) => {
      const rec = await ownedChat(req, reply);
      if (!rec) return reply;
      store.cancel(rec.id);
      return reply.send({ ok: true });
    },
  );

  app.delete(
    "/api/chat/:id",
    authed,
    async (req: FastifyRequest<{ Params: ChatParams }>, reply) => {
      const rec = await ownedChat(req, reply);
      if (!rec) return reply;
      await store.deleteChat(rec.id, req.user!.id);
      return reply.send({ ok: true });
    },
  );

  // SSE: unlike generation, a chat connection is long-lived — it stays open
  // across turns, so it is not auto-closed on a `done`/`error` event.
  app.get<{ Params: ChatParams }>(
    "/api/chat/:id/events",
    authed,
    (req, reply) => {
      void store.getSession(req.params.id).then((rec) => {
        if (!rec || rec.ownerId !== req.user!.id) {
          void reply.code(404).send({ error: "chat not found" });
          return;
        }
        reply.hijack();
        const channel = new SseChannel(reply.raw);
        const unsubscribe = store.subscribe(req.params.id, (e) => {
          channel.send(e.event, e.data, String(e.id));
        });
        channel.onClose(() => unsubscribe());
      });
    },
  );
}
