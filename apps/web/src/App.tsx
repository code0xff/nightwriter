import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  LogOut,
  Menu,
  Moon,
  PackageOpen,
  PenLine,
  Radio,
  ShieldCheck,
  Sun,
} from "lucide-react";
import type {
  DoneEvent,
  ErrorEvent as GenErrorEvent,
  GenerateRequest,
  JobStage,
  JobState,
  LogEvent,
  PublicUser,
  Target,
} from "@nightwriter/shared";
import { Button } from "@/components/ui/button";
import { AccountPage } from "@/components/AccountPage";
import { AdminPage } from "@/components/AdminPage";
import { ChatPanel } from "@/components/ChatPanel";
import { HistoryPanel } from "@/components/HistoryPanel";
import { LoginScreen } from "@/components/LoginScreen";
import { PromptForm } from "@/components/PromptForm";
import { RunView } from "@/components/RunView";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { cancelJob, startGeneration, streamJob } from "@/lib/api";
import { createChat, useCapabilities } from "@/lib/chatApi";
import { useAuth } from "@/lib/authContext";

type View = "generate" | "history" | "chat" | "account" | "admin";

interface RunState {
  jobId: string;
  state: JobState;
  stage: JobStage;
  target: Target;
  logs: LogEvent[];
  done?: DoneEvent;
  error?: GenErrorEvent;
}

const THEME_KEY = "nw_theme";

export default function App() {
  const { user, loading, logout } = useAuth();
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return saved ? saved === "dark" : true; // default: dark
  });

  // Keep the <html> class in sync with state (also applies the saved theme on load).
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const toggleTheme = () =>
    setDark((d) => {
      const next = !d;
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
      return next;
    });

  if (loading)
    return (
      <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">
        <span className="text-xs">Loading…</span>
      </div>
    );

  return (
    <Shell user={user} dark={dark} onToggleTheme={toggleTheme} onLogout={logout} />
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <PenLine className="size-3.5" />
      </span>
      <span className="text-sm font-semibold tracking-tight">Nightwriter</span>
    </div>
  );
}

function BackgroundGlow() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-muted/40 to-transparent"
    />
  );
}

interface NavItem {
  id: View;
  label: string;
  show: boolean;
}

function Shell(props: {
  user: PublicUser | null;
  dark: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  const { user, dark, onToggleTheme, onLogout } = props;
  const [view, setView] = useState<View>("generate");
  const [chatTarget, setChatTarget] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Shell now stays mounted across logout/login, so reset transient view state
  // whenever the signed-in identity changes (or clears) — otherwise a stale
  // view (e.g. "admin") or an open drawer can leak into the next session.
  const userId = user?.id ?? null;
  useEffect(() => {
    setView("generate");
    setChatTarget(null);
    setDrawerOpen(false);
  }, [userId]);

  const nav: NavItem[] = user
    ? ([
        { id: "generate", label: "Generate", show: true },
        { id: "history", label: "History", show: true },
        { id: "chat", label: "Chat", show: true },
        { id: "account", label: "Account", show: true },
        { id: "admin", label: "Admin", show: user.role === "admin" },
      ] as NavItem[]).filter((n) => n.show)
    : [];

  const select = (v: View) => {
    // Selecting "Chat" from the nav shows the list; opening a specific chat
    // goes through openChat (which seeds chatTarget).
    if (v === "chat") setChatTarget(null);
    setView(v);
    setDrawerOpen(false);
  };

  const openChat = (chatId: string) => {
    setChatTarget(chatId);
    setView("chat");
    setDrawerOpen(false);
  };

  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      <Header
        user={user}
        nav={nav}
        view={view}
        onSelect={select}
        dark={dark}
        onToggleTheme={onToggleTheme}
        onLogout={onLogout}
        onOpenDrawer={() => setDrawerOpen(true)}
      />

      {/* Mobile nav drawer */}
      {user && drawerOpen && (
        <MobileDrawer
          user={user}
          nav={nav}
          view={view}
          onSelect={select}
          onClose={() => setDrawerOpen(false)}
          onLogout={onLogout}
        />
      )}

      <main className="relative flex-1">
        <BackgroundGlow />
        <div className="container relative z-10 max-w-3xl space-y-5 py-6">
          {!user && <LoginScreen />}
          {user && view === "generate" && <Generator onOpenChat={openChat} />}
          {user && view === "history" && (
            <HistoryPanel onOpenChat={openChat} />
          )}
          {user && view === "chat" && (
            <ChatPanel key={chatTarget ?? "list"} initialChatId={chatTarget} />
          )}
          {user && view === "account" && <AccountPage />}
          {user && view === "admin" && user.role === "admin" && <AdminPage />}
          {user && (
            <footer className="pt-2 text-center text-[11px] text-muted-foreground">
              Definitions are produced by a real CLI subprocess in an isolated,
              path-guarded workspace.
            </footer>
          )}
        </div>
      </main>
    </div>
  );
}

function Header(props: {
  user: PublicUser | null;
  nav: NavItem[];
  view: View;
  onSelect: (v: View) => void;
  dark: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
  onOpenDrawer: () => void;
}) {
  const { user, nav, view, onSelect, dark, onToggleTheme, onLogout, onOpenDrawer } =
    props;

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="container flex h-12 items-center gap-3">
        {user && (
          <Button
            size="sm"
            variant="ghost"
            className="md:hidden"
            onClick={onOpenDrawer}
            aria-label="Open menu"
          >
            <Menu />
          </Button>
        )}
        <Brand />

        {user && (
          <nav className="ml-3 hidden items-center gap-0.5 md:flex">
            {nav.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onSelect(n.id)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs transition-colors",
                  view === n.id
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {n.label}
              </button>
            ))}
          </nav>
        )}

        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onToggleTheme}
            aria-label="Toggle theme"
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
          {user && <AccountMenu user={user} onLogout={onLogout} />}
        </div>
      </div>
    </header>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  if (!first) return "?";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

function AccountMenu(props: { user: PublicUser; onLogout: () => void }) {
  const { user, onLogout } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div className="relative hidden md:block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md py-1 pl-1 pr-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-foreground">
          {initials(user.displayName)}
        </span>
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-48 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md duration-150 animate-in fade-in zoom-in-95">
          <div className="px-2 py-1.5">
            <div className="truncate text-xs font-medium">{user.displayName}</div>
            <div className="text-[11px] capitalize text-muted-foreground">
              {user.role}
            </div>
          </div>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <LogOut className="size-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

function MobileDrawer(props: {
  user: PublicUser;
  nav: NavItem[];
  view: View;
  onSelect: (v: View) => void;
  onClose: () => void;
  onLogout: () => void;
}) {
  const { user, nav, view, onSelect, onClose, onLogout } = props;
  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <div
        className="absolute inset-0 bg-black/50 duration-200 animate-in fade-in"
        onClick={onClose}
      />
      <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-background shadow-xl duration-200 animate-in slide-in-from-left">
        <div className="flex h-12 shrink-0 items-center border-b border-border px-3">
          <Brand />
        </div>
        <nav className="flex-1 space-y-1 p-2">
          {nav.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onSelect(n.id)}
              className={cn(
                "w-full rounded-md px-3 py-2 text-left text-xs transition-colors",
                view === n.id
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="space-y-2 border-t border-border p-3">
          <div className="px-1">
            <div className="truncate text-xs font-medium">{user.displayName}</div>
            <div className="text-[11px] capitalize text-muted-foreground">
              {user.role}
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="w-full justify-start"
            onClick={onLogout}
          >
            <LogOut />
            Logout
          </Button>
        </div>
      </aside>
    </div>
  );
}

function Generator({ onOpenChat }: { onOpenChat: (chatId: string) => void }) {
  const toast = useToast();
  const capabilities = useCapabilities();
  const [run, setRun] = useState<RunState | null>(null);
  const closeRef = useRef<(() => void) | null>(null);

  const handleSubmit = useCallback(
    async (req: GenerateRequest) => {
      try {
        const { jobId } = await startGeneration(req);
        setRun({
          jobId,
          state: "queued",
          stage: "queued",
          target: req.target,
          logs: [],
        });
        closeRef.current = streamJob(jobId, {
          onStatus: (e) =>
            setRun((r) => (r ? { ...r, state: e.state, stage: e.stage } : r)),
          onLog: (e) => setRun((r) => (r ? { ...r, logs: [...r.logs, e] } : r)),
          onDone: (e) =>
            setRun((r) =>
              r ? { ...r, done: e, state: "succeeded", stage: "ready" } : r,
            ),
          onError: (e) =>
            setRun((r) =>
              r
                ? {
                    ...r,
                    error: e,
                    state: e.code === "canceled" ? "canceled" : "failed",
                    stage: "error",
                  }
                : r,
            ),
          onConnectionError: () =>
            setRun((r) =>
              r && r.state !== "succeeded"
                ? {
                    ...r,
                    error: { code: "internal", message: "Lost connection." },
                    state: "failed",
                    stage: "error",
                  }
                : r,
            ),
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [toast],
  );

  const handleCancel = useCallback(() => {
    if (run) void cancelJob(run.jobId);
  }, [run]);

  const handleReset = useCallback(() => {
    closeRef.current?.();
    closeRef.current = null;
    setRun(null);
  }, []);

  const handleChat = useCallback(async () => {
    if (!run) return;
    try {
      const { chatId } = await createChat(run.jobId);
      onOpenChat(chatId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [run, onOpenChat, toast]);

  if (run)
    return (
      <RunView
        jobId={run.jobId}
        state={run.state}
        stage={run.stage}
        logs={run.logs}
        done={run.done}
        error={run.error}
        onCancel={handleCancel}
        onReset={handleReset}
        onChat={handleChat}
        chatCapable={capabilities?.[run.target] === true}
      />
    );

  return (
    <div className="space-y-4">
      <Hero />
      <PromptForm disabled={false} onSubmit={handleSubmit} />
    </div>
  );
}

function Hero() {
  const chips = [
    { icon: <PackageOpen className="size-3.5" />, label: "5 target runtimes" },
    { icon: <Radio className="size-3.5" />, label: "Live SSE progress" },
    { icon: <ShieldCheck className="size-3.5" />, label: "Zip + install script" },
  ];
  return (
    <section className="space-y-3 pb-1 text-center">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Generate agent definitions from a prompt
      </h1>
      <p className="mx-auto max-w-xl text-xs leading-relaxed text-muted-foreground">
        Describe an agent, pick a generator CLI and a target runtime, and
        Nightwriter runs the CLI to produce a ready-to-install definition —
        streamed live and packaged as a zip.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        {chips.map((c) => (
          <span
            key={c.label}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-2.5 py-1 text-[11px] text-muted-foreground"
          >
            {c.icon}
            {c.label}
          </span>
        ))}
      </div>
    </section>
  );
}
