#!/usr/bin/env bash
# Stop 钩子：每轮 Claude 停止时触发。
# 若 git 状态相对上次记录有变化（存在未记录的进展），则阻断停止并提醒运行 update-plan 技能。
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "$(cd "$(dirname "$0")/../.." && pwd)")"
cd "$ROOT"

STATE_FILE=".claude/.plan-state"

current="$(bash .claude/hooks/plan-state.sh fingerprint 2>/dev/null || echo "")"
stored="$(cat "$STATE_FILE" 2>/dev/null || echo "")"

if [ -n "$current" ] && [ "$current" != "$stored" ]; then
  echo "【update-plan】检测到本轮有未记录的进展，请运行 update-plan 技能，把本轮完成内容同步到 docs/IMPROVEMENT_PLAN.md 的「执行进展日志」，最后执行 bash .claude/hooks/plan-state.sh record。" >&2
  exit 2
fi

exit 0
