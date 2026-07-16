import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Loader2,
  MessagesSquare,
  Send,
  Trash2,
  X,
} from "lucide-react";
import type { ChatMessage, ChatSession, ChatSessionDetail } from "@nightwriter/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import {
  cancelChat,
  deleteChat,
  getChat,
  listChats,
  sendChatMessage,
  streamChat,
} from "@/lib/chatApi";

export function ChatPanel({ initialChatId }: { initialChatId?: string | null }) {
  const [selected, setSelected] = useState<string | null>(initialChatId ?? null);

  if (selected)
    return (
      <ChatConversation
        id={selected}
        onBack={() => setSelected(null)}
        onDeleted={() => setSelected(null)}
      />
    );
  return <ChatList onOpen={setSelected} />;
}

function ChatList({ onOpen }: { onOpen: (id: string) => void }) {
  const toast = useToast();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    listChats()
      .then(setSessions)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const remove = async (id: string) => {
    setPendingId(id);
    try {
      await deleteChat(id);
      setSessions((xs) => xs.filter((x) => x.id !== id));
      toast.success("Chat deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <MessagesSquare className="size-4" /> Chats
        </CardTitle>
        <CardDescription>
          Conversations with your generated agents, run on their native runtime.
          Start one from a generation result or a history item.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!loading && sessions.length === 0 && !error && (
          <p className="text-[11px] text-muted-foreground">
            No chats yet — open a generated agent and click “Chat with this
            agent”.
          </p>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(s.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onOpen(s.id);
            }}
            className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 transition-colors hover:border-foreground/30 hover:bg-accent"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{s.target}</Badge>
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {s.runtime}
                  {s.model ? ` · ${s.model}` : ""}
                </span>
              </div>
              <p className="truncate text-xs" title={s.title}>
                {s.title}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {new Date(s.updatedAt).toLocaleString()}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                aria-label="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(s.id);
                }}
                disabled={pendingId === s.id}
              >
                {pendingId === s.id ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Trash2 />
                )}
              </Button>
              <ChevronRight className="size-4 text-muted-foreground" />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ChatConversation({
  id,
  onBack,
  onDeleted,
}: {
  id: string;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [session, setSession] = useState<ChatSessionDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load transcript + open the live stream (long-lived across turns).
  useEffect(() => {
    let alive = true;
    getChat(id)
      .then((s) => {
        if (!alive) return;
        setSession(s);
        setMessages(s.messages);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    const close = streamChat(id, {
      onDelta: (_t, text) => setStreaming((s) => s + text),
      onMessage: (msg) => {
        setMessages((m) => [...m, msg]);
        setStreaming("");
      },
      onDone: () => setRunning(false),
      onError: (code, message) => {
        setRunning(false);
        setStreaming("");
        if (code !== "canceled")
          setError(message || "The agent failed to respond.");
      },
    });
    return () => {
      alive = false;
      close();
    };
  }, [id]);

  // Auto-scroll to the latest message / streamed token.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, streaming, running]);

  const send = async () => {
    const text = input.trim();
    if (!text || running) return;
    setInput("");
    setError(null);
    setMessages((m) => [
      ...m,
      { id: `local_${Date.now()}`, role: "user", content: text, createdAt: Date.now() },
    ]);
    setRunning(true);
    setStreaming("");
    try {
      await sendChatMessage(id, text);
    } catch (e) {
      setRunning(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteChat(id);
      toast.success("Chat deleted.");
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  };

  return (
    <Card className="flex h-[calc(100vh-8rem)] flex-col">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 border-b border-border">
        <div className="flex min-w-0 items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onBack} aria-label="Back">
            <ArrowLeft />
          </Button>
          <div className="min-w-0">
            <CardTitle className="truncate text-sm">
              {session?.title ?? "Chat"}
            </CardTitle>
            {session && (
              <div className="mt-0.5 flex items-center gap-1.5">
                <Badge variant="secondary">{session.target}</Badge>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {session.runtime}
                </span>
              </div>
            )}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={remove}
          disabled={deleting}
          aria-label="Delete chat"
        >
          {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
        </Button>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-0">
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-auto p-4">
          {messages.length === 0 && !running && (
            <p className="pt-8 text-center text-[11px] text-muted-foreground">
              Say hello to test your agent.
            </p>
          )}
          {messages.map((m) => (
            <Bubble key={m.id} role={m.role} content={m.content} />
          ))}
          {running && <Bubble role="assistant" content={streaming} pending />}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>

        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Message the agent…  (Enter to send, Shift+Enter for newline)"
              rows={2}
              className="max-h-40 min-h-[2.5rem] flex-1 resize-none"
              disabled={running}
            />
            {running ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void cancelChat(id)}
                aria-label="Stop"
              >
                <X />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void send()}
                disabled={!input.trim()}
                aria-label="Send"
              >
                <Send />
                Send
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Bubble({
  role,
  content,
  pending,
}: {
  role: ChatMessage["role"];
  content: string;
  pending?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div
      className={cn(
        "flex duration-200 animate-in fade-in slide-in-from-bottom-1",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-xs leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground"
            : "border border-border bg-muted/40",
        )}
      >
        {content || (pending ? "" : " ")}
        {pending && (
          <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-current align-middle" />
        )}
      </div>
    </div>
  );
}
