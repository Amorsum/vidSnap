# VidSnap — AI 岗位简历改进方案

> **2026-10-29 更新**：当前开发统一 main，第一阶段学习闭环与全文搜索已交付，最新 `624893c`。下一步按 [下一阶段计划](NEXT_PHASE_PLAN.md) 先建设回归/发布检查，再实现已完成分析持久化、在途恢复、质量评测和稳定部署。新阶段仅规划完成；旧 [完整优化方案](OPTIMIZATION_PLAN.md) 和下方日志保留架构依据与历史记录，不能把历史未提交状态当作当前状态。

> **目标**：在现有 Demo MVP 基础上，补齐「正式上线」所需能力，并把项目打磨成 AI 岗位简历中能讲出深度的作品。
>
> **维护方式**：本文档由 `git-push` 技能在每次提交前自动维护（整合自原 `update-plan` 技能）—— 每轮工作结束运行 /git-push 时，自动把本轮进展写入下方「📋 执行进展日志」并同步状态勾选。

---

## 1. 背景与目标

- **项目**：VidSnap — AI 视频学习助手（YouTube / Bilibili / 抖音链接 → 总结、追问、本地笔记与复习）
- **现状**：第一阶段学习功能有公网入口，仍依赖本机生产服务与 Cloudflare Tunnel；持久会话、任务恢复和常驻部署尚未实施
- **目标岗位**：AI 应用工程师 / 大模型应用开发 / LLM 工程（非算法研究岗）
- **核心判断**：项目缺的不是「功能」，是「AI 工程的深度」—— 面试官想看的是「把 LLM 从能跑做成可信、可控、可评估、可观测」

---

## 2. 现状功能盘点

### 2.1 技术栈

| 层 | 实现 |
|---|---|
| 前端 | Next.js 16 + React 19 + Tailwind v4，响应式学习工作台 |
| 视频下载 | yt-dlp（YouTube / Bilibili）+ Playwright 与 FFmpeg（抖音），平台/CDN 出站边界 |
| ASR 转写 | 双模：SenseVoice 云端（硅基流动）优先 → faster-whisper 本地常驻服务器降级 |
| LLM | 通用 Provider 层：DeepSeek（默认，SSE 流式）/ Claude 可选切换 |
| 部署 | 本地生产模式 + Cloudflare Tunnel 内网穿透 |

### 2.2 已实现功能

主流程在 `src/app/api/process/route.ts`：规范链接 → 会话/在途合并/缓存 → 平台信息与字幕/音频 → 三级转写降级 → 可选视觉 → 总结与检索 → 追问；媒体按既有成功/异常/删除策略清理。

- 链接解析（YouTube / Bilibili / 抖音，混合文本提取，B 站分 P 隔离）
- 视频信息提取（标题/时长/封面/UP主）
- 智能转写三级降级：自带字幕 > SenseVoice 云端 > 本地 Whisper
- AI 结构化总结（一句话总结 + 视频类型 + 分段要点，绑定时间戳）
- 追问（基于 transcript 内存存储）
- SSE 流式进度 + 15s 心跳保活
- 内存缓存（1 小时过期）
- 本地笔记、摘录、术语/复习题、章节进度、手动复习、全文搜索、JSON 备份导入与 Markdown 导出

### 2.3 已有的工程亮点（简历可讲，不要浪费）

1. 双模/三级降级设计（成本、延迟、可用性权衡）
2. Whisper 常驻服务器（消冷启动，stdin/stdout 多行 JSON 协议）
3. LLM Provider 抽象层（DeepSeek/Claude 切换，两种 API 格式）
4. SSE 流式 + 心跳保活（解决 Cloudflare 隧道超时）
5. 防幻觉设计（结论强制绑定时间戳）
6. 抖音反爬（Playwright 拦 API 响应，非手写签名逆向）

---

## 3. 上线前需改进清单（分级）

### 🔴 安全 / 成本（不解决不能公开）

- [x] **现有接口保护与限流覆盖**：主处理、历史处理、追问等已统一入口保护；匿名资源执行归属校验，访问码已移除。完整账号体系和持久配额另行实施。
- [ ] **无额度/配额管理**：有每 IP 限流兜底，但无用户概念、无每日调用上限（B3 完整版待做）
- [ ] **抖音 cookies 明文存储**：依赖 Firefox 登录态，脆弱且无法规模化
- [x] **媒体目录隔离与删除校验**：主处理按分析目录清理，历史接口使用独立工作目录；DELETE 校验输入及归属，同时失效结果、字幕和对话。
- [ ] **崩溃后持续清理与持久删除状态**：到期扫尾仍依赖现有定时/后续分析；跨进程清理与删除回写守卫需随持久化验证。

### 🟠 可靠性 / 架构

- [ ] **部署依赖个人电脑**：当前使用固定域名 + Cloudflare Tunnel，仍依赖电脑、网络和本地进程在线；待迁移常驻服务。
- [ ] **长任务依赖 Web 进程**：已有 SSE、同进程刷新/断线恢复和长音频分片；无独立 Worker 与持久任务恢复
- [ ] **内存态存储**：缓存/transcript 都是 Map，重启即失、多实例不共享
- [ ] **转写时间精度与内容质量**：SenseVoice 分片内时间仍为估算，界面已标明；真实对齐误差、外语和学习题质量仍需评测

### 🟠 代码质量 / 死代码

- [ ] **两套历史 API 契约收敛**：`process/summarize`、`process/transcribe` 已加入口保护与独立媒体清理，处理策略仍有差异；兼容或停用方式需明确，不能直接删除。
- [x] **手写 JSON 解析**：`fixTruncatedJSON` 手动补括号，脆弱，应换结构化输出（A2 已用 json mode 替换）
- [x] **可重复回归入口**：已有 `npm run test:security`、隔离替身浏览器脚本和总结 Eval；最近交付 316 项自动回归与 25 组浏览器检查有报告。
- [ ] **CI、发布检查与线上观测**：干净环境自动检查、统一隔离浏览器入口、日志聚合和持续监控仍待建设。
- [x] **`.env.example` 缺失**：已补齐（含 VISION_ENABLED/VISION_MODEL 视觉配置）
- [ ] **仓库卫生持续维护**：Header 已指向实际仓库，调试产物有忽略规则；后续按当前工作区核对残留，不按历史记录猜测文件存在。

### 🟡 产品 / 合规

- [ ] 版权灰色地带 → 需 ToS + 「处理后删除」说明
- [ ] 抖音反爬随时失效 → 需降级预案
- [ ] 隐私政策、账号体系与跨设备历史待做；2026-10-26 已实现当前浏览器的本地历史笔记

---

## 4. 简历改造规划（阶段 A/B/C）

### 阶段 A：能讲的故事（优先级最高，2-3 周）

| 序号 | 改进项 | 简历亮点 | 面试追问预判 |
|---|---|---|---|
| A1 | 追问改成 **RAG 检索**（字幕向量化 + 语义检索 + 引用溯源） | 「向量检索 RAG 问答，回答可溯源到秒级时间戳」 | 为什么不用全文塞入？上下文窗口/成本/幻觉 |
| A2 | 手写 JSON → **结构化输出**（JSON Schema / function calling） | 「用 structured output 保证 schema 可靠」 | 底层怎么保证的？ |
| A3 | 建立 **评测集（Eval）** | 「LLM-as-judge 量化幻觉率与要点召回」 | 怎么衡量总结好坏？ |
| A4 | **可观测性**（token/成本/延迟埋点） | 「单视频成本可量化到 $0.0X」 | 单视频成本多少？怎么降？ |

### 阶段 B：生产化架构（2-4 周，选做 2-3 个）

| 序号 | 改进项 | 简历亮点 |
|---|---|---|
| B1 | 异步任务队列（BullMQ/Redis 或 Upstash QStash） | 「长任务异步化，支撑 serverless 超时限制」 |
| B2 | 持久化 + 向量库（Supabase + pgvector） | 「内存态演进到持久化存储 + 向量检索」 |
| B3 | 鉴权 + 额度管理（NextAuth） | 「用户体系 + API 额度控制」 |
| B4 | 真正部署（Railway/Fly.io，容器跑 ffmpeg/yt-dlp） | 「容器化部署，24/7 在线」 |

### 部署方案调研（2026-08-22）

- **VPS/腾讯云**：国内节点内存够用（项目约 300-500MB 常驻，禁用本地 Whisper、只走 SenseVoice 云端），但 **YouTube 被墙**；海外/香港节点直连 YouTube，但抖音可能被地域限制（类似之前 B站 海外 412）。
- **Cloudflare 局限**：Tunnel 只是「管道」，代码跑本地，电脑关机就挂；Pages/Workers 不适合（要跑 yt-dlp/ffmpeg 长任务）。
- **结论**：暂缓云端部署，当前本地运行；待做「开机自启」（开机自动拉 Next.js + 隧道）。
- **参照**：Teach Player（video.tpgofighting.top）= Next.js + Cloudflare CDN + 云端源站，印证「云端部署」才是 24/7 唯一解。

### UI 后续优化点（待做）

- [x] 时间戳引用联动原文，提供 YouTube 对应时间外链；抖音显示参考时间并手动定位（2026-10-26）
- [x] 流式分析中不展示裸 JSON，改阶段、已用时间和总结骨架（2026-10-26）
- [x] 移动端总结／原文／追问切换，追问自动定位与动态视口输入区（2026-10-26）
- [ ] 气泡加微信式小尾巴（伪元素）
- [ ] 分段卡片标题 vs 要点字号对比再拉开

### 阶段 C：差异化加分（可选）

- [ ] 浏览器插件一键总结（YouTube/B站）
- [x] 关键帧画廊（视觉 + 字幕多模态理解）：FFmpeg 均匀采样抽帧 → Qwen3-VL 批量画面描述 → 与字幕按时间戳融合进总结；画廊可点击跳转分段；视觉失败静默降级音频-only
- [x] Agent 化（追问 tool-calling 自主决策检索策略）：语义/关键词/时间范围三工具 + 三重防死循环 + 前端工具轨迹可见

---

## 5. 简历写法建议

**项目一句话**（放最上面）：

> 独立从 0 到 1 构建 AI 视频理解应用 VidSnap，打通「链接 → 音视频下载 → 多级 ASR → LLM 结构化总结 → RAG 问答」全链路，支持 YouTube/抖音双平台。

**技术亮点条目**（改造完成后每条都能展开）：

- 设计三级降级转写（自带字幕 → 云端 SenseVoice → 本地 faster-whisper 常驻服务），权衡成本/延迟/可用性
- 基于向量检索的 RAG 追问，回答可溯源到秒级时间戳
- 用结构化输出替代手写 JSON 解析，构建评测集量化幻觉率与要点召回
- LLM Provider 抽象层支持 DeepSeek/Claude 切换，SSE 流式 + 心跳保活

**面试最可能深挖的三点**（提前准备）：

1. 「你的 RAG 怎么做的？为什么不全量塞给模型？」→ A1 反例对比
2. 「怎么保证总结没有编造？」→ 时间戳绑定 + eval 幻觉率
3. 「单视频成本/延迟多少？」→ A4 埋点数据

---

## 6. 优先级路线图

```
A1 RAG → A2 结构化输出 → A3 Eval → A4 可观测 → B3 鉴权限流 → B1 队列 → B2 持久化
```

理由：A1-A4 是「AI 岗位面试官一眼看中的能力」，成本低、全是加分项；B 系列是「生产化」，成本高但面试追问频率不如 A 系列高。

---

## 📋 执行进展日志

### 2026-10-26：刷新与断线后找回分析

- 学习辅助已由 `8c3ce28` 推送 `demo`，同步指纹；接续实现 sessionStorage 当前标签页恢复线索、刷新后尝试一次、EOF/网络中断手动恢复。
- `POST /api/process` 的兼容可选 `resumeOnly` 严格查找原执行或有效缓存，保留归属/平台/视频/期限校验与限流，不创建新任务或重复调用上游。已知分析 ID 防止误接替代执行。
- 旧笔记在恢复期间继续显示；成功后清除线索，不可恢复时提示重新分析。新增存储降级与手机/横屏反馈，说明见 [学习工作台](LEARNING_WORKSPACE.md)。
- 自动与隔离浏览器验证见 [本轮报告](test-reports/TEST-20261026-RECOVERY.md)。本批仍为单进程恢复，数据库、Worker、事件回放及服务器重启恢复未实施；恢复功能与验证文档随本次提交交付。

### 2026-10-26：学习辅助与重点摘录

- 上一批处理稳定性与学习闭环已提交并推送 `demo`：`45b88d3`，已同步本地 plan-state 指纹。
- 新增术语解释、最多三道开放式复习题与按需参考答案，复用现有追问；参考答案显式带原题，失败重试保留用途。
- 字幕、总结要点与成功回答支持重点摘录、来源区分、去重、时间定位、删除与 Markdown 导出；采用笔记 v1 可选字段，兼容旧数据。
- 251 项自动测试、lint/类型检查、隔离构建、8 组新增浏览器检查及 16 组既有学习回归通过。详见 [本轮报告](test-reports/TEST-20261026-STUDY-TOOLS.md)。仅 mock 验证交互，不代表真实模型学习质量通过。
- 此接续开发随学习辅助提交交付；下一步先补同进程分析的刷新与断线后找回，真实学习质量评测及服务器重启恢复仍待补齐。

> 由 `git-push` 技能在提交前自动维护，最新进展在上方。

| 日期 | 阶段 | 完成内容 | 涉及文件 | 状态 |
|------|------|---------|---------|------|
| 2026-10-29 | N0 CI 编码修复 | 首次完整 CI 的浏览器入口因 Windows 默认编码失败；改用 UTF-8，本机 25 组浏览器检查复验通过，重新推送后验收。 | scripts/check-browser-isolated.py, docs/NEXT_PHASE_PLAN.md | 🚧 验证中 |
| 2026-10-29 | N0 隔离浏览器与发布检查 | 首次 CI 已通过；新增三组隔离浏览器自动入口、故障清理演练和发布回滚清单，更新工作流待 GitHub 验证。 | scripts/check-browser-isolated.py, .github/workflows/ci.yml, docs/RELEASE_CHECKLIST.md | 🚧 验证中 |
| 2026-10-29 | N0 CI 首批交付 | 本机 lint、类型和 316 项自动回归通过，提交 Windows CI 工作流；浏览器隔离入口及发布检查待完成。 | .github/workflows/ci.yml, docs/NEXT_PHASE_PLAN.md | 🚧 进行中 |
| 2026-10-29 | 下一阶段计划交付 | 按授权提交优化路线与现状核对，下一步开始 N0 自动回归和发布检查。 | docs/NEXT_PHASE_PLAN.md, README.md, PRODUCT_PLAN.md | ✅ 已完成 |
| 2026-10-29 | 下一阶段规划 | 全文搜索由 624893c 推送 main；确认学习闭环功能阶段完成，编制 N0—N4 的回归/发布、持久化、任务恢复、质量与部署路线和验收边界，修正旧计划现状。 | docs/NEXT_PHASE_PLAN.md, docs/OPTIMIZATION_PLAN.md, PRODUCT_PLAN.md | 📝 规划完成，实施未开始 |
| 2026-10-29 | 全文搜索交付 | 按授权交付已部署的本地全文搜索及来源定位，核对 README、316 项自动/25 组浏览器记录与截图，保留无关协作配置。 | src/lib/notebook-search.ts, src/components/NotebookLibrary.tsx, docs/LEARNING_WORKSPACE.md | ✅ 已完成 |
| 2026-10-29 | 笔记全文搜索 | 七类来源字面检索、命中片段与原文/个人笔记/问答定位；316 项回归、25 组浏览器检查及构建通过，保留旧构建后部署，公网实际搜索通过；上一批学习记录由 454aec0 推送 main。 | src/lib/notebook-search.ts, src/components/NotebookLibrary.tsx, docs/LEARNING_WORKSPACE.md | ✅ 已部署，接续改动未提交 |
| 2026-10-29 | 学习记录交付 | 按授权提交已部署的章节进度与复习记录，核对 README、截图和 311 项自动/17 组浏览器验证说明，保留无关协作配置。 | src/components/LearningProgressPanel.tsx, src/lib/learning-progress.ts, docs/LEARNING_WORKSPACE.md | ✅ 已完成 |
| 2026-10-29 | 学习进度与复习 | 章节标记、状态筛选、复习次数/日期与导出备份兼容；311 项自动回归、17 组浏览器检查及构建通过，备份旧构建后重启并验收本机/公网交互；上一批备份由 1f8d4be 推送 main。 | src/lib/learning-progress.ts, src/components/LearningProgressPanel.tsx, docs/LEARNING_WORKSPACE.md | ✅ 已部署，接续改动未提交 |
| 2026-10-29 | 笔记恢复交付 | 按授权交付已验证的笔记备份与恢复，核对 README、补充桌面/手机截图及交接说明，保留无关协作配置。 | README.md, docs/screenshots/, docs/LEARNING_WORKSPACE.md | ✅ 已完成 |
| 2026-10-29 | 笔记备份与恢复 | JSON 全库备份、导入预览、去重与冲突副本，单事务失败回滚；306 项自动回归、隔离构建与浏览器验证通过，线上服务恢复并确认新入口。 | src/lib/notebook-backup.ts, src/lib/notebook.ts, src/components/NotebookLibrary.tsx | ✅ 已实现验证，未提交 |
| 2026-10-28 | 媒体独立 DNS | 增加可选 DoH 解决系统 fake-IP 误拦截，保留域名/公网 IP/TLS 保护并区分 DNS 错误；302 项回归、构建及失败链接真实完整音频验证通过，已部署。 | scripts/media_dns.py, scripts/media_network.py, docs/MEDIA_NETWORK.md | ✅ 已完成 |
| 2026-10-28 | 长视频转写与发布 | 音频分段、云端超时、本地逐段降级和估算时间；真实 19 秒及约 41 分钟文字链路通过，292 项回归与构建通过，生产重启及公网入口验收完成。 | src/lib/long-transcription.ts, src/lib/sensevoice.ts, docs/LONG_VIDEO.md | ✅ 已完成 |
| 2026-10-28 | B 站媒体兼容 | 修复 B 站 mcdn 8082 音频下载被误拦截和登录误报，实测完整音频及 FFprobe，285 项回归、lint、构建与公网入口验证通过；真实转写/总结仍待验收。 | scripts/media_network.py, src/app/api/process/route.ts, docs/MEDIA_NETWORK.md | ✅ 已完成 |
| 2026-10-28 | B 站学习入口与发布 | 接入 BV/av、短链与分 P，移除访问码并保留匿名资源保护；281 项回归、真实媒体及桌面/手机验证通过，更新生产构建并重启，本机与公网新版页面验收通过。 | src/lib/video-processor.ts, src/lib/url-utils.ts, scripts/start-services.ps1 | ✅ 已完成 |
| 2026-10-26 | 恢复交付与主分支开发 | 实现刷新与断线恢复并完成 254 项自动测试、31 组隔离浏览器检查；按用户最新要求将 demo 历史快进整合到 main，后续统一在 main 开发提交。 | src/app/api/process/route.ts, src/components/LearningWorkspace.tsx, docs/LEARNING_WORKSPACE.md | ✅ 已完成，本次提交 |
| 2026-10-26 | 学习闭环交付 | 按用户授权将学习工作台、依赖的在途合并与视觉预算整合为一次提交并推送 demo；核对 README、248 项回归和浏览器记录，保留无关协作配置。 | README.md, docs/LEARNING_WORKSPACE.md, docs/OPTIMIZATION_PLAN.md | ✅ 已实现验证，本次提交 |
| 2026-10-26 | 学习闭环 | 实现等待/重试、原文搜索与引用、移动端追问、IndexedDB 本地笔记与 Markdown 导出；来源精度/视觉状态进入缓存，新增只读分析资格查询。248 项回归、16 组学习浏览器检查、既有会话隔离、lint/类型与隔离构建通过；真实平台验收仍待补。 | docs/LEARNING_WORKSPACE.md, docs/test-reports/TEST-20261026-LEARNING.md | ✅ 已实现并验证，未提交 |
| 2026-10-26 | M1 第四批 | 视觉下载/抽帧/模型链共用默认 30 秒预算，取消 HTTP 等待、保留部分画面与已知 usage，超时继续文字总结；239 项回归通过，真实视觉/HTTP 验收待补。 | src/lib/vision-budget.ts, src/lib/vision.ts, docs/VISION_BUDGET.md | 🚧 已验证，待确认提交 |
| 2026-10-22 | M1 第三批 | 同会话同规范链接在解析前合并，等待连接有数量/时限边界；断连、删除和失败重试隔离，222 项回归通过，HTTP/浏览器仍暂缓。 | src/lib/process-flights.ts, src/app/api/process/route.ts, docs/INFLIGHT_PROCESSING.md | 🚧 已验证，待确认提交 |
| 2026-10-22 | M1 第二批 | 复用首次解析的选定字幕轨道，直链/单轨兜底及空坏字幕转写降级；音频/低清视频读取真实路径，真实短样本字幕/音频通过且无模型调用。207 项回归与隔离构建通过；HTTP/浏览器按用户要求暂缓。 | src/lib/video-processor.ts, src/lib/subtitle-tracks.ts, docs/YOUTUBE_DOWNLOADS.md | ✅ 已完成（d37e846） |
| 2026-10-22 | M1 第一批 | 新增单调时钟阶段计时及真实文字路由验收；规范链接有效缓存前置，移除样本缓存路径约 5.3 秒的平台解析。184 项回归及隔离构建通过，完整平台/视觉/部署验收仍待补。 | src/lib/pipeline-timing.ts, src/app/api/process/route.ts, docs/PIPELINE_TIMING.md | ✅ 已完成（d37e846） |
| 2026-10-22 | M0 第六批提交 | 用户确认真实媒体小样本命令与验证文档，通过代理推送 demo 并同步指纹，main 未自动合入。 | scripts/media-smoke.ts, docs/OPTIMIZATION_PLAN.md | ✅ 已通过 8d11f93 提交并推送 demo |
| 2026-10-22 | M0 第六批 | 新增固定短视频验收命令，真实元信息、英文字幕下载/解析、音频下载/探测与清理通过；166 项回归、静态检查和隔离构建通过，抖音登录/云端/部署验收仍待补。 | scripts/check-media.ts, scripts/media-smoke.ts, docs/RUNTIME_CHECKS.md | ✅ 已完成，用户确认提交 |
| 2026-10-22 | M0 第五批提交 | 用户确认运行环境检查、本地字体与验证文档，已通过代理推送 demo，main 未自动合入。 | docs/OPTIMIZATION_PLAN.md, docs/RUNTIME_CHECKS.md | ✅ 已通过 67414d1 提交并推送 demo |
| 2026-10-22 | M0 第五批 | 新增可重复环境检查，实际受控平台连接与缓存 tiny 常驻转写通过；本地固定 Geist 字体，真实字体构建摆脱网络依赖。158 项回归及桌面/移动验证通过，完整平台/云端验收仍待补。 | scripts/check-runtime.ts, src/app/fonts/, docs/RUNTIME_CHECKS.md | ✅ 已完成，用户确认提交 |
| 2026-10-22 | M0 第四批提交 | 用户确认提交并通过 127.0.0.1:7890 推送已验证的 Whisper 恢复；后续先核对真实网络/推理验收，不自动合入 main。 | docs/WHISPER_RECOVERY.md, docs/OPTIMIZATION_PLAN.md | ✅ 已通过 8001756 提交并推送 demo |
| 2026-10-22 | M0 第四批 | 实现共享 Whisper 队列、握手/请求 ID、超时与退出恢复、串行脚本兜底及 WAV 异常清理；150 项回归及静态检查通过。原样构建受字体网络阻断，离线夹具验证另见报告；无真实推理评测。 | src/lib/whisper-client.ts, scripts/whisper_audio.py, docs/WHISPER_RECOVERY.md | ✅ 已验证，已获本次提交授权 |
| 2026-10-22 | M0 第三批提交 | 用户授权的媒体出站加固 4817d68 最初受 GitHub 网络阻断，后经用户指定的系统代理推送成功。保留 main 默认主分支，后续继续 demo。 | docs/OPTIMIZATION_PLAN.md, docs/MEDIA_NETWORK.md | ✅ 已提交并经系统代理推送 demo |
| 2026-10-21 | M0 第三批 | 增加短链逐跳验证、媒体域名/DNS 与固定 IP 连接、专属代理及显式可信上游配置；FFmpeg 限制本地输入。94 项 TS + 19 项 Python、真实 Chrome 负向及本地二进制验证通过；隔离构建通过。真实平台冒烟和 Whisper 恢复仍待办。 | scripts/media_network.py, src/lib/media-network.ts, docs/MEDIA_NETWORK.md | ✅ 已实现验证，2026-10-22 获提交授权 |
| 2026-10-21 | M0 第二批 | 新增匿名会话及分析归属、独立媒体/帧目录、删除回写守卫与对话 TTL；修复缓存画面证据恢复、稳定帧 ID 及过期帧引用；92 项回归与隔离构建通过，补充桌面/移动端浏览器验证。仍待出站边界及 Whisper 在途恢复，未进入 M1。 | src/lib/analysis-store.ts, src/app/api/process/route.ts, docs/API_SESSIONS.md | ✅ 已通过 541855b 提交并推送 demo；M0 继续推进 |
| 2026-10-21 | M0 第一批 | 统一接口鉴权/限流、严格输入与历史接口独立媒体清理；65 项回归、18 组 HTTP 检查、lint、TypeScript 和隔离构建通过。用户确认提交推送，采用 demo 当前内容整合 main 并设为默认，保留两边历史与 master 的 B 站实现；M0 其余项目仍待实施。 | src/lib/security.ts, tests/, docs/OPTIMIZATION_PLAN.md | ✅ 首批完成，M0 继续中 |
| 2026-10-21 | 优化方案 | 完成当前代码结构审查和完整优化方案，定义安全修复、性能、多语言、持久任务、部署、回归与验收；修正历史文档中鉴权覆盖、清理、部署和旧路由现状。仅方案编制完成，实施任务未开始。 | docs/OPTIMIZATION_PLAN.md, docs/IMPROVEMENT_PLAN.md, docs/CONTEXT.md, README.md | 📝 方案完成 |
| 2026-09-02 | 仓库卫生 | 规范文件结构、清理与项目无关文件：删除 TRAE 比赛报名贴（docs/初赛报名贴.md）、5 个未使用的 Next.js 默认脚手架图标（public/*.svg）与遗留的 .trae/ 工具目录；同步清理 docs/CONTEXT.md 中两处对报名贴的引用 | docs/初赛报名贴.md, public/*.svg, docs/CONTEXT.md | ✅ 已完成 |
| 2026-09-02 | UI 重构 | 重塑现代视频理解工作台：统一品牌 Logo 与浏览器图标，优化首页输入、处理状态、关键帧画廊、时间线总结和 Video Agent 的响应式布局；保留已提交的视频链接，移除页脚提示，并将底层网络异常转换为可读错误信息 | src/app/page.tsx, src/components/ResultPanel.tsx, public/vidsnap-mark.svg | ✅ 已完成 |
| 2026-09-01 | 修复 | 视觉模型降级链：主模型高峰期队列不稳（实测批 1 超时 + 批 2 连续 500）——32B → 30B-A3B → 8B 逐级降级，上一模型未覆盖的帧交给下一模型补齐；5xx 重试加 2s 延时；实测 32B 500 后延时重试即恢复 6/6 帧 | src/lib/vision.ts | ✅ 已完成 |
| 2026-09-01 | 修复 | 视觉理解稳定性 + 追问画面感知 + 聊天 Markdown 渲染：视觉 API 改每批 4 帧小请求（90s 超时 + 5xx 重试，单批失败跳过保留部分结果）修复长视频 500/超时致关键帧消失；关键帧描述以【画面】伪段落带 embedding 存入追问库（三工具可检索画面，实测"画面里有什么"命中视觉描述）；ChatPanel 手写零依赖 Markdown 渲染器（加粗/列表/分隔线/标题/行内代码 + 时间戳胶囊） | src/lib/vision.ts, process/route.ts, ChatPanel.tsx, prompts.ts | ✅ 已完成 |
| 2026-09-01 | 修复 | 追问乱码二次加固：长视频场景下模型同名工具换参数打转（segment_range 反复重试）突破签名守卫、并行调用突破轮数意图——新增工具名计数守卫（同名 ≤2 次）+ 总调用硬上限 4 次 + 宽标记伪格式检测（invoke/tool_call/function_call/特殊分隔符变体）整段兜底；压力实测 5-6 次→4 次封顶且回答干净 | src/lib/llm.ts, api/followup/route.ts | ✅ 已完成 |
| 2026-09-01 | 修复 | 追问乱码修复：模型交替换工具绕过防死循环守卫 + 强制收尾轮输出伪工具调用格式（invoke 乱码）——已见签名集合守卫拦交替循环 + 伪调用文本清洗 + prompt 工具纪律收紧 + 路由双保险兜底；真实问题实测干净回答（工具 6 次→3 次封顶） | src/lib/llm.ts, prompts.ts, api/followup/route.ts | ✅ 已完成 |
| 2026-08-31 | 阶段 C | 关键帧视觉理解（多模态）：FFmpeg 均匀采样抽帧（确定性时间戳）→ 硅基流动 Qwen3-VL-32B 批量画面描述 → 与字幕按时间戳融合进总结（±5s 语义对齐、冲突以画面为准）；关键帧画廊点击跳转分段 + HMAC 签名帧图服务 + 2h 帧生命周期懒清理；视觉失败静默降级音频-only；E2E 真机验证通过（6 帧 / 902 tokens / ¥0.0017） | src/lib/keyframes.ts, vision.ts, api/frames/route.ts, process/route.ts | ✅ 已完成 |
| 2026-08-31 | 阶段 C | 追问 Agent 化：callLLMToolLoop（DeepSeek function calling + Claude tool_use 双协议归一）三工具自主决策检索（语义/关键词/时间范围），轮数上限 + 重复调用终止 + 无工具终轮三重防死循环，前端可见工具轨迹；四类问题实测工具选择全对 | src/lib/llm.ts, api/followup/route.ts, prompts.ts, ChatPanel.tsx | ✅ 已完成 |
| 2026-09-01 | 收尾 | tester 新一轮全量测试 44 条用例 43 通过 / 1 环境相关（新增 L 视觉理解 / M Agentic 追问模块），两个 bug 修复复验通过（断开零异常 / DELETE 缓存失效），报告存档 docs/test-reports/TEST-20260831.md | docs/test-reports/TEST-20260831.md, .claude/skills/test-suite/SKILL.md | ✅ 已完成 |
| 2026-08-31 | 收尾 | 评测集 2→12 条（多类型多语言 + 1 条真实视频）+ 脚本 --only/归档/重试，全量重跑幻觉率 0.0% / 召回率 99.1%；修复客户端断开 uncaughtException 与 DELETE 缓存失效；test-suite 技能新增 L/M 模块（tester 新一轮测试报告待出） | scripts/eval/, docs/AI_CODING.md, .claude/ | ✅ 已完成 |
| 2026-08-31 | 收尾 | update-plan 技能并入 git-push：提交前自动同步 README 现状 + 改进方案进展日志，删除 update-plan 技能目录，Stop 钩子提醒改指 /git-push | .claude/skills/git-push/SKILL.md, .claude/hooks/stop.sh, docs/AI_CODING.md | ✅ 已完成 |
| 2026-08-31 | 收尾 | P0 简历可见性：README 大改版（mermaid 架构图 + AI 工程亮点 8 条 + 评测/成本数据 + 4 张真实界面截图）+ 仓库卫生（删 7 个调试残留脚本）+ 新增 docs/AI_CODING.md 多智能体工作流文档；tsc/build 验证通过 | README.md, docs/AI_CODING.md, docs/screenshots/, scripts/ | ✅ 已完成 |
| 2026-08-30 | 收尾 | 建立测试工具链：test-suite skill + tester 专员，全项目首轮测试 30/30 全通过（100%，仅 2 项环境相关），报告存档 docs/test-reports/；测试成本约 ¥0.01（3 次 LLM 调用） | .claude/, docs/test-reports/ | ✅ 已完成 |
| 2026-08-30 | 收尾 | 代码规范化清理：新建 code-standard skill + code-standarder 专员并跑通全流程（死代码删除/类型统一/SSE 解析抽取 sse.ts/组件去重 ComposerInput/memo 优化，净 -144 行）+ 修复限流桶清理恒真 bug + 提交推送自动化工具链（git-push skill + git-committer），tsc/build/真机冒烟全通过 | src/ 全体, security.ts, .claude/ | ✅ 已完成 |
| 2026-08-30 | 上线修复 | B3 轻量版：访问码门禁（ACCESS_CODE + verify 接口 + 前端门禁页 + localStorage/URL参数）+ 每 IP 滑动窗口限流（CF 真实 IP，防暴力猜测失败计数）+ 异常分支临时文件清理 + autostart 幂等/端口轮询 + 抖音脚本 UTF-8 根治 emoji + .env.example；真机验证 401/429/管线全通过 | security.ts, verify/route.ts, process/followup route.ts, page.tsx, autostart.bat, douyin_playwright.py | ✅ 已完成 |
| 2026-08-30 | 上线修复 | code-review 高优先级修复：恢复缓存快速路径（命中跳过下载，11s→3s 实测）+ 追问竞态（turn 按 id 更新 + 并发守卫）+ tiny 模型限定回抖音 + 抖音错误消息带真实原因 + yt-dlp 版本兼容探测（旧版本自动降级），真机验证通过 | route.ts, platforms.ts, video-processor.ts, page.tsx, ChatPanel.tsx, douyin-processor.ts | ✅ 已完成 |
| 2026-08-30 | 收尾 | 清理 debug 代码 + 5 个逻辑 commit + push（UI重构/架构重构/yt-dlp修复/部署/docs） | - | ✅ 已完成 |
| 2026-08-26 | 上线修复 | 封面加载失败兜底（🎬占位图）+ yt-dlp 加浏览器 UA 伪装（3处调用），缓解 YouTube 反爬识别 | ResultPanel.tsx, video-processor.ts | ✅ 已完成 |
| 2026-08-26 | 部署 | 配置开机自启（autostart.bat + vbs 到 Windows 启动文件夹），解决 1033 反复（会话切换/重启被杀进程）问题 | autostart.bat, VidSnap-autostart.vbs | ✅ 已完成 |
| 2026-08-22 | 架构重构 | 平台处理器模式（platforms.ts 统一接口 + route.ts 去 if/else 分平台）+ 抖音降级友好提示 | platforms.ts, route.ts, douyin-processor.ts | ✅ 已完成 |
| 2026-08-22 | 部署调研 | 调研部署方案：国内节点内存够(300-500MB)但YouTube被墙；海外/香港节点直连YouTube但抖音可能被限；Cloudflare Tunnel只是管道非主机；结论：暂缓部署，本地运行 + 待做开机自启 | - | 📝 调研记录 |
| 2026-08-21 | UI重构 | 浅色 shadcn 风格（#165DFF/#F7F8FA）+ 左右分栏 + 时间轴样式 + 蓝色时间戳胶囊 + 空状态示例问题 | globals.css, page.tsx, ChatPanel.tsx, ResultPanel.tsx 等 | ✅ 已完成 |
| 2026-08-21 | 追问v2 | 追问升级：混合回答（自然衔接）+ 多轮上下文 + 对话历史UI + 加载动画，真机验证通过 | prompts.ts, conversation-store.ts, followup/route.ts, page.tsx, ResultPanel.tsx | ✅ 已完成 |
| 2026-08-20 | A4 | 可观测性埋点：token 用量 + 成本核算 + 耗时统计（实测单视频 ¥0.0064 / token 1769 / 25.7s） | src/lib/llm.ts, observability.ts, route.ts | ✅ 已完成 |
| 2026-08-20 | A3 | 建立总结质量评测集 + LLM-as-judge（幻觉率 0% / 召回率 100%），复用真实 prompt 零漂移 | scripts/eval/, src/lib/llm.ts | ✅ 已完成 |
| 2026-08-20 | A2 | 用 JSON mode（response_format json_object）替代手写 JSON 解析，删 60 行补括号逻辑 | src/lib/llm.ts, process/route.ts | ✅ 已完成 |
| 2026-08-20 | 上线修复 | 修复抖音解析 NoneType 崩溃 + 多字段降级找视频地址 + 友好错误提示 | scripts/douyin_playwright.py | ✅ 已完成 |
| 2026-08-20 | 上线修复 | 修复 dev 模式跨域致按钮不可用（切生产模式）+ URLInput 实时显示识别链接 | src/components/URLInput.tsx | ✅ 已完成 |
| 2026-08-20 | 部署 | 配置 Cloudflare 永久隧道，绑定 vidsnap.amorsum.top（公网 HTTP 200） | cloudflared-config.yml, start.bat | ✅ 已完成 |
| 2026-08-20 | A1 | 修复超长字幕触发 embedding 500（截断+分批），真机验证 RAG 向量检索生效 | src/lib/embeddings.ts | ✅ 已完成 |
| 2026-08-20 | A1 | 追问改造成向量检索 RAG + 引用溯源（三级降级），tsc+build 通过 | src/lib/embeddings.ts, rag.ts, followup/route.ts | ✅ 已完成 |
| 2026-08-16 | 初始化 | 建立改进方案文档 + update-plan 技能 + Stop 钩子自动更新机制 | docs/IMPROVEMENT_PLAN.md, .claude/ | ✅ 已完成 |
