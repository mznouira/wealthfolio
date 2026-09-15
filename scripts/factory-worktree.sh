#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Manage per-task git worktrees for the agent factory (OpenCode or Claude Code).
Engine-agnostic core behind scripts/opencode-worktree.sh and
scripts/claude-worktree.sh — call those, not this, unless you need
--engine explicitly.

Usage:
  scripts/factory-worktree.sh --engine <opencode|claude> create <name> [options]
  scripts/factory-worktree.sh --engine <opencode|claude> list
  scripts/factory-worktree.sh --engine <opencode|claude> remove <name> [--force]
  scripts/factory-worktree.sh help

create options:
  --from <ref>     Branch/commit to start from (default: HEAD)
  --copy-env       Copy local .env files into the worktree
  --install        Run pnpm install in the worktree
  --prompt <text>  Launch the engine with this prompt
  --no-launch      Do not launch the engine after creating

Worktrees live in .worktrees/<name> on branch agent/<name>.
EOF
}

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$repo_root" ]; then
  echo "error: not inside a git repository" >&2
  exit 1
fi
worktrees_dir="$repo_root/.worktrees"

engine="opencode"
if [ "${1:-}" = "--engine" ]; then
  engine="${2:?--engine requires a value}"
  shift 2
fi
case "$engine" in
  opencode|claude) ;;
  *) echo "error: unknown engine: $engine (expected opencode or claude)" >&2; exit 2 ;;
esac

cmd="${1:-help}"
if [ $# -gt 0 ]; then shift; fi

slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9._-'
}

case "$cmd" in
  create)
    if [ $# -lt 1 ]; then
      echo "error: create requires a name" >&2
      usage >&2
      exit 2
    fi
    name="$1"; shift
    from="HEAD"; copy_env=0; install=0; launch=1; prompt=""

    while [ $# -gt 0 ]; do
      case "$1" in
        --from) from="${2:?--from requires a ref}"; shift 2 ;;
        --copy-env) copy_env=1; shift ;;
        --install) install=1; shift ;;
        --prompt) prompt="${2:?--prompt requires text}"; shift 2 ;;
        --no-launch) launch=0; shift ;;
        *) echo "error: unknown option: $1" >&2; exit 2 ;;
      esac
    done

    slug="$(slugify "$name")"
    if [ -z "$slug" ]; then
      echo "error: invalid worktree name: $name" >&2
      exit 2
    fi

    dir="$worktrees_dir/$slug"
    branch="agent/$slug"

    if [ -e "$dir" ]; then
      echo "error: worktree already exists: $dir" >&2
      exit 1
    fi

    mkdir -p "$worktrees_dir"
    git -C "$repo_root" worktree add -b "$branch" "$dir" "$from"

    if [ "$copy_env" = "1" ]; then
      for f in "$repo_root/.env" "$repo_root/.env.local" "$repo_root/.env.web"; do
        if [ -f "$f" ]; then
          cp "$f" "$dir/$(basename "$f")"
          echo "copied $(basename "$f")"
        fi
      done
    fi

    if [ "$install" = "1" ]; then
      (cd "$dir" && pnpm install)
    fi

    echo "worktree: $dir"
    echo "branch:   $branch"

    if [ "$launch" = "1" ]; then
      case "$engine" in
        opencode)
          if [ -n "$prompt" ]; then (cd "$dir" && opencode run "$prompt"); else (cd "$dir" && opencode); fi
          ;;
        claude)
          if [ -n "$prompt" ]; then (cd "$dir" && claude -p "$prompt"); else (cd "$dir" && claude); fi
          ;;
      esac
    fi
    ;;

  list)
    git -C "$repo_root" worktree list
    ;;

  remove)
    if [ $# -lt 1 ]; then
      echo "error: remove requires a name" >&2
      usage >&2
      exit 2
    fi
    name="$(slugify "$1")"; shift
    force=0
    if [ "${1:-}" = "--force" ]; then force=1; fi
    dir="$worktrees_dir/$name"
    if [ ! -d "$dir" ]; then
      echo "error: no such worktree: $dir" >&2
      exit 1
    fi
    if [ "$force" = "1" ]; then
      git -C "$repo_root" worktree remove --force "$dir"
    else
      git -C "$repo_root" worktree remove "$dir"
    fi
    git -C "$repo_root" branch -D "agent/$name" >/dev/null 2>&1 || true
    echo "removed: $dir"
    ;;

  help|--help|-h)
    usage
    ;;

  *)
    echo "error: unknown command: $cmd" >&2
    usage >&2
    exit 2
    ;;
esac
