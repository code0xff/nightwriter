#!/usr/bin/env bash
# Run the same checks as the GitHub Actions CI, locally.
# Used by the git pre-push hook and available as `pnpm verify`.
set -euo pipefail

# --- ensure node/pnpm are on PATH (fallback to nvm when not) ---------------
if ! command -v pnpm >/dev/null 2>&1; then
  if [ -d "$HOME/.nvm/versions/node" ]; then
    latest="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)"
    if [ -n "$latest" ]; then
      export PATH="$HOME/.nvm/versions/node/$latest/bin:$PATH"
      corepack enable >/dev/null 2>&1 || true
    fi
  fi
fi
if ! command -v pnpm >/dev/null 2>&1; then
  echo "✗ pnpm not found on PATH (install Node >= 22.13 + corepack)" >&2
  exit 1
fi

cd "$(git rev-parse --show-toplevel)"

step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }

step "install (frozen lockfile)"
pnpm install --frozen-lockfile

step "build shared types"
pnpm --filter @nightwriter/shared build

step "typecheck (all workspaces)"
pnpm -r typecheck

step "test (api)"
pnpm --filter @nightwriter/api test

step "build web"
pnpm --filter @nightwriter/web build

printf '\n\033[32m✓ all CI checks passed\033[0m\n'
