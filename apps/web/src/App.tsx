import { useCallback, useRef, useState } from "react";
import {
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
} from "@nightwriter/shared";
import { Button } from "@/components/ui/button";
import { PromptForm } from "@/components/PromptForm";
import { RunView } from "@/components/RunView";
import { cancelJob, startGeneration, streamJob } from "@/lib/api";

interface RunState {
  jobId: string;
  state: JobState;
  stage: JobStage;
  logs: LogEvent[];
  done?: DoneEvent;
  error?: GenErrorEvent;
}

export default function App() {
  const [run, setRun] = useState<RunState | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [dark, setDark] = useState(true);
  const closeRef = useRef<(() => void) | null>(null);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  };

  const handleSubmit = useCallback(async (req: GenerateRequest) => {
    setSubmitError(null);
    try {
      const { jobId } = await startGeneration(req);
      setRun({ jobId, state: "queued", stage: "queued", logs: [] });
      closeRef.current = streamJob(jobId, {
        onStatus: (e) =>
          setRun((r) =>
            r ? { ...r, state: e.state, stage: e.stage } : r,
          ),
        onLog: (e) =>
          setRun((r) => (r ? { ...r, logs: [...r.logs, e] } : r)),
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
                  error: {
                    code: "internal",
                    message: "Lost connection to the server.",
                  },
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

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      {/* subtle top wash for depth — token-based, light/dark safe */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-muted/40 to-transparent"
      />

      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur">
        <div className="container flex h-12 items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <PenLine className="size-3.5" />
            </span>
            <span className="text-sm font-semibold tracking-tight">
              Nightwriter
            </span>
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              agent definition generator
            </span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={toggleTheme}
            aria-label="Toggle theme"
          >
            {dark ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>

      <main className="container relative z-10 max-w-3xl space-y-6 py-10">
        {!run && <Hero />}

        {!run && (
          <>
            <PromptForm disabled={false} onSubmit={handleSubmit} />
            {submitError && (
              <p className="text-xs text-destructive">{submitError}</p>
            )}
          </>
        )}

        {run && (
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
        )}

        <footer className="pt-2 text-center text-[11px] text-muted-foreground">
          Definitions are produced by a real CLI subprocess in an isolated,
          path-guarded workspace.
        </footer>
      </main>
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
