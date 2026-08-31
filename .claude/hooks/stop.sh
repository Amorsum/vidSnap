#!/usr/bin/env bash
# Stop 钩子：每轮 Claude 停止时触发。
# 若 git 状态相对上次记录有变化（存在未提交的进展），则阻断停止并提醒运行 /git-push。
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(cd "$(dirname "$0")/../.." && pwd)")"
cd "$ROOT"

STATE_FILE=".claude/.plan-state"

current="$(bash .claude/hooks/plan-state.sh fingerprint 2>/dev/null || echo "")"
stored="$(cat "$STATE_FILE" 2>/dev/null || echo "")"

if [ -n "$current" ] && [ "$current" != "$stored" ]; then
  echo "【git-push】检测到本轮有未提交的进展，请运行 /git-push 技能：提交前会自动同步 README 与 docs/IMPROVEMENT_PLAN.md 进展日志，最后执行 bash .claude/hooks/plan-state.sh record。" >&2
  exit 2
fi

exit 0
