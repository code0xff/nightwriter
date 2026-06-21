import type { JobStage } from "@nightwriter/shared";

export interface StageMeta {
  id: JobStage;
  label: string;
}

/** Ordered pipeline stages shown in the stepper (error is rendered separately). */
export const STAGE_FLOW: StageMeta[] = [
  { id: "queued", label: "Queued" },
  { id: "preparing", label: "Preparing" },
  { id: "generating", label: "Generating" },
  { id: "packaging", label: "Packaging" },
  { id: "ready", label: "Ready" },
];

export function stageIndex(stage: JobStage): number {
  const i = STAGE_FLOW.findIndex((s) => s.id === stage);
  return i < 0 ? 0 : i;
}

export function stageProgress(stage: JobStage): number {
  if (stage === "error") return 100;
  return Math.round(((stageIndex(stage) + 1) / STAGE_FLOW.length) * 100);
}
