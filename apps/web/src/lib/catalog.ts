import type { GeneratorCli, Target } from "@nightwriter/shared";

export interface ModelOption {
  id: string;
  label: string;
}

export interface GeneratorOption {
  id: GeneratorCli;
  label: string;
  command: string;
  models: ModelOption[];
}

export const GENERATORS: GeneratorOption[] = [
  {
    id: "claude",
    label: "Claude Code",
    command: "claude -p",
    models: [
      { id: "claude-opus-4-8", label: "Opus 4.8" },
      { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
      { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
    ],
  },
  {
    id: "codex",
    label: "Codex CLI",
    command: "codex exec",
    models: [
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.5-codex", label: "GPT-5.5 Codex" },
    ],
  },
];

export interface TargetOption {
  id: Target;
  label: string;
  description: string;
}

export const TARGET_OPTIONS: TargetOption[] = [
  {
    id: "claude",
    label: "Claude Code",
    description: "Subagent markdown under .claude/agents/",
  },
  {
    id: "codex",
    label: "Codex",
    description: "TOML subagent under .codex/agents/",
  },
  {
    id: "openclaw",
    label: "OpenClaw",
    description: "Agent workspace (AGENTS.md, SOUL.md, skills/…)",
  },
  {
    id: "hermes",
    label: "Hermes Agent",
    description: "SKILL.md skill under ~/.hermes/skills/",
  },
  {
    id: "adk",
    label: "Google ADK",
    description: "Python package exporting root_agent",
  },
];

export function generatorById(id: GeneratorCli): GeneratorOption {
  return GENERATORS.find((g) => g.id === id) ?? GENERATORS[0]!;
}
