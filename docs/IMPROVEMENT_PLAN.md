# VidSnap — AI 岗位简历改进方案

> **目标**：在现有 Demo MVP 基础上，补齐「正式上线」所需能力，并把项目打磨成 AI 岗位简历中能讲出深度的作品。
>
> **维护方式**：本文档由 `update-plan` 技能自动维护 —— 每次指令执行完后，Stop 钩子会自动触发该技能，把本轮进展写入下方「📋 执行进展日志」。

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

- [ ] **零鉴权 + 零限流**：`/api/process` 任何人可无限调用，API Key 会被刷爆产生真实账单（最紧急）
- [ ] **无额度/配额管理**：无用户概念、无每日调用上限
- [ ] **抖音 cookies 明文存储**：依赖 Firefox 登录态，脆弱且无法规模化
- [ ] **临时文件清理只在成功路径**：异常分支不清理，泄漏磁盘/音频文件

### 🟠 可靠性 / 架构

- [ ] **部署非「线上服务」**：依赖电脑开机 + 临时 Tunnel 地址
- [ ] **同步阻塞处理**：长视频 70-130s，无任务队列，serverless 会超时
- [ ] **内存态存储**：缓存/transcript 都是 Map，重启即失、多实例不共享
- [ ] **SenseVoice 时间戳是估算的假时间戳**（按字数估算时长），追问引用不准

### 🟠 代码质量 / 死代码

- [ ] **两套废弃 API 路由**：`process/summarize`、`process/transcribe` 引用了不存在的旧模块
- [x] **手写 JSON 解析**：`fixTruncatedJSON` 手动补括号，脆弱，应换结构化输出（A2 已用 json mode 替换）
- [ ] **无测试、无日志聚合、无监控**
- [ ] **`.env.example` 缺失**（README/CONTEXT 引用了它）
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

### 阶段 C：差异化加分（可选）

- [ ] 浏览器插件一键总结（YouTube/B站）
- [ ] 关键帧画廊（视觉 + 字幕多模态理解）
- [ ] Agent 化（系统自主判断视频类型 → 选策略 → 选模型）

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

> 由 `update-plan` 技能自动维护，最新进展在上方。

| 日期 | 阶段 | 完成内容 | 涉及文件 | 状态 |
|------|------|---------|---------|------|
| 2026-08-20 | A4 | 可观测性埋点：token 用量 + 成本核算 + 耗时统计（实测单视频 ¥0.0064 / token 1769 / 25.7s） | src/lib/llm.ts, observability.ts, route.ts | ✅ 已完成 |
| 2026-08-20 | A3 | 建立总结质量评测集 + LLM-as-judge（幻觉率 0% / 召回率 100%），复用真实 prompt 零漂移 | scripts/eval/, src/lib/llm.ts | ✅ 已完成 |
| 2026-08-20 | A2 | 用 JSON mode（response_format json_object）替代手写 JSON 解析，删 60 行补括号逻辑 | src/lib/llm.ts, process/route.ts | ✅ 已完成 |
| 2026-08-20 | 上线修复 | 修复抖音解析 NoneType 崩溃 + 多字段降级找视频地址 + 友好错误提示 | scripts/douyin_playwright.py | ✅ 已完成 |
| 2026-08-20 | 上线修复 | 修复 dev 模式跨域致按钮不可用（切生产模式）+ URLInput 实时显示识别链接 | src/components/URLInput.tsx | ✅ 已完成 |
| 2026-08-20 | 部署 | 配置 Cloudflare 永久隧道，绑定 vidsnap.amorsum.top（公网 HTTP 200） | cloudflared-config.yml, start.bat | ✅ 已完成 |
| 2026-08-20 | A1 | 修复超长字幕触发 embedding 500（截断+分批），真机验证 RAG 向量检索生效 | src/lib/embeddings.ts | ✅ 已完成 |
| 2026-08-20 | A1 | 追问改造成向量检索 RAG + 引用溯源（三级降级），tsc+build 通过 | src/lib/embeddings.ts, rag.ts, followup/route.ts | ✅ 已完成 |
| 2026-08-16 | 初始化 | 建立改进方案文档 + update-plan 技能 + Stop 钩子自动更新机制 | docs/IMPROVEMENT_PLAN.md, .claude/ | ✅ 已完成 |
