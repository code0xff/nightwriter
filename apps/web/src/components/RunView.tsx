import { useEffect, useRef } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";
import type {
  DoneEvent,
  ErrorEvent as GenErrorEvent,
  JobStage,
  JobState,
  LogEvent,
} from "@nightwriter/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { downloadUrl } from "@/lib/api";
import { STAGE_FLOW, stageIndex, stageProgress } from "@/lib/stages";

interface Props {
  jobId: string;
  state: JobState;
  stage: JobStage;
  logs: LogEvent[];
  done?: DoneEvent;
  error?: GenErrorEvent;
  onCancel: () => void;
  onReset: () => void;
}

export function RunView(props: Props) {
  const { jobId, state, stage, logs, done, error, onCancel, onReset } = props;
  const active = state === "queued" || state === "running";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-col items-start gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            {active && (
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-warning opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-warning" />
              </span>
            )}
            <CardTitle className="text-sm">Generation</CardTitle>
            <StateBadge state={state} />
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            {active ? (
              <Button size="sm" variant="outline" onClick={onCancel}>
                <X />
                Cancel
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={onReset}>
                <RotateCcw />
                New
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Stepper stage={stage} state={state} />
          <ProgressBar active={active} state={state} stage={stage} />
          <LogConsole logs={logs} />
        </CardContent>
      </Card>

      {error && (
        <Alert
          variant="destructive"
          className="duration-300 animate-in fade-in slide-in-from-bottom-2"
        >
          <AlertCircle />
          <AlertTitle>
            Generation failed
            <span className="ml-2 font-mono text-[11px] opacity-70">
              {error.code}
            </span>
          </AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {done && <ResultCard jobId={jobId} done={done} />}
    </div>
  );
}

function StateBadge({ state }: { state: JobState }) {
  const map: Record<JobState, { variant: string; label: string }> = {
    queued: { variant: "info", label: "Queued" },
    running: { variant: "warning", label: "Running" },
    succeeded: { variant: "success", label: "Succeeded" },
    failed: { variant: "destructive", label: "Failed" },
    canceled: { variant: "secondary", label: "Canceled" },
  };
  const { variant, label } = map[state];
  const pulsing = state === "queued" || state === "running";
  return (
    <Badge variant={variant as never} className={cn(pulsing && "animate-pulse")}>
      {label}
    </Badge>
  );
}

function ProgressBar({
  active,
  state,
  stage,
}: {
  active: boolean;
  state: JobState;
  stage: JobStage;
}) {
  // While running, show an indeterminate moving bar; on finish, a solid bar.
  if (active) {
    return (
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
        <span className="nw-progress-indeterminate" />
      </div>
    );
  }
  const tone =
    state === "succeeded"
      ? "bg-success"
      : state === "failed" || state === "canceled"
        ? "bg-destructive"
        : "bg-primary";
  return <Progress value={stageProgress(stage)} indicatorClassName={tone} />;
}

function Stepper({ stage, state }: { stage: JobStage; state: JobState }) {
  const current = stageIndex(stage);
  const isError = state === "failed" || state === "canceled";
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {STAGE_FLOW.map((s, i) => {
        const reached = i <= current && !isError;
        const isCurrent = i === current && (state === "running" || state === "queued");
        const completed = state === "succeeded" || i < current;
        return (
          <li key={s.id} className="flex items-center gap-2">
            <span
              className={cn(
                "flex items-center gap-1.5",
                reached ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {isCurrent ? (
                <Loader2 className="size-3.5 animate-spin text-warning" />
              ) : completed ? (
                <CheckCircle2 className="size-3.5 text-success" />
              ) : (
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    reached ? "bg-foreground" : "bg-muted-foreground/40",
                  )}
                />
              )}
              {s.label}
            </span>
            {i < STAGE_FLOW.length - 1 && (
              <span className="text-muted-foreground/40">/</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function LogConsole({ logs }: { logs: LogEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [logs.length]);

  if (logs.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground">
        Waiting for output…
      </div>
    );
  }
  return (
    <div
      ref={ref}
      className="max-h-56 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed"
    >
      {logs.map((l, i) => (
        <div
          key={i}
          className={cn(
            "whitespace-pre-wrap break-words duration-200 animate-in fade-in slide-in-from-bottom-1",
            l.level === "error" && "text-destructive",
            l.level === "warn" && "text-warning",
          )}
        >
          {l.line}
        </div>
      ))}
    </div>
  );
}

function ResultCard({ jobId, done }: { jobId: string; done: DoneEvent }) {
  return (
    <Card className="duration-300 animate-in fade-in slide-in-from-bottom-2">
      <CardHeader className="flex-col items-start gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-4 text-success" />
          <CardTitle className="text-sm">Artifact ready</CardTitle>
        </div>
        <Button asChild size="sm" className="w-full sm:w-auto">
          <a href={downloadUrl(jobId)} download>
            <Download />
            Download zip
          </a>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Files
          </div>
          <ul className="space-y-1">
            {done.files.map((f) => (
              <li
                key={f}
                className="flex items-start gap-2 font-mono text-xs"
              >
                <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 break-all">{f}</span>
              </li>
            ))}
          </ul>
        </div>
        <Separator />
        <div className="text-[11px] text-muted-foreground">
          Unzip the archive and run{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
            bash install.sh
          </code>
          . See <span className="font-mono">README.md</span> in the archive for
          target-specific activation steps.
        </div>
      </CardContent>
    </Card>
  );
}
