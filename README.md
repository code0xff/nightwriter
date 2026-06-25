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
pnpm dev                                   # api (:8787) + web (:5172) in parallel
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

## Auth & history

Access is gated. Users sign in with **either a password or a passkey** (WebAuthn)
— both methods are available on one login screen. New users **self-register**
(created `pending`) and must be **activated by an admin** before their first
sign-in; the admin account is seeded from env and is always active. After
sign-in the UI differs by role — admins additionally get the Admin page. Each
generation is **owned by its creator**; history is kept **permanently** and is
**re-downloadable and deletable by the owner**.

Storage goes through a **repository abstraction** (`src/db`): async
`UserRepository` / `HistoryRepository` / `SettingsRepository` interfaces with a
**SQLite** (`better-sqlite3`) backend today, switchable to Postgres via
`NIGHTWRITER_DB`. Zip artifacts live on the filesystem; only metadata is in the DB.

## API

All `/api/generate/*` and `/api/history/*` require a session token
(`Authorization: Bearer <token>`, or `?token=` for the SSE stream).

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/login` | username/password → `{ token, user }` |
| POST | `/api/auth/register` | password self-signup → pending user |
| POST | `/api/auth/passkey/register/start` · `/finish` | passkey self-signup → pending |
| POST | `/api/auth/passkey/login/start` · `/finish` | passkey sign-in |
| GET | `/api/auth/me` | current session user |
| GET | `/api/admin/users` | (admin) list users |
| POST | `/api/admin/users/:id/activate` · `/deactivate` | (admin) toggle access |
| POST | `/api/admin/password` | (admin) change password |
| POST | `/api/generate` | `{ prompt, generator:{cli,model?}, target }` → `{ jobId }` |
| GET | `/api/generate/:jobId/events` | SSE: `status` / `log` / `done` / `error` |
| GET | `/api/generate/:jobId/download` | `application/zip` |
| GET | `/api/generate/:jobId` | status snapshot (polling fallback) |
| POST | `/api/generate/:jobId/cancel` | cancel a running/queued job |
| GET | `/api/history` | the caller's past generations |
| GET | `/api/history/:id/download` | re-download a past artifact (owner only) |
| DELETE | `/api/history/:id` | delete a past generation (owner only) |

`generator.cli`: `claude | codex`.
`target`: `claude | codex | openclaw | hermes | adk`.

## Config (env, API)

| Var | Default | |
|-----|---------|-|
| `PORT` | `8787` | |
| `HOST` | `127.0.0.1` | bind address; set `0.0.0.0` to expose on the LAN (see note) |
| `CORS_ORIGIN` | `http://localhost:5172` | restrict who can drive local CLIs |
| `NIGHTWRITER_MAX_CONCURRENCY` | `2` | concurrent CLI subprocesses; excess queued |
| `NIGHTWRITER_JOB_TIMEOUT_MS` | `120000` | per-job subprocess timeout |
| `NIGHTWRITER_ARTIFACT_TTL_MS` | `1800000` | artifact lifetime before cleanup |
| `NIGHTWRITER_WORK_ROOT` | OS tmp | per-job isolated working dirs |
| `NIGHTWRITER_CLAUDE_BIN` / `NIGHTWRITER_CODEX_BIN` | `claude` / `codex` | CLI overrides |
| `NIGHTWRITER_DATA_ROOT` | `./data` | DB file + persisted zip artifacts |
| `NIGHTWRITER_DB` | `sqlite` | storage driver (`sqlite` \| `postgres`) |
| `NIGHTWRITER_SQLITE_PATH` | `<data>/nightwriter.db` | SQLite file |
| `NIGHTWRITER_ADMIN_USERNAME` / `NIGHTWRITER_ADMIN_PASSWORD` | `admin` / _generated_ | seed admin (password logged once if unset) |
| `NIGHTWRITER_SESSION_SECRET` | _generated+persisted_ | HMAC secret for session tokens |
| `NIGHTWRITER_SESSION_TTL_MS` | `604800000` | session lifetime (7d) |
| `NIGHTWRITER_RP_ID` / `NIGHTWRITER_RP_NAME` | `localhost` / `Nightwriter` | WebAuthn relying party (passkeys) |
| `NIGHTWRITER_ORIGIN` | `http://localhost:5172` | allowed passkey origins (host must match RP ID) |

## Security notes

- CLIs are spawned with array argv (`spawn(cmd, [args])`) — never through a
  shell, so prompts can't inject shell commands.
- Artifacts are written only inside a per-job tmp dir; paths are traversal-guarded.
- Subprocesses are time-limited and cancelable (SIGKILL).
- Log lines are masked for common secret patterns before streaming/logging.

### Network exposure

The server binds to `127.0.0.1` by default — it runs local CLIs with your
authenticated credentials, so it stays loopback-only unless you opt in. To reach
it from other machines on the LAN:

```bash
# API on all interfaces
HOST=0.0.0.0 pnpm --filter @nightwriter/api dev
# Vite dev server on all interfaces
pnpm --filter @nightwriter/web exec vite --host 0.0.0.0
```

Then open `http://<this-host-ip>:5172`. Username/password login works over a LAN
IP (the web server proxies `/api`). **Passkeys only work on `localhost` over HTTP**
— WebAuthn needs a secure context and the page host must match `NIGHTWRITER_RP_ID`;
for remote passkeys serve over HTTPS with a real hostname and set
`NIGHTWRITER_RP_ID`/`NIGHTWRITER_ORIGIN`. Prefer HTTPS for any non-loopback
exposure so session tokens aren't sent in cleartext.
