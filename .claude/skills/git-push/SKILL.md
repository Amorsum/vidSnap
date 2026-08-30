---
name: git-push
description: 把本轮改动提交并推送到 GitHub：自动按仓库规范生成中文 commit message，提交后同步 plan-state 指纹。手动 /git-push 调用。
---

# git-push — 提交并推送 GitHub

把当前工作区的改动生成一个规范提交并推送到 GitHub。

## 执行步骤

1. **查看现状**：运行 `git status --porcelain` 和 `git diff --stat`。
   - 工作区干净（无改动）：直接告知用户「没有可提交的改动」，结束。
   - 有改动：继续第 2 步。
2. **安全检查**：确认待提交文件里**绝不包含**敏感文件：
   - `.env.local`、`cookies.txt`、`cloudflared-config.yml`、`.claude/.plan-state`、`--dump-json` 等调试产物
   - `.env.example` 是模板，**可以**提交（.gitignore 已放行）
   - 若发现敏感文件出现在 `git status` 未忽略列表中，先停下来告知用户，不要提交。
3. **生成 commit message**：参考 `git log --oneline -5` 的仓库风格，格式为：
   ```
   <type>: <中文一句话概述>（关键细节）
   ```
   - type 取值：`feat`（新功能）/ `fix`（修 bug）/ `refactor`（重构）/ `docs`（文档）/ `chore`（杂项）
   - 一句话说清本轮做了什么，细节用括号补充，不要冗长
4. **提交**：用 `git add <文件1> <文件2> ...` 明确列出文件（**不要** `git add -A` 或 `git add .`），然后 `git commit -m "<message>"`。
   - 一轮工作一个逻辑提交，不拆分碎提交，不改写历史（除非用户要求）。
5. **推送**：`git push origin <当前分支>`（本项目默认 demo）。推送失败（网络/冲突）时如实报告错误，并给出建议（如稍后重试），不要反复重试。
6. **同步指纹（必须，最后一步）**：运行 `bash .claude/hooks/plan-state.sh record`，避免 Stop 钩子重复触发 update-plan。

## 规则

- 只提交与本轮工作相关的文件；无关的改动（如用户手动改了一半的其他文件）单独询问。
- 提交信息用中文，与仓库历史保持一致。
- 推送成功与否都要如实报告（commit hash、推送的分支与结果）。
