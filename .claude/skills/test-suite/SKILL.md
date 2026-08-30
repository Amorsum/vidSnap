---
name: test-suite
description: VidSnap 功能测试：先按模块穷举测试用例（含预期结果），再执行测试，最后输出测试报告并保存到 docs/test-reports/。手动 /test-suite 调用。
---

# test-suite — 项目功能测试

目标：对 VidSnap 做一轮系统性的功能测试 —— **先给用例清单，再执行，最后出报告**。

## 阶段一：准备

1. 确认生产服务运行在 `http://localhost:3000`（`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` 应为 200）。未运行则先启动（参考 `autostart.bat` 的方式，分离启动 + 轮询就绪）。
2. 从 `.env.local` 读取 `ACCESS_CODE`（本地测试用，**测试报告与命令输出中不得明文出现该码**，用 `<访问码>` 代替）。
3. 检查当前未提交改动（`git status --porcelain`）：有未提交的功能改动时，测试报告需注明「测试的是工作区版本」。

## 阶段二：生成测试用例清单

按以下模块穷举，**先输出用例清单（含每条的预期结果）**，再开始执行。每条用例编号（如 A1、B2）：

- **A. 构建与静态检查**：`npx tsc --noEmit`、`npm run build` 必须通过
- **B. 服务可用性**：本地首页 200；公网 `https://vidsnap.amorsum.top/` 200（网络允许时）
- **C. 访问码校验 `/api/verify`**：错误码 → 401；正确码 → 200 success；失败 11 次 → 第 11 次 429；正确码在失败限流后仍 200
- **D. 接口鉴权**：`/api/process`、`/api/followup`、`/api/process` DELETE 无码/错码 → 401
- **E. 输入校验 `/api/process`**：空 body → 400；非法 URL → 400；非支持平台（如 bilibili 链接）→ 400
- **F. 完整处理管线**（YouTube 短视频，如 jNQXAC9IVRw）：SSE 事件序列完整（progress → stream → result）、result 字段齐全（video/transcriptSource/transcriptText/segments/result/metrics）、无 error
- **G. 缓存快速路径**：同链接第二次 → `cached: true` 且数秒内返回；`%TEMP%\vidsnap` 目录无残留文件
- **H. 追问 `/api/followup`**：正常问题 → 200 + answer 非空；缺参数 → 400；不存在的 videoId → 404；含 emoji/长文本问题不崩溃
- **I. 抖音**（可选，受反爬环境影响）：解析失败时错误消息含真实原因（非固定文案）
- **J. 限流**（**放在最后**，会占用 10 分钟配额）：`/api/process` 同 IP 第 11 次 → 429 且带重试秒数
- **K. 前端页面**：首页 200 且含门禁相关文案；`/?code=<访问码>` 可正常加载（HTML 层面验证）

## 阶段三：执行

- 按用例清单顺序执行，用 curl 脚本完成，逐条记录「实际结果 vs 预期」。
- **成本与配额意识**：
  - 完整管线（F）只跑 1 次真实视频（短视频），G 复用同链接（缓存命中不产生 LLM 费用）；
  - `/api/process` 限流 10 次/10 分钟/IP，测试用例总数不要超过该额度，J 用例放最后；
  - `/api/verify` 失败限流 10 次/10 分钟，C 用例放 D 之前完成。
- **环境容错**：YouTube 管线失败若报 ConnectionReset/403/proxy 类错误，可能是 Clash 代理抖动 —— 间隔几秒重试 1 次再判定；仍失败则标记「环境相关失败」而非代码缺陷。
- 测试不改任何代码；发现问题只记录。

## 阶段四：测试报告

报告保存到 `docs/test-reports/TEST-<YYYYMMDD>.md`，并在对话中展示摘要。格式：

```markdown
# VidSnap 功能测试报告 <YYYY-MM-DD>

- 测试版本：<git HEAD hash 或「工作区未提交」>
- 执行时间 / 测试人：Claude Code (test-suite 技能)

## 汇总
| 总数 | 通过 | 失败 | 环境相关 | 通过率 |
|---|---|---|---|---|

## 用例明细
| 编号 | 模块 | 用例 | 预期 | 实际 | 结果 |
|---|---|---|---|---|---|

## 失败详情与建议
（每条失败：现象、可能原因、建议处理方式；环境相关的单独归类）

## 成本与配额说明
（本次测试消耗的 LLM 调用次数、是否触及限流配额）
```

## 规则

- 报告如实：失败就是失败，不粉饰；环境问题明确标注，不归为代码缺陷。
- 测试过程中发现的 bug 只报告不修改，等用户指示。
- 如果用户指定了测试范围（某模块/某文件），只测该范围。
