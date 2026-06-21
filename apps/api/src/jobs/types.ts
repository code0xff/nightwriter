import type {
  GenerateErrorCode,
  GeneratorSelection,
  JobStage,
  JobState,
  LogLevel,
  Target,
} from "@nightwriter/shared";

/** A buffered SSE frame, replayed to late subscribers. */
export interface BufferedEvent {
  id: number;
  event: "status" | "log" | "done" | "error";
  data: unknown;
}

export interface JobRecord {
  id: string;
  /** Authenticated user the generation is attributed to. */
  ownerId: string;
  state: JobState;
  stage: JobStage;
  prompt: string;
  slug: string;
  generator: GeneratorSelection;
  target: Target;
  model: string;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  error?: string;
  errorCode?: GenerateErrorCode;
  files: string[];
  definition?: string;
  definitionFile?: string;
  workDir: string;
  outDir: string;
  zipPath: string;
  downloadReady: boolean;
}

/** Error carrying a client-facing code, thrown by the runner. */
export class GenerateError extends Error {
  constructor(
    readonly code: GenerateErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GenerateError";
  }
}

/** Side-channel the runner uses to report progress back to the store. */
export interface JobSink {
  readonly signal: AbortSignal;
  setSlug(slug: string): void;
  setStage(stage: JobStage, message?: string): void;
  log(level: LogLevel, line: string): void;
}

export interface RunnerResult {
  files: string[];
  /** The primary generated definition text (e.g. agent.md contents). */
  definition: string;
  /** Root filename of the definition (e.g. "agent.md"). */
  definitionFile: string;
}

/** The work function that turns a job into artifacts. */
export type JobRunner = (
  job: JobRecord,
  sink: JobSink,
) => Promise<RunnerResult>;
