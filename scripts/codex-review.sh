#!/usr/bin/env bash
# Run a Codex code review over the current branch's diff.
# Usage: pnpm review [base-ref]   (base defaults to origin/dev, then dev, then HEAD~1)
# Output: prints the report and writes it to .codex-review.md
set -euo pipefail

# --- ensure node/codex are on PATH (fallback to nvm, like scripts/ci-check.sh) -
if ! command -v node >/dev/null 2>&1 && [ -d "$HOME/.nvm/versions/node" ]; then
  latest="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)"
  [ -n "$latest" ] && export PATH="$HOME/.nvm/versions/node/$latest/bin:$PATH"
fi
if ! command -v codex >/dev/null 2>&1; then
  echo "✗ codex CLI not found on PATH. Install it or add it to PATH." >&2
  exit 1
fi

REPO="$(git rev-parse --show-toplevel)"
cd "$REPO"
MODEL="${CODEX_MODEL:-gpt-5.5}"

# --- resolve a base ref to diff against ------------------------------------
git fetch -q origin dev 2>/dev/null || true
BASE="${1:-}"
if [ -n "$BASE" ]; then
  git rev-parse --verify -q "$BASE" >/dev/null ||
    { echo "✗ base ref not found: $BASE" >&2; exit 1; }
else
  for cand in origin/dev dev HEAD~1; do
    if git rev-parse --verify -q "$cand" >/dev/null; then BASE="$cand"; break; fi
  done
fi
[ -n "$BASE" ] || { echo "✗ could not resolve a base ref to diff against" >&2; exit 1; }

# Changes to review: committed vs base + tracked worktree edits + new (untracked) files.
DIFF="$(
  git diff "$BASE"...HEAD
  git diff HEAD
  git ls-files --others --exclude-standard -z |
    while IFS= read -r -d '' f; do git diff --no-index -- /dev/null "$f" || true; done
)"
if [ -z "${DIFF//[[:space:]]/}" ]; then
  echo "No changes vs $BASE — nothing to review."
  exit 0
fi

echo "▶ Codex review ($MODEL) of changes vs $BASE …" >&2

PROMPT="$(cat <<'EOF'
You are doing a focused, READ-ONLY code review of the diff below for the
Nightwriter project (a service that runs LLM CLIs to generate agent definitions;
Fastify + SQLite backend, React frontend, auth with password/passkey).

Review ONLY what the diff changes (you may read surrounding files in the repo for
context). Report:

## Summary (1-2 sentences: is it sound?)
## Issues by severity
CRITICAL / HIGH / MEDIUM / LOW — each with file:line and a one-line description.
Focus on real bugs, security (authz/ownership, injection, secrets), data integrity,
and correctness. Say "none" at a level if empty. Skip nitpicks/style.
## Good (brief, optional)

Be concrete, cite file:line, keep it tight. Here is the diff:

EOF
)"

REPORT="$REPO/.codex-review.md"
{ printf '%s\n' "$PROMPT"; printf '%s\n' "$DIFF"; } \
  | codex exec -m "$MODEL" -C "$REPO" -s read-only - | tee "$REPORT"

echo "" >&2
echo "✓ review written to .codex-review.md" >&2
