# CLAUDE.md — Nightwriter

Operational guide for Claude Code working in this repo. Read this first.

## What this is

Nightwriter turns a natural-language prompt into a **runtime-ready agent
definition + install script**, packaged as a downloadable zip. The backend runs
a real LLM CLI (`claude -p`, `codex exec`) as a **non-interactive subprocess**,
streams progress over **SSE**, and zips the result. Core work is "spawn a local
CLI binary", so it requires a **resident Node server** (no edge/serverless).

Target users: developers who want to quickly define, generate, and install agents
for several runtimes (Claude / Codex / OpenClaw / Hermes / ADK).

## Architecture

```
[browser] prompt + options ──POST /api/generate──▶ jobId
[Fastify] job → spawn(claude -p / codex exec) in an isolated tmp dir
          stdout / stage events ──SSE──▶ live progress
          artifacts + install.sh ──archiver──▶ artifact.zip
[browser] GET /download ──▶ zip + activation guide
```

## Layout (pnpm workspace monorepo)

- `packages/shared` — `@nightwriter/shared`: API contract types shared by both
  apps. **Dependency-free.** Must be **built** (`dist/`) before api/web typecheck
  or test resolve it.
- `apps/api` — Fastify backend (TypeScript, ESM/NodeNext).
  - `src/adapters/` — CLI adapter abstraction (`claude`, `codex`). One place to
    change CLI flags / add a new generator.
  - `src/targets/` — target packagers. `specs.ts` holds the 5 declarative
    `TargetSpec`s; `factory.ts` expands each into a plugin. **Add a runtime here.**
  - `src/jobs/` — in-memory job store (concurrency queue, SSE event buffering +
    replay, TTL cleanup).
  - `src/generate/` — `spawn.ts` (subprocess + error mapping) and `runner.ts`
    (prompt → spawn → parse → zip).
  - `src/routes/` — HTTP + SSE endpoints; `validate.ts` validates request bodies.
  - `src/util/` — `logger.ts` (secret masking), `sse.ts`, `tmp.ts` (path-guard),
    `ids.ts`.
  - `app.ts` builds the Fastify instance + store (used by tests); `index.ts` listens.
  - `test/` — vitest; `fixtures/fake-cli.mjs` is a deterministic stand-in CLI.
- `apps/web` — Vite + React + TS + Tailwind + shadcn/ui frontend. Uses the house
  design system (compact, neutral, dark-ready; Pretendard / JetBrains Mono;
  `success`/`warning`/`info` tokens). `src/lib/api.ts` = client + SSE.

## Dev environment quirks (important)

- **Node is NOT on the default PATH here.** Node 24.16.0 lives under nvm. Prefix
  shell commands with:
  `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"`
- pnpm (11.8.0) comes from `corepack enable`. **pnpm 11 requires Node ≥ 22.13.**
- esbuild's build script must be approved — `pnpm-workspace.yaml` has
  `allowBuilds.esbuild: true` and `onlyBuiltDependencies: [esbuild]`. Don't revert.

## Commands

```bash
pnpm install
pnpm --filter @nightwriter/shared build   # build shared types once (required)
pnpm dev                                   # api :8787 + web :5173
pnpm --filter @nightwriter/api test        # vitest (uses fake-cli fixture)
pnpm verify                                # full CI-equivalent gate locally
```

## Rules / conventions

- **Pre-push gate (do not break):** a git `pre-push` hook (`.githooks/pre-push`
  → `scripts/ci-check.sh`) runs the same checks as CI (install → build shared →
  typecheck → test → build web) before every push, so a push can't fail GitHub
  Actions. Enabled via `core.hooksPath=.githooks`, set by the root `prepare`
  script on `pnpm install`. Run `pnpm verify` before pushing; only bypass with
  `git push --no-verify` in a real emergency. **If you add a new check to CI,
  add it to `scripts/ci-check.sh` too** (keep them mirrored).
- **Branches:** default branch is **`dev`**. `master` was removed — do not
  recreate it. Branch off `dev` for new work.
- **Commits:** Conventional Commits, **English**, `type(scope): message`
  (e.g. `feat(api): …`, `fix: …`, `ci: …`, `docs: …`, `chore(web): …`). Commit
  per feature unit after the gate passes. End each commit message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **CI:** `.github/workflows/ci.yml`, triggers on push/PR to `dev`, Node 22.
- **Security (must preserve):** spawn CLIs with array argv (`spawn(cmd, [args])`)
  — never a shell, no string interpolation of prompts. Write artifacts only
  inside the per-job tmp dir (paths traversal-guarded in `util/tmp.ts`).
  Subprocesses are time-limited and cancelable. Mask secrets in any logged/streamed
  text (`util/logger.ts`).

## CLI integration notes (verified)

- `claude` 2.x: `claude -p --output-format text --model <m>`, prompt via **stdin**,
  clean text on stdout. Works non-interactively without auth prompts here.
- `codex` 0.14x: `codex exec --model <m> -` (stdin). Output is clean on **stdout**;
  session metadata goes to stderr.
- **Model ids matter per account:** on a ChatGPT-account codex, `gpt-5.4-codex` /
  `gpt-5-codex` are rejected (400). Use **`gpt-5.5`** (the account default).
  Codex adapter `defaultModel` and the web catalog reflect this.
- Generators can write whatever the prompt asks; the pipeline captures stdout,
  strips a wrapping code fence (`targets/types.ts:stripCodeFence`), and packages it.

## API contract

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/generate` | `{ prompt, generator:{cli,model?}, target }` → `{ jobId }` (202) |
| GET | `/api/generate/:jobId/events` | SSE: `status` / `log` / `done` / `error` |
| GET | `/api/generate/:jobId/download` | `application/zip` |
| GET | `/api/generate/:jobId` | status snapshot (polling fallback) |
| POST | `/api/generate/:jobId/cancel` | cancel a queued/running job |

`generator.cli`: `claude | codex`. `target`: `claude | codex | openclaw | hermes | adk`.
SSE error codes: `cli_not_found | cli_failed | timeout | canceled | packaging_failed | internal`.

## Extending

- **New target runtime:** add a `TargetSpec` to `apps/api/src/targets/specs.ts`
  (format instructions, definition path, install script, activation guide,
  optional extra files) and the `Target` union in `packages/shared`, plus a
  `TargetOption` in `apps/web/src/lib/catalog.ts`. Rebuild shared.
- **New generator CLI:** add an adapter in `apps/api/src/adapters/`, register it
  in `adapters/index.ts`, extend the `GeneratorCli` union in shared, add a
  `GeneratorOption` in the web catalog.

See `README.md` for the full run/config/env reference.
