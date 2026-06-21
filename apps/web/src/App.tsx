import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  FileClock,
  LogOut,
  Menu,
  Moon,
  PackageOpen,
  PanelLeft,
  PanelLeftClose,
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
  PublicUser,
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

  if (!user)
    return (
      <div className="relative min-h-screen bg-background text-foreground">
        <BackgroundGlow />
        <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur">
          <div className="container flex h-12 items-center justify-between">
            <Brand />
            <Button size="sm" variant="ghost" onClick={toggleTheme} aria-label="Toggle theme">
              {dark ? <Sun /> : <Moon />}
            </Button>
          </div>
        </header>
        <main className="container relative z-10 max-w-3xl py-6">
          <LoginScreen />
        </main>
      </div>
    );

  return (
    <AppShell user={user} dark={dark} onToggleTheme={toggleTheme} onLogout={logout} />
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
  icon: ReactNode;
  show: boolean;
}

function AppShell(props: {
  user: PublicUser;
  dark: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  const { user, dark, onToggleTheme, onLogout } = props;
  const [view, setView] = useState<View>("generate");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("nw_sidebar_collapsed") === "1",
  );

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("nw_sidebar_collapsed", next ? "1" : "0");
      return next;
    });

  const nav: NavItem[] = [
    { id: "generate", label: "Generate", icon: <Sparkles className="size-4" />, show: true },
    { id: "history", label: "History", icon: <FileClock className="size-4" />, show: true },
    { id: "admin", label: "Admin", icon: <Users className="size-4" />, show: user.role === "admin" },
  ];

  const select = (v: View) => {
    setView(v);
    setDrawerOpen(false);
  };

  const sidebar = (
    extra: string,
    opts?: { collapsed?: boolean; onToggleCollapse?: () => void },
  ) => (
    <Sidebar
      className={extra}
      nav={nav}
      view={view}
      onSelect={select}
      user={user}
      dark={dark}
      onToggleTheme={onToggleTheme}
      onLogout={onLogout}
      collapsed={opts?.collapsed}
      onToggleCollapse={opts?.onToggleCollapse}
    />
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      {sidebar("hidden md:flex md:sticky md:top-0 md:h-screen", {
        collapsed,
        onToggleCollapse: toggleCollapsed,
      })}

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/50 duration-200 animate-in fade-in"
            onClick={() => setDrawerOpen(false)}
          />
          {sidebar(
            "absolute inset-y-0 left-0 w-64 bg-background shadow-xl duration-200 animate-in slide-in-from-left",
          )}
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur md:hidden">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
          >
            <Menu />
          </Button>
          <Brand />
        </header>

        <main className="relative flex-1">
          <BackgroundGlow />
          <div className="container relative z-10 max-w-3xl space-y-5 py-6">
            {view === "generate" && <Generator />}
            {view === "history" && <HistoryPanel />}
            {view === "admin" && user.role === "admin" && <AdminPage />}
            <footer className="pt-2 text-center text-[11px] text-muted-foreground">
              Definitions are produced by a real CLI subprocess in an isolated,
              path-guarded workspace.
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

function Sidebar(props: {
  className?: string;
  nav: NavItem[];
  view: View;
  onSelect: (v: View) => void;
  user: PublicUser;
  dark: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const {
    className,
    nav,
    view,
    onSelect,
    user,
    dark,
    onToggleTheme,
    onLogout,
    collapsed = false,
    onToggleCollapse,
  } = props;

  return (
    <aside
      className={cn(
        "z-50 flex flex-col border-r border-border bg-card/30 transition-[width]",
        collapsed ? "w-14" : "w-56",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-12 shrink-0 items-center gap-2 border-b border-border px-3",
          collapsed && "justify-center",
        )}
      >
        {!collapsed && <Brand />}
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
              !collapsed && "ml-auto",
            )}
          >
            {collapsed ? (
              <PanelLeft className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {nav
          .filter((n) => n.show)
          .map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onSelect(n.id)}
              title={collapsed ? n.label : undefined}
              className={cn(
                "flex w-full items-center rounded-md py-2 text-xs transition-colors",
                collapsed ? "justify-center px-0" : "gap-2.5 px-3",
                view === n.id
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {n.icon}
              {!collapsed && n.label}
            </button>
          ))}
      </nav>

      <div
        className={cn("space-y-2 border-t border-border", collapsed ? "p-2" : "p-3")}
      >
        {!collapsed && (
          <div className="px-1">
            <div className="truncate text-xs font-medium">
              {user.displayName}
            </div>
            <div className="text-[11px] capitalize text-muted-foreground">
              {user.role}
            </div>
          </div>
        )}
        <div className={cn("flex gap-1", collapsed && "flex-col")}>
          <Button
            size="sm"
            variant="ghost"
            className={cn(collapsed ? "justify-center px-0" : "flex-1 justify-start")}
            onClick={onToggleTheme}
            title="Toggle theme"
          >
            {dark ? <Sun /> : <Moon />}
            {!collapsed && "Theme"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={cn(collapsed ? "justify-center px-0" : "flex-1 justify-start")}
            onClick={onLogout}
            title="Log out"
          >
            <LogOut />
            {!collapsed && "Logout"}
          </Button>
        </div>
      </div>
    </aside>
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
