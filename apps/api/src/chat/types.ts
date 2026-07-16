import type { ChatSseEventName } from "@nightwriter/shared";

/** Error carrying an HTTP status + client code, thrown by the chat store. */
export class ChatError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ChatError";
  }
}

/** A buffered chat SSE frame, replayed to a mid-turn subscriber. */
export interface ChatBufferedEvent {
  id: number;
  event: ChatSseEventName;
  data: unknown;
}
