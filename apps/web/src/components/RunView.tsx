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
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm">Generation</CardTitle>
            <StateBadge state={state} />
          </div>
          <div className="flex items-center gap-2">
            {active && (
              <Button size="sm" variant="outline" onClick={onCancel}>
                <X />
                Cancel
              </Button>
            )}
            {!active && (
              <Button size="sm" variant="outline" onClick={onReset}>
                <RotateCcw />
                New
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Stepper stage={stage} state={state} />
          <Progress value={stageProgress(stage)} />
          <LogConsole logs={logs} />
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
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
  return <Badge variant={variant as never}>{label}</Badge>;
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
            "whitespace-pre-wrap break-words",
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
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="size-4 text-success" />
          <CardTitle className="text-sm">Artifact ready</CardTitle>
        </div>
        <Button asChild size="sm">
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
              <li key={f} className="flex items-center gap-2 font-mono text-xs">
                <FileText className="size-3.5 text-muted-foreground" />
                {f}
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
