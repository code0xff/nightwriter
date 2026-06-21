import { type ReactNode, useCallback, useRef, useState } from "react";
import {
  FileClock,
  LogOut,
  Moon,
  PackageOpen,
  PenLine,
  Radio,
  ShieldCheck,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";
import type {
  DoneEvent,
  ErrorEvent as GenErrorEvent,
  GenerateRequest,
  JobStage,
  JobState,
  LogEvent,
} from "@nightwriter/shared";
import { Button } from "@/components/ui/button";
import { AdminPage } from "@/components/AdminPage";
import { HistoryPanel } from "@/components/HistoryPanel";
import { LoginScreen } from "@/components/LoginScreen";
import { PromptForm } from "@/components/PromptForm";
import { RunView } from "@/components/RunView";
import { cn } from "@/lib/utils";
import { cancelJob, startGeneration, streamJob } from "@/lib/api";
import { useAuth } from "@/lib/authContext";

type View = "generate" | "history" | "admin";

interface RunState {
  jobId: string;
  state: JobState;
  stage: JobStage;
  logs: LogEvent[];
  done?: DoneEvent;
  error?: GenErrorEvent;
}

export default function App() {
  const { user, loading, logout } = useAuth();
  const [dark, setDark] = useState(true);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  };

  if (loading)
    return (
      <div className="grid min-h-screen place-items-center bg-background text-muted-foreground">
        <span className="text-xs">Loading…</span>
      </div>
    );

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-muted/40 to-transparent"
      />
      <Header
        authed={!!user}
        isAdmin={user?.role === "admin"}
        displayName={user?.displayName}
        dark={dark}
        onToggleTheme={toggleTheme}
        onLogout={logout}
      />
      {!user ? (
        <main className="container relative z-10 max-w-3xl py-6">
          <LoginScreen />
        </main>
      ) : (
        <Workspace isAdmin={user.role === "admin"} />
      )}
    </div>
  );
}

function Header(props: {
  authed: boolean;
  isAdmin: boolean;
  displayName?: string;
  dark: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur">
      <div className="container flex h-12 items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <PenLine className="size-3.5" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Nightwriter</span>
        </div>
        <div className="flex items-center gap-2">
          {props.authed && props.displayName && (
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              {props.displayName}
            </span>
          )}
          {props.authed && (
            <Button
              size="sm"
              variant="ghost"
              onClick={props.onLogout}
              aria-label="Log out"
            >
              <LogOut />
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={props.onToggleTheme}
            aria-label="Toggle theme"
          >
            {props.dark ? <Sun /> : <Moon />}
          </Button>
        </div>
      </div>
    </header>
  );
}

function Workspace({ isAdmin }: { isAdmin: boolean }) {
  const [view, setView] = useState<View>("generate");

  const nav: { id: View; label: string; icon: ReactNode; show: boolean }[] = [
    { id: "generate", label: "Generate", icon: <Sparkles className="size-3.5" />, show: true },
    { id: "history", label: "History", icon: <FileClock className="size-3.5" />, show: true },
    { id: "admin", label: "Admin", icon: <Users className="size-3.5" />, show: isAdmin },
  ];

  return (
    <main className="container relative z-10 max-w-3xl space-y-5 py-6">
      <nav className="flex flex-wrap gap-1">
        {nav
          .filter((n) => n.show)
          .map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setView(n.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors",
                view === n.id
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {n.icon}
              {n.label}
            </button>
          ))}
      </nav>

      {view === "generate" && <Generator />}
      {view === "history" && <HistoryPanel />}
      {view === "admin" && isAdmin && <AdminPage />}

      <footer className="pt-2 text-center text-[11px] text-muted-foreground">
        Definitions are produced by a real CLI subprocess in an isolated,
        path-guarded workspace.
      </footer>
    </main>
  );
}

function Generator() {
  const [run, setRun] = useState<RunState | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const closeRef = useRef<(() => void) | null>(null);

  const handleSubmit = useCallback(async (req: GenerateRequest) => {
    setSubmitError(null);
    try {
      const { jobId } = await startGeneration(req);
      setRun({ jobId, state: "queued", stage: "queued", logs: [] });
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
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const handleCancel = useCallback(() => {
    if (run) void cancelJob(run.jobId);
  }, [run]);

  const handleReset = useCallback(() => {
    closeRef.current?.();
    closeRef.current = null;
    setRun(null);
    setSubmitError(null);
  }, []);

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
      />
    );

  return (
    <div className="space-y-4">
      <Hero />
      <PromptForm disabled={false} onSubmit={handleSubmit} />
      {submitError && <p className="text-xs text-destructive">{submitError}</p>}
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
