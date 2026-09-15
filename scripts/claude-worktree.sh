#!/usr/bin/env bash
# Thin Claude Code-flavored entry point over the shared factory-worktree.sh
# core. See .factory/README.md.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/factory-worktree.sh" --engine claude "$@"
