import { useEffect, useState } from "react";
import type {
  CapabilitiesResponse,
  ChatDetailResponse,
  ChatListResponse,
  ChatMessage,
  ChatSession,
  ChatSessionDetail,
  CreateChatResponse,
  RuntimeCapabilities,
  SendMessageResponse,
} from "@nightwriter/shared";
import { request, streamUrl } from "./api";

/* ------------------------------- requests ------------------------------- */

export function getCapabilities(): Promise<CapabilitiesResponse> {
  return request<CapabilitiesResponse>("/api/chat/capabilities");
}

export function createChat(historyId: string): Promise<CreateChatResponse> {
  return request<CreateChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ historyId }),
  });
}

export async function listChats(): Promise<ChatSession[]> {
  const res = await request<ChatListResponse>("/api/chat");
  return res.sessions;
}

export async function getChat(id: string): Promise<ChatSessionDetail> {
  const res = await request<ChatDetailResponse>(`/api/chat/${id}`);
  return res.session;
}

export function sendChatMessage(
  id: string,
  content: string,
): Promise<SendMessageResponse> {
  return request<SendMessageResponse>(`/api/chat/${id}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
}

export async function cancelChat(id: string): Promise<void> {
  await request(`/api/chat/${id}/cancel`, { method: "POST" });
}

export async function deleteChat(id: string): Promise<void> {
  await request(`/api/chat/${id}`, { method: "DELETE" });
}

/* -------------------------------- stream -------------------------------- */

export interface ChatStreamHandlers {
  onDelta?: (turnId: string, text: string) => void;
  onMessage?: (message: ChatMessage, turnId: string) => void;
  onDone?: (turnId: string) => void;
  onError?: (code: string, message: string, turnId: string) => void;
  onConnectionError?: () => void;
}

/**
 * Subscribe to a chat's live turn stream. Unlike generation, the connection is
 * long-lived — it stays open across turns, so it is only torn down by the
 * returned close function (e.g. on unmount).
 */
export function streamChat(
  chatId: string,
  handlers: ChatStreamHandlers,
): () => void {
  const es = new EventSource(streamUrl(`/api/chat/${chatId}/events`));

  es.addEventListener("delta", (ev) => {
    const d = JSON.parse((ev as MessageEvent).data) as {
      turnId: string;
      text: string;
    };
    handlers.onDelta?.(d.turnId, d.text);
  });
  es.addEventListener("message", (ev) => {
    const d = JSON.parse((ev as MessageEvent).data) as {
      turnId: string;
      message: ChatMessage;
    };
    handlers.onMessage?.(d.message, d.turnId);
  });
  es.addEventListener("done", (ev) => {
    const d = JSON.parse((ev as MessageEvent).data) as { turnId: string };
    handlers.onDone?.(d.turnId);
  });
  es.addEventListener("error", (ev) => {
    const me = ev as MessageEvent;
    if (me.data) {
      const d = JSON.parse(me.data) as {
        turnId: string;
        code: string;
        message: string;
      };
      handlers.onError?.(d.code, d.message, d.turnId);
    } else {
      handlers.onConnectionError?.();
    }
  });

  return () => es.close();
}

/* -------------------------------- hooks --------------------------------- */

/** Fetch runtime capabilities once; null until loaded (or on failure). */
export function useCapabilities(): RuntimeCapabilities | null {
  const [caps, setCaps] = useState<RuntimeCapabilities | null>(null);
  useEffect(() => {
    let alive = true;
    getCapabilities()
      .then((r) => {
        if (alive) setCaps(r.runtimes);
      })
      .catch(() => {
        /* leave null — buttons stay disabled */
      });
    return () => {
      alive = false;
    };
  }, []);
  return caps;
}
