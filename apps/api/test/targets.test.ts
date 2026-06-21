import { describe, expect, it } from "vitest";
import { getTargetPlugin } from "../src/targets/index.js";
import { stripCodeFence } from "../src/targets/types.js";

describe("stripCodeFence", () => {
  it("removes a surrounding fence", () => {
    expect(stripCodeFence("```md\nhello\n```")).toBe("hello");
  });
  it("leaves unfenced content untouched", () => {
    expect(stripCodeFence("  hello\nworld  ")).toBe("hello\nworld");
  });
  it("keeps inner fences", () => {
    const input = "```\nbefore\n```inner```\nafter\n```";
    expect(stripCodeFence(input)).toContain("inner");
  });
});

const ctx = {
  slug: "my-agent",
  userPrompt: "build a code reviewer",
  generatorCli: "claude" as const,
  model: "claude-sonnet-4-6",
};

describe("claude target", () => {
  const plugin = getTargetPlugin("claude");
  it("writes the definition under .claude/agents and includes install + readme", () => {
    const files = plugin.buildArtifacts("```\nDEF\n```", ctx);
    const paths = files.map((f) => f.path);
    expect(paths).toContain(".claude/agents/my-agent.md");
    expect(paths).toContain("install.sh");
    expect(paths).toContain("README.md");
    const install = files.find((f) => f.path === "install.sh")!;
    expect(install.mode).toBe(0o755);
    expect(install.content.startsWith("#!/usr/bin/env bash")).toBe(true);
  });
});

describe("adk target", () => {
  const plugin = getTargetPlugin("adk");
  it("produces a python package with __init__ and requirements", () => {
    const files = plugin.buildArtifacts("root_agent = None", ctx);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("my_agent/agent.py");
    expect(paths).toContain("my_agent/__init__.py");
    expect(paths).toContain("requirements.txt");
  });
});

describe("generation prompt", () => {
  it("embeds the user prompt and format instructions", () => {
    const prompt = getTargetPlugin("hermes").buildGenerationPrompt(
      "make a yaml agent",
      "x",
    );
    expect(prompt).toContain("make a yaml agent");
    expect(prompt).toContain("YAML");
  });
});
