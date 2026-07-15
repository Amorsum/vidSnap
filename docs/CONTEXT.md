# CONTEXT.md — AI 助手项目上下文

> **写给下一个接手的 AI 助手**：在开始任何代码工作之前先读这个文件。
> 它记录了项目的完整背景、已做的决策、和当前的进展状态。
>
> **创建日期**：2026-07-14
> **上次更新**：2026-07-14

---

## 1. 项目概览

- **项目名**：VidSnap（暂定）
- **产品定位**：AI 视频理解助手 — 用户丢一个视频链接，AI 替用户看完并回答问题
- **目标平台**：YouTube（优先）、抖音（第二）
- **当前阶段**：Week 1-2 核心链路已完成，Demo MVP 就绪

---

## 2. 已有文件说明

| 文件 | 作用 | 重要性 |
|------|------|--------|
| `PRODUCT_PLAN.md` | 完整产品方案，所有决策的源头 | ⭐⭐⭐ |
| `docs/CONTEXT.md` | 本文件，AI 交接文档 | ⭐⭐⭐ |
| `docs/vid-snap-showcase.html` | 产品概念展示页（静态HTML，UI 参考） | ⭐ |
| `.env.example` | 环境变量模板 | ⭐⭐ |

### 源代码文件

| 文件 | 作用 | 重要性 |
|------|------|--------|
| `src/lib/video-processor.ts` | yt-dlp 封装：YouTube/抖音视频信息提取、音频下载、Playwright 签名 | ⭐⭐⭐ |
| `src/lib/transcriber.ts` | Whisper 常驻服务器客户端：本地转写、SRT/VTT 解析、多行协议 | ⭐⭐⭐ |
| `src/lib/sensevoice.ts` | 硅基流动 SenseVoice 云端 API 封装（Vercel 部署用） | ⭐⭐⭐ |
| `src/lib/llm.ts` | 通用 LLM 服务层：支持 DeepSeek（默认）/ Claude 切换，SSE 流式输出 | ⭐⭐⭐ |
| `src/lib/prompts.ts` | Prompt 模板管理：多语言修复规则 + 总结/提取/翻译/追问 | ⭐⭐⭐ |
| `src/lib/url-utils.ts` | URL 工具：平台检测、混合文本 URL 提取 | ⭐⭐ |
| `src/lib/process-cache.ts` | 内存缓存：已处理视频结果 Map 缓存，1小时过期 | ⭐⭐ |
| `src/lib/transcript-store.ts` | 内存 transcript 存储：支持追问功能，1小时过期 | ⭐⭐ |
| `src/lib/constants.ts` | 常量定义：支持域名、正则、错误消息 | ⭐⭐ |
| `src/app/api/process/route.ts` | API 路由：POST 串联完整处理流水线（缓存→下载→智能转写→总结→清理） | ⭐⭐⭐ |
| `src/app/api/process/types.ts` | API 类型定义 | ⭐⭐ |
| `scripts/whisper_server.py` | Whisper 常驻服务器：beam_size=5 高质量转写，一次加载模型复用 | ⭐⭐⭐ |
| `scripts/whisper_asr.py` | Whisper 降级脚本：服务器不可用时使用，功能同上 | ⭐⭐ |
| `src/app/page.tsx` | 产品首页：暗色主题、链接输入、动态进度展示、结果展示、追问输入 | ⭐⭐⭐ |
| `src/components/Header.tsx` | 头部组件 | ⭐ |
| `src/components/URLInput.tsx` | 链接输入组件（自动提取 URL、平台检测） | ⭐⭐ |
| `src/components/ProcessingStatus.tsx` | 处理进度展示组件（动态 0-100% 进度条） | ⭐⭐ |
| `src/components/ResultPanel.tsx` | 结果展示组件（视频信息 + AI 总结分段） | ⭐⭐⭐ |
| `src/components/FollowUpInput.tsx` | 追问输入组件 | ⭐ |

---

## 3. 技术选型（已确定）

| 组件 | 方案 | 备注 |
|------|------|------|
| 前端框架 | Next.js 16 + React 19 + Tailwind CSS v4 | SSR 友好，生态成熟 |
| 视频下载/解析 | yt-dlp（child_process.execFile） | 支持 YouTube + 抖音（Playwright 签名） |
| ASR 引擎 | 双模：SenseVoice 云端 API / 本地 Whisper | 云端优先（Vercel 部署），本地降级（demo） |
| 本地 ASR | faster-whisper（Python 常驻服务器） | beam_size=5，RTX 4070 CUDA 加速 |
| AI 理解 | DeepSeek API（默认）/ Claude API（可选） | LLM_PROVIDER 环境变量切换 |
| 多语言 | DeepSeek prompt 修复 | 转写阶段不做多语言检测，交给 LLM 后处理 |
| 任务队列 | 无（MVP 同步处理） | Week 5-6 引入 BullMQ + Redis |
| 存储 | 临时文件系统 | 处理后自动清理 |

---

## 4. MVP 只做这 3 个功能（不要做别的）

1. **视频总结** — 结构化摘要 + 分段要点（✅ 已实现）
2. **关键信息提取** — 按关注点提取，带时间戳（预留接口）
3. **跨语言翻译** — 外语视频 → 中文（预留接口）

### 明确不做（防止范围蔓延）

- ❌ 图片上传
- ❌ 纯文字粘贴
- ❌ 跨视频关联
- ❌ 实时对话（第一版只做单轮+简单追问）
- ❌ 移动端 App

---

## 5. 开发阶段（按此顺序执行）

### Week 1-2：核心链路跑通
- [x] 搭建 Next.js 项目骨架
- [x] 集成 yt-dlp → YouTube 链接 → 音频下载
- [x] 部署 Whisper → 音频 → 字幕
- [x] 接入 Claude API → 字幕 → 总结
- [x] 前端产品 UI（暗色主题，参考 showcase 页面）
- [x] **里程碑：对一个 YouTube 视频生成中文总结**（端到端测试验证通过）

### Week 3-4：抖音 + 功能完善
- [ ] 抖音链接解析
- [ ] 关键信息提取功能
- [ ] 翻译功能
- [ ] **里程碑：支持两大平台 + 三大功能**

### Week 5-6：产品化
- [ ] 任务队列 + 异步处理
- [ ] 用户系统（注册/登录）
- [ ] 免费额度管理
- [ ] 前端界面打磨

### Week 7-8：上线准备
- [ ] 支付接入
- [ ] 性能优化
- [ ] 内测 + Bug 修复
- [ ] **里程碑：MVP 上线**

---

## 6. 关键架构决策

1. **异步化处理**：视频处理耗时长，MVP 阶段用同步处理 + SSE 流式进度，Week 5-6 引入 BullMQ
2. **处理后删除原始文件**：版权灰色地带的应对策略，ToS 明确用户责任
3. **每个结论绑定时间戳/原文引用**：防幻觉设计，可验证性
4. **先用 Web 验证**：不做移动端，不做浏览器插件，先做网页
5. **Whisper 常驻服务器**：Python 进程常驻内存，模型只加载一次，消除 2-5s 冷启动
6. **LLM 可切换**：通过 `LLM_PROVIDER` 环境变量在 DeepSeek / Claude 之间切换，默认 DeepSeek
7. **字幕优先级策略**：优先使用 yt-dlp 下载的视频自带字幕（VTT），降级到本地转写
8. **双模转写**：`SENSEVOICE_API_KEY` 存在时走 SenseVoice 云端（Vercel 部署），否则降级本地 Whisper（demo）
9. **多语言策略**：转写阶段不做逐段检测（慢且不可靠），统一由 DeepSeek prompt 修复谐音错误
10. **内存缓存**：process-cache.ts 缓存已处理结果，Map 存储，1小时过期，重复请求秒级返回
11. **抖音适配**：需要 cookies.txt + Playwright Chromium 生成 X-Bogus 签名

---

## 7. 运行前提

运行本项目需要以下外部依赖：
- **yt-dlp**：需在 PATH 中或项目根目录放 yt-dlp.exe
- **faster-whisper**：`pip install faster-whisper`（本地 ASR）
- **Python 3.12+**：Whisper 常驻服务器运行环境
- **FFmpeg + FFprobe**：系统级安装（音频预处理 + 时长检测）
- **DEEPSEEK_API_KEY**：DeepSeek API Key（必填，在 `.env.local` 中配置）
- **SENSEVOICE_API_KEY**：硅基流动 SenseVoice（可选，有则优先走云端转写）
- **Playwright Chromium**：`npx playwright install chromium`（仅抖音需要）
- **cookies.txt**：抖音登录态（浏览器插件导出，仅抖音需要）

### 环境变量

```bash
# .env.local
DEEPSEEK_API_KEY=sk-xxx          # 必填
SENSEVOICE_API_KEY=sk-xxx        # 可选，云端转写
LLM_PROVIDER=deepseek            # 默认 deepseek
WHISPER_MODEL=large-v3           # 默认 large-v3
```

### 启动方式

```bash
# 本地 demo
npm run dev

# 首次请求会自动启动 Whisper 常驻服务器（Python 进程）
# 或手动启动：python scripts/whisper_server.py large-v3

---

## 8. 产品核心理念（指导所有设计决策）

> **不是让用户更会搜索，而是让用户更会提问。**

- 用户不想看视频，但想知道视频讲了什么
- 翻译功能天然跨语言，是拉新抓手
- 免费用户 → 体验价值 → 频次不够用 → 付费，这个转化链是核心

---

## 9. 给下一个 AI 的提示

- **PRODUCT_PLAN.md 是唯一的真相来源**，里面有十四节完整方案
- 开始写代码前，先通读 PRODUCT_PLAN.md 的第五至十节
- 严格按 MVP 范围走，不要做 PRODUCT_PLAN.md 标记为 ❌ 的功能
- `docs/vid-snap-showcase.html` 是产品概念稿，可以做 UI 参考
- 本文件每次做重大决策后请更新
- 构建命令：`npm run build`（已验证通过）

---

## 10. 当前状态

> **上次更新**：2026-07-15
> **当前阶段**：Demo MVP 完成，SenseVoice 云端接入，准备比赛提交

### 已完成
- [x] Next.js 项目骨架搭建
- [x] yt-dlp 集成：YouTube/抖音链接 → 音频下载
- [x] Whisper ASR：faster-whisper 常驻服务器，beam_size=5，CUDA 加速
- [x] SenseVoice 云端转写：硅基流动 API 接入，双模降级
- [x] LLM 接入：DeepSeek API（默认），Claude 可选
- [x] 前端产品 UI：暗色主题 + 玻璃拟态 + 渐变光效
- [x] SSE 流式进度：动态 0-100% 进度条
- [x] 内存缓存：process-cache.ts，1小时过期，重复请求秒级返回
- [x] 多语言支持：DeepSeek prompt 修复谐音错误
- [x] URL 自动提取：混合文本中提取链接
- [x] 追问功能：transcript-store.ts 存储原文供追问
- [x] 端到端测试验证通过

### 关键决策
- LLM 从纯 Claude 改为通用 LLM 层，支持 DeepSeek/Claude 切换
- Whisper 从 openai-whisper CLI 改为 faster-whisper 常驻服务器，消除冷启动
- 多语言策略：不做逐段音频检测（慢且不可靠），统一由 DeepSeek prompt 修复
- 双模转写：SenseVoice 云端优先（Vercel 部署），本地 Whisper 降级（demo）
- 功能简化：移除"提取关键信息"和"翻译"按钮，合并进追问功能

### 下一步
- 部署到 Vercel（公开访问）
- 准备比赛提交材料（截图、Session ID、论坛帖子）
- 抖音链接线上验证（需要 Playwright 在 Vercel 环境中运行）

---

## 11. 变更记录

| 日期 | 变更内容 |
|------|---------|
| 2026-07-14 | 创建文档，完成项目规划 |
| 2026-07-14 | Week 1-2 核心代码开发：transcriber.ts、ai-engine.ts、prompts.ts、API route 改造、前端 UI 6 组件、page.tsx 产品首页、layout.tsx 更新、constants.ts、.env.example。构建验证通过。 |
| 2026-07-14 | Demo MVP 完成：LLM 层改造（Claude → DeepSeek 通用层）、Whisper Python 脚本化、端到端测试验证通过。添加 vidSnap-context-updater skill。 |
| 2026-07-15 | 重大更新：SenseVoice 云端 API 接入（src/lib/sensevoice.ts）实现双模转写；Whisper 改为 faster-whisper 常驻服务器（beam_size=5）；多语言策略从逐段检测改为 DeepSeek prompt 修复；新增 SSE 流式进度、process-cache 缓存、transcript-store 追问支持、URL 自动提取；简化 UI 移除鸡肋功能；全面更新 CONTEXT.md 反映当前状态。 |
