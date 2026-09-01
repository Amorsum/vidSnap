# VidSnap — AI 岗位简历改进方案

> **目标**：在现有 Demo MVP 基础上，补齐「正式上线」所需能力，并把项目打磨成 AI 岗位简历中能讲出深度的作品。
>
> **维护方式**：本文档由 `git-push` 技能在每次提交前自动维护（整合自原 `update-plan` 技能）—— 每轮工作结束运行 /git-push 时，自动把本轮进展写入下方「📋 执行进展日志」并同步状态勾选。

---

## 1. 背景与目标

- **项目**：VidSnap — AI 视频理解助手（粘贴 YouTube/抖音链接 → AI 总结 + 追问）
- **现状**：Demo MVP 已跑通核心链路，但仍是「本地运行 + Cloudflare Tunnel」的演示形态，非可上线状态
- **目标岗位**：AI 应用工程师 / 大模型应用开发 / LLM 工程（非算法研究岗）
- **核心判断**：项目缺的不是「功能」，是「AI 工程的深度」—— 面试官想看的是「把 LLM 从能跑做成可信、可控、可评估、可观测」

---

## 2. 现状功能盘点

### 2.1 技术栈

| 层 | 实现 |
|---|---|
| 前端 | Next.js 16 + React 19 + Tailwind v4（暗色玻璃拟态） |
| 视频下载 | yt-dlp（YouTube）+ Playwright 抓接口 + ffmpeg 直连（抖音，绕过 X-Bogus） |
| ASR 转写 | 双模：SenseVoice 云端（硅基流动）优先 → faster-whisper 本地常驻服务器降级 |
| LLM | 通用 Provider 层：DeepSeek（默认，SSE 流式）/ Claude 可选切换 |
| 部署 | 本地生产模式 + Cloudflare Tunnel 内网穿透 |

### 2.2 已实现功能

主流程在 `src/app/api/process/route.ts`：链接解析 → 信息提取 → 缓存检查 → 音频/字幕 → 智能转写（三级降级）→ AI 结构化总结 → 追问 → 清理

- 链接解析（YouTube + 抖音，混合文本自动提取 URL）
- 视频信息提取（标题/时长/封面/UP主）
- 智能转写三级降级：自带字幕 > SenseVoice 云端 > 本地 Whisper
- AI 结构化总结（一句话总结 + 视频类型 + 分段要点，绑定时间戳）
- 追问（基于 transcript 内存存储）
- SSE 流式进度 + 15s 心跳保活
- 内存缓存（1 小时过期）

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

- [x] **零鉴权 + 零限流**：已加访问码门禁（ACCESS_CODE + /api/verify + 前端门禁页）+ 每 IP 滑动窗口限流（2026-08-30，轻量版；完整 NextAuth 用户体系仍属 B3）
- [ ] **无额度/配额管理**：有每 IP 限流兜底，但无用户概念、无每日调用上限（B3 完整版待做）
- [ ] **抖音 cookies 明文存储**：依赖 Firefox 登录态，脆弱且无法规模化
- [x] **临时文件清理只在成功路径**：缓存命中与异常分支均已清理（2026-08-30）

### 🟠 可靠性 / 架构

- [ ] **部署非「线上服务」**：依赖电脑开机 + 临时 Tunnel 地址
- [ ] **同步阻塞处理**：长视频 70-130s，无任务队列，serverless 会超时
- [ ] **内存态存储**：缓存/transcript 都是 Map，重启即失、多实例不共享
- [ ] **SenseVoice 时间戳是估算的假时间戳**（按字数估算时长），追问引用不准

### 🟠 代码质量 / 死代码

- [ ] **两套废弃 API 路由**：`process/summarize`、`process/transcribe` 引用了不存在的旧模块
- [x] **手写 JSON 解析**：`fixTruncatedJSON` 手动补括号，脆弱，应换结构化输出（A2 已用 json mode 替换）
- [x] **无测试、无日志聚合、无监控**：测试体系已建立（test-suite 技能 + tester 专员 + 报告存档 docs/test-reports/），日志聚合/监控仍待做
- [x] **`.env.example` 缺失**：已补齐（含 VISION_ENABLED/VISION_MODEL 视觉配置）
- [ ] **小瑕疵**：Header GitHub 死链、根目录调试残留文件（`--dump-json`、`.dump`）

### 🟡 产品 / 合规

- [ ] 版权灰色地带 → 需 ToS + 「处理后删除」说明
- [ ] 抖音反爬随时失效 → 需降级预案
- [ ] 无隐私政策、历史记录、账号体系

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

- [ ] 时间戳胶囊做成真正可点击跳转视频播放（Phase 3）
- [ ] 流式分析中不展示裸 JSON，改友好提示
- [ ] 移动端追问面板吸底 / 提前
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

> 由 `git-push` 技能在提交前自动维护，最新进展在上方。

| 日期 | 阶段 | 完成内容 | 涉及文件 | 状态 |
|------|------|---------|---------|------|
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
