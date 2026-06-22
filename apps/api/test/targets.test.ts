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
    expect(install.content).toContain('install_file "$HERE/agent.md"');
    expect(install.content).toContain(".claude/agents");
    // robustness: guarded copy helper (source check + overwrite notice)
    expect(install.content).toContain("install_file()");
    expect(install.content).toContain("overwriting existing");
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
    expect(install.content).toContain('install_file "$HERE/agent.toml"');
  });
});

describe("name normalization (slug ↔ invocation identifier)", () => {
  it("pins the claude frontmatter name to the slug", () => {
    const def = getTargetPlugin("claude")
      .buildArtifacts(
        "---\nname: code-review-fixer\ndescription: x\n---\nbody",
        ctx,
      )
      .find((f) => f.path === "agent.md")!;
    expect(def.content).toContain("name: my-agent");
    expect(def.content).not.toContain("code-review-fixer");
  });
  it("pins the codex toml name to the slug", () => {
    const def = getTargetPlugin("codex")
      .buildArtifacts('name = "whatever"\ndescription = "x"', ctx)
      .find((f) => f.path === "agent.toml")!;
    expect(def.content).toContain('name = "my-agent"');
  });
  it("pins the adk root_agent name to the snake_case slug", () => {
    const def = getTargetPlugin("adk")
      .buildArtifacts('root_agent = Agent(name="foo", model="m")', ctx)
      .find((f) => f.path === "agent.py")!;
    expect(def.content).toContain('name="my_agent"');
  });
  it("does not rewrite a name= that precedes root_agent", () => {
    const def = getTargetPlugin("adk")
      .buildArtifacts(
        'def my_tool(name="keep"):\n    pass\n\nroot_agent = Agent(name="foo")',
        ctx,
      )
      .find((f) => f.path === "agent.py")!;
    expect(def.content).toContain('name="keep"');
    expect(def.content).toContain('name="my_agent"');
  });
  it("produces a valid python identifier (and matching pkg) for digit-leading slugs", () => {
    const files = getTargetPlugin("adk").buildArtifacts(
      'root_agent = Agent(name="x")',
      { ...ctx, slug: "2fa-agent" },
    );
    const def = files.find((f) => f.path === "agent.py")!;
    const install = files.find((f) => f.path === "install.sh")!;
    expect(def.content).toContain('name="_2fa_agent"');
    expect(install.content).toContain('PKG="_2fa_agent"');
  });
  it("avoids python keywords / reserved 'user' in adk names", () => {
    const def = getTargetPlugin("adk")
      .buildArtifacts('root_agent = Agent(name="x")', { ...ctx, slug: "user" })
      .find((f) => f.path === "agent.py")!;
    expect(def.content).toContain('name="_user"');
  });
  it("never corrupts a nested name= when the agent name is not the first arg", () => {
    // name is not Agent's first kwarg here, so we safely no-op rather than
    // rewrite the tool's name=.
    const src =
      'root_agent = Agent(\n    tools=[Tool(name="search")],\n    name="foo",\n)';
    const def = getTargetPlugin("adk")
      .buildArtifacts(src, ctx)
      .find((f) => f.path === "agent.py")!;
    expect(def.content).toContain('name="search"');
    expect(def.content).toContain('name="foo"');
    expect(def.content).not.toContain("my_agent");
  });
  it("leaves a definition without a name field untouched", () => {
    const def = getTargetPlugin("claude")
      .buildArtifacts("no frontmatter here", ctx)
      .find((f) => f.path === "agent.md")!;
    expect(def.content).toContain("no frontmatter here");
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
