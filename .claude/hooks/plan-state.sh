#!/usr/bin/env bash
# VidSnap 改进方案状态指纹工具
#   fingerprint : 输出当前 git 状态指纹（HEAD + 工作区改动，排除 .claude/ 与方案文档自身）
#   record      : 将当前指纹写入 .claude/.plan-state（供 Stop 钩子判断是否需要触发 update-plan）
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(cd "$(dirname "$0")/../.." && pwd)")"
cd "$ROOT"

STATE_FILE=".claude/.plan-state"

fingerprint() {
  local head dirty
  head="$(git rev-parse HEAD 2>/dev/null || echo no-head)"
  dirty="$(git status --porcelain 2>/dev/null | grep -vE '\.claude/|docs/IMPROVEMENT_PLAN\.md$' || true)"
  printf '%s\n%s\n' "$head" "$dirty" | sha256sum | cut -d' ' -f1
}

case "${1:-}" in
  fingerprint)
    fingerprint
    ;;
  record)
    mkdir -p .claude
    fingerprint > "$STATE_FILE"
    ;;
  *)
    echo "usage: $0 {fingerprint|record}" >&2
    exit 1
    ;;
esac
