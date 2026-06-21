# Nightwriter

Turn a natural-language prompt into a **runtime-ready agent definition + install
script**, packaged as a downloadable zip. The backend runs a real LLM CLI
(`claude -p`, `codex exec`) as a non-interactive subprocess, streams progress over
SSE, and zips the result.

```
[browser] prompt + options ──POST /api/generate──▶ jobId
[Fastify] job → spawn(claude -p / codex exec) in isolated tmp dir
          stdout / stage events ──SSE──▶ live progress
          artifacts + install.sh ──archiver──▶ artifact.zip
[browser] GET /download ──▶ zip + activation guide
```

## Layout

- `apps/api` — Fastify backend: job store (in-memory, concurrency-limited queue),
  CLI adapters, target packagers, SSE, zip, TTL cleanup.
- `apps/web` — Vite + React + Tailwind + shadcn/ui frontend.
- `packages/shared` — API contract types shared by both.

The frontend uses the shared design system from
[code0xff/design](https://github.com/code0xff/design) — a compact, neutral,
dark-mode-ready dev-tool look (Pretendard / JetBrains Mono, `success`/`warning`/
`info` tokens). The `src/components/ui/*`, `tailwind.config.js`, `postcss.config.js`,
and `src/index.css` files originate from that repo.

## Develop

Node ≥ 22.13 (required by pnpm 11) and pnpm.

```bash
pnpm install
pnpm --filter @nightwriter/shared build   # build shared types once
pnpm dev                                   # api (:8787) + web (:5173) in parallel
```

The web dev server proxies `/api` to the API at `http://127.0.0.1:8787`.

To actually generate, the chosen CLI must be installed and on `PATH`
(`claude`, `codex`). Override binaries with `NIGHTWRITER_CLAUDE_BIN` /
`NIGHTWRITER_CODEX_BIN`.

## Test

```bash
pnpm --filter @nightwriter/api test    # vitest; uses a fake CLI fixture
```

## Pre-push gate

A git `pre-push` hook runs the **same checks as CI** (install → build shared →
typecheck → test → build web) so a push can't fail GitHub Actions. It's enabled
automatically: `pnpm install` runs a `prepare` script that points
`core.hooksPath` at `.githooks/`.

```bash
pnpm verify          # run the gate manually (scripts/ci-check.sh)
git push --no-verify # bypass the hook in an emergency
```

The hook falls back to the nvm-managed Node when `node`/`pnpm` aren't on PATH.

## API

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/generate` | `{ prompt, generator:{cli,model?}, target }` → `{ jobId }` |
| GET | `/api/generate/:jobId/events` | SSE: `status` / `log` / `done` / `error` |
| GET | `/api/generate/:jobId/download` | `application/zip` |
| GET | `/api/generate/:jobId` | status snapshot (polling fallback) |
| POST | `/api/generate/:jobId/cancel` | cancel a running/queued job |

`generator.cli`: `claude | codex`.
`target`: `claude | codex | openclaw | hermes | adk`.

## Config (env, API)

| Var | Default | |
|-----|---------|-|
| `PORT` | `8787` | |
| `HOST` | `127.0.0.1` | |
| `CORS_ORIGIN` | `*` | |
| `NIGHTWRITER_MAX_CONCURRENCY` | `2` | concurrent CLI subprocesses; excess queued |
| `NIGHTWRITER_JOB_TIMEOUT_MS` | `120000` | per-job subprocess timeout |
| `NIGHTWRITER_ARTIFACT_TTL_MS` | `1800000` | artifact lifetime before cleanup |
| `NIGHTWRITER_WORK_ROOT` | OS tmp | per-job isolated working dirs |
| `NIGHTWRITER_CLAUDE_BIN` / `NIGHTWRITER_CODEX_BIN` | `claude` / `codex` | CLI overrides |

## Security notes

- CLIs are spawned with array argv (`spawn(cmd, [args])`) — never through a
  shell, so prompts can't inject shell commands.
- Artifacts are written only inside a per-job tmp dir; paths are traversal-guarded.
- Subprocesses are time-limited and cancelable (SIGKILL).
- Log lines are masked for common secret patterns before streaming/logging.
