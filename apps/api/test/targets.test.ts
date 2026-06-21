import { describe, expect, it } from "vitest";
import { getTargetPlugin } from "../src/targets/index.js";
import { safeZipPath } from "../src/targets/factory.js";
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
  it("puts a visible agent.md at the root plus install + readme", () => {
    const files = plugin.buildArtifacts("```\nDEF\n```", ctx);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("agent.md");
    expect(paths).toContain("install.sh");
    expect(paths).toContain("README.md");
    const install = files.find((f) => f.path === "install.sh")!;
    expect(install.mode).toBe(0o755);
    expect(install.content.startsWith("#!/usr/bin/env bash")).toBe(true);
    // install.sh copies the root agent.md into the runtime location
    expect(install.content).toContain('cp "$HERE/agent.md"');
    expect(install.content).toContain(".claude/agents");
  });
});

describe("adk target", () => {
  const plugin = getTargetPlugin("adk");
  it("puts a visible agent.py + requirements at the root; install builds the package", () => {
    const files = plugin.buildArtifacts("root_agent = None", ctx);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("agent.py");
    expect(paths).toContain("requirements.txt");
    expect(paths).toContain("install.sh");
    const install = files.find((f) => f.path === "install.sh")!;
    expect(install.content).toContain("__init__.py");
    expect(install.content).toContain("my_agent");
  });
});

describe("codex target", () => {
  it("emits a TOML subagent at the root + installs into .codex/agents", () => {
    const files = getTargetPlugin("codex").buildArtifacts('name = "x"', ctx);
    expect(files.map((f) => f.path)).toContain("agent.toml");
    const install = files.find((f) => f.path === "install.sh")!;
    expect(install.content).toContain(".codex/agents");
    expect(install.content).toContain('cp "$HERE/agent.toml"');
  });
});

describe("hermes target", () => {
  it("emits a SKILL.md at the root + installs into ~/.hermes/skills", () => {
    const files = getTargetPlugin("hermes").buildArtifacts(
      "---\nname: x\n---\nbody",
      ctx,
    );
    expect(files.map((f) => f.path)).toContain("SKILL.md");
    expect(files.find((f) => f.path === "install.sh")!.content).toContain(
      ".hermes/skills",
    );
  });
});

describe("openclaw target", () => {
  const oc = getTargetPlugin("openclaw");
  it("splits a delimited workspace into multiple files", () => {
    const raw = [
      "===== FILE: AGENTS.md =====",
      "mission",
      "===== FILE: SOUL.md =====",
      "persona",
      "===== FILE: skills/x/SKILL.md =====",
      "---\nname: x\n---\nbody",
    ].join("\n");
    const paths = oc.buildArtifacts(raw, ctx).map((f) => f.path);
    expect(paths).toContain("workspace/AGENTS.md");
    expect(paths).toContain("workspace/SOUL.md");
    expect(paths).toContain("workspace/skills/x/SKILL.md");
    expect(paths).toContain("install.sh");
  });
  it("falls back to a single AGENTS.md when there are no delimiters", () => {
    expect(oc.buildArtifacts("just text", ctx).map((f) => f.path)).toContain(
      "workspace/AGENTS.md",
    );
  });
  it("sanitizes path traversal in generated file paths (zip-slip safe)", () => {
    const files = oc.buildArtifacts(
      "===== FILE: ../../etc/passwd =====\npwned",
      ctx,
    );
    expect(files.every((f) => !f.path.includes(".."))).toBe(true);
    expect(files.some((f) => f.path.startsWith("workspace/"))).toBe(true);
  });
  it("de-duplicates colliding generated file paths", () => {
    const raw = "===== FILE: dup.md =====\nfirst\n===== FILE: dup.md =====\nsecond";
    const paths = oc.buildArtifacts(raw, ctx).map((f) => f.path);
    expect(paths).toContain("workspace/dup.md");
    expect(paths).toContain("workspace/dup-2.md");
  });
});

describe("safeZipPath", () => {
  it("strips traversal, leading slashes, and unsafe chars", () => {
    expect(safeZipPath("../../etc/passwd", "fb")).toBe("etc/passwd");
    expect(safeZipPath("/abs/path", "fb")).toBe("abs/path");
    expect(safeZipPath("a/b/../c", "fb")).toBe("a/b/c");
    expect(safeZipPath("", "fb")).toBe("fb");
    expect(safeZipPath("weird name!.md", "fb")).toBe("weird_name_.md");
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
