# CONTEXT.md — AI 助手项目上下文

> **N0 开始（2026-10-29）**：优化计划已由 `eb9c93e` 推送 main，新增 Windows CI 工作流草案。本机 lint、TypeScript 和 316 项自动回归通过；工作流尚未推送或在 GitHub 运行，隔离浏览器入口及发布检查尚未完成，N0 仍进行中。

> **下一阶段规划（2026-10-29）**：全文搜索已由 `624893c` 推送 main 并记录指纹。核对后确认第一阶段学习闭环的功能目标已完成，按用户要求进入下一阶段规划，见 [NEXT_PHASE_PLAN.md](NEXT_PHASE_PLAN.md)：N0 回归与发布检查 → N1 已完成分析持久化 → N2 在途任务恢复 → N4 常驻部署/账号同步；N3 证据与学习质量并行准备。已核对会话/分析/字幕/对话的内存态、进程帧密钥与缺少 CI 配置，不把已有浏览器刷新恢复称为服务器重启恢复。同步修正 README、产品方案及旧计划的过期现状。此次只完成规划，未引入新依赖、数据库或账号，未运行模型、重启服务或再次提交规划文件。

> **全文搜索交付（2026-10-29）**：按用户本轮授权提交推送已部署的笔记全文搜索，核对 README、316 项自动回归及 25 组浏览器验证、桌面/手机截图；功能与验证文档随本次提交交付。下方未提交描述为此前验收状态，接续先核对学习闭环完成度，再规划下一阶段优化。

> **笔记全文搜索（2026-10-29）**：按“提交推送，再继续完善”先将学习进度与复习记录以 `454aec0` 推送 `main` 并记录指纹。接续实现本地标题/总结/字幕/个人笔记/摘录/成功问答检索、来源片段和定位，支持状态组合筛选，搜索不上传词句或调用模型，无分段旧字幕可读全文。316 项自动回归、25 组浏览器检查、lint/类型与隔离构建通过；备份旧构建后重启 3100、保留隧道，本机/公网实际搜索与字幕定位成功。说明见 [报告](test-reports/TEST-20261029-NOTEBOOK-SEARCH.md)。本次搜索已部署，接续代码尚未提交推送。

> **学习记录交付（2026-10-29）**：用户要求提交推送后继续完善。已核对章节进度、复习记录、备份兼容、README 与展示截图；上一轮 311 项自动和 17 组浏览器验证记录保持原范围，学习记录随本次提交交付。下方“接续开发尚未提交”为此前验收时状态。

> **学习进度与复习（2026-10-29）**：用户授权先提交推送笔记备份，再继续开发并按需重启。备份已由 `1f8d4be` 推送 `main`，随后记录指纹；接续新增章节勾选、三态学习筛选、手动复习计数/日期，以及备份和 Markdown 保留记录。保持 v1 可选字段兼容，不新增账号、模型请求或提醒。311 项自动回归、8 组新增和 9 组备份浏览器回归通过；新分析与缓存复用分别验证。隔离构建后备份根目录旧 `.next`、生产构建并重启 3100，原隧道保留，本机/公网实际导入、勾选和复习成功。详见 [报告](test-reports/TEST-20261029-LEARNING-PROGRESS.md)。接续开发已部署，尚未再次提交推送。

> **笔记备份与恢复（2026-10-29）**：继续完善学习平台，新增浏览器本地 JSON 全库备份、导入预览、内容去重、冲突副本和原子写入回滚；不覆盖当前笔记，不上传文件，不恢复服务端资源或跨设备身份。兼容 v1 笔记，保持 Markdown 导出与现有会话保护。306 项自动回归及浏览器恢复/故障/布局验证见 [报告](test-reports/TEST-20261029-NOTEBOOK-BACKUP.md)。本轮构建期间误触根目录构建，随后完成生产服务恢复，本机及公网 Chrome 200、新入口可见；保留隧道。用户已授权提交推送，功能、截图及验证说明随本次提交交付。

> **媒体 DNS 修复（2026-10-28）**：用户换 B 站链接后再次失败，日志显示元信息阶段被媒体代理拒绝，系统 DNS 对 B 站主站/API 返回 fake-IP。新增 `MEDIA_DNS_MODE=system|doh`；doh 使用固定阿里公共 HTTPS DNS、公开引导地址和证书校验，仍检查所有结果的公网属性并固定连接 IP，失败不回退系统 DNS。仅在 VidSnap `.env.local` 启用 doh 并部署，未改动系统 DNS/代理节点。新失败链接已通过真实元信息、音频分片及完整音频下载/FFprobe；302 项回归与生产构建通过，Chrome 公网入口 200。修复、配置说明与验证记录随本次提交交付。详见 [报告](test-reports/TEST-20261028-MEDIA-DNS.md)。

> **长视频与真实文字链路（2026-10-28）**：按用户确认的前两项计划实施。超过 5 分钟或 40 MiB 的音频分片，单片云端超时 120 秒、失败从当前片起转本地 Whisper；删除状态逐片检查、分片及时清理，云端时间按各片估算。短 B 站真实无字幕文字链路与用户约 41 分钟视频均直接调用生产路由，转写、总结、追问、缓存与删除成功，未启用视觉。该结果不证明时间精度或转写质量；详见 [长视频说明](LONG_VIDEO.md)。用户随后授权部署与推送：根目录生产构建完成、3100 服务已重启，隧道保留，Chrome 公网入口返回 200；本机 B 站 DNS 当前仍有 fake-IP，可能触发媒体网络保护。改动随本次提交交付。

> **Bilibili 音频下载修复（2026-10-28）**：用户反馈 B 站视频误报登录限制；实际为媒体安全代理拒绝 B 站 mcdn HTTPS 8082。现仅允许 `*.mcdn.bilivideo.cn` 在 bilibili 范围使用 8082，保留 HTTPS、域名及全量公网 DNS 校验、固定 IP 和 TLS 主机验证；修正网络策略拒绝误报登录的提示。已用用户视频实测音频分片 206 与完整音频下载/FFprobe，未调用真实转写或模型；生产服务已重启，公网新版入口 200。本轮修复及验证记录随本次提交交付。

> **发布验收（2026-10-28）**：用户授权重启、提交并推送。已停止同构建的旧 3000/3100 VidSnap 实例，保留其他程序，备份旧 `.next` 后根目录生产构建及类型检查通过，新版运行在 3100。隧道重启后已注册连接；公网最初出现 1033，随后 Chrome 验收取得新版页面 200，确认 Bilibili 提示、直接输入和无运行时错误。未切换节点或修改代理配置。GitHub 直连重置、历史 7890 代理未监听，已识别现用本机 7897 代理并验证远端可达。此条更新覆盖下方先前公网未恢复的状态。

> **Bilibili 与开放入口（2026-10-28）**：按用户要求接入 B 站 BV/av、b23.tv 及分 P；保留三平台，复用字幕优先／语音转写／关键帧／追问链路，分 P 独立缓存和笔记。已查阅 master 的历史 B 站专用实现，未整体合并其移除 YouTube/抖音的改动。移除访问码页面、请求头和 `/api/verify`，改为直接使用；匿名会话、来源校验、限流和帧签名仍保留，账号登录后续实施。真实 19.26 秒 B 站样本的解析、音频及低清视频通过；模型全链路使用替身验证，详见 [报告](test-reports/TEST-20261028-BILIBILI.md)。开发时在独立副本构建和浏览器验收；随后用户授权发布，已在根目录重新构建并重启至 127.0.0.1:3100，Chrome 公网验收确认新版三平台入口 HTTP 200、无门禁。

> **本机部署端口修复（2026-10-28）**：另一个程序监听 `127.0.0.1:3000`，使隧道请求绕过仍在 `0.0.0.0:3000` 运行的 VidSnap 并返回其他服务的 401 JSON。部署脚本及本机隧道回源已迁至 `127.0.0.1:3100`；`start.bat` / `autostart.bat` 共用 `scripts/start-services.ps1`，核对 HTTP 成功与首页标题、拒绝占用端口、就绪后才启动隧道，重复运行复用本项目连接器。已验证本机首页 200、静态资源、拒绝旧端口的未授权响应与重复启动。重连隧道时出现 DNS 虚拟地址及 7844 TLS/QUIC 连接失败，公网尚未恢复；用户明确要求只恢复本机，不切换 Clash 节点。临时节点地址/协议试验已撤回，未修改代理配置；启动日志位于忽略目录 `tmp/deployment/`。本轮不涉及业务代码或重新构建。

> **分支约定更新（2026-10-26）**：用户明确要求提交推送到 `main`，之后以 `main` 开发。已在确认祖先关系后将 `demo` 的 8 个后续提交快进整合到本地 `main`，本批恢复功能直接在 `main` 提交。下文 `demo` 记录为历史，不再作为后续默认开发/推送目标；保留已有工作区的协作配置修改。

> **分析连接恢复（2026-10-26）**：学习辅助已由 `8c3ce28` 推送 `demo`；直连失败后使用本机既有代理推送成功，已记录 plan-state。接续新增当前标签页的刷新恢复和断线后手动恢复：process 的 `resumeOnly` 只加入既有执行或读缓存，不得回退到新建任务。线索保存在 sessionStorage，恢复前先加载旧笔记；未新增数据库或 Worker，服务器重启恢复仍属后续 M3。详见 [说明](LEARNING_WORKSPACE.md#刷新与连接恢复) 和 [本轮报告](test-reports/TEST-20261026-RECOVERY.md)。此接续开发随本次恢复功能提交交付。

> **学习辅助接续（2026-10-26）**：上一批学习工作台、在途合并及视觉预算已由 `45b88d3` 推送 `demo`，下方历史段落的“尚未提交”已失效。本轮新增术语解释、复习题与按需参考答案、三种来源的重点摘录；仍复用追问接口，不更改服务端协议或期限。笔记 v1 通过可选 `excerpts`/问答 `purpose` 兼容扩展。本轮随学习辅助提交交付，验证及限制见 [报告](test-reports/TEST-20261026-STUDY-TOOLS.md)。

> **学习工作台更新（2026-10-26）**：已实现单视频学习闭环，详见 [使用与接口说明](LEARNING_WORKSPACE.md)。`LearningWorkspace` 管理分析、原文引用、追问和本地笔记；IndexedDB 长期保存文本快照，帧签名不持久化。新增只读分析状态接口，旧分析过期后只读，新分析保留旧笔记并开启新上下文。来源/时间精度与视觉状态随结果和缓存返回。此次按用户明确计划补做隔离 mock HTTP/浏览器验收，不能代替下文尚未完成的真实平台、ASR、视觉或部署验收；本轮检查见 [学习工作台报告](test-reports/TEST-20261026-LEARNING.md)。

> **当前阅读入口（2026-10-26）**：最新依据见 [完整优化方案](OPTIMIZATION_PLAN.md)。M0 前六批已推送 demo，最新 `8d11f93`；main 仍是默认主分支，master 保留 B 站历史。本轮先行实施 M1 的 [计时与规范链接缓存前置](PIPELINE_TIMING.md)：新增单请求阶段计时、模型首片段/总结解析/结果就绪里程碑，缓存命中不再访问平台且不续期。真实固定短样本的内置字幕→DeepSeek 总结→embedding→工具追问→缓存→删除后 404 通过；使用独立进程直接调用生产路由，没有 HTTP 监听，不是浏览器验收。缓存前置前一次命中为 5333ms（平台解析 5332ms），前置后未调用平台、整数计时为 0ms，不能外推浏览器延迟或 p95。后续新增 [字幕交接与实际媒体路径](YOUTUBE_DOWNLOADS.md)：复用首次解析的人工/自动字幕清单、直接下载与单轨兜底、空坏字幕回退转写，音频/低清视频读取并校验真实输出路径；真实媒体复验通过、无模型调用。前两批 207 项回归（171 TS + 36 Python）、lint/类型检查与隔离构建通过。M1 两批已由 `d37e846` 推送 demo；后续第三批新增 [同会话在途合并](INFLIGHT_PROCESSING.md)：同规范链接在平台解析前合并，等待者复用完成结果，断连/删除不误清理其他连接，失败后可重试；第三批 222 项回归通过；第四批新增 [视觉共享预算](VISION_BUDGET.md)，下载/抽帧/模型链共用默认 30 秒，超时保留成功画面并继续文字总结，metrics.visionStatus 提供降级/覆盖及用量完整性。当前 239 项回归通过，第三/四批均尚未提交；用户已同意暂缓 HTTP/浏览器验收，发布前补齐，不再默认反复启动该测试服务。M0 的抖音登录、无字幕 ASR/完整视觉及部署出站验收仍待补齐；M1 在途合并仅覆盖同规范链接、单进程；后台索引、M2 多语言、M3 持久任务尚未实施。当前仍为单 Node 内存状态、个人电脑 + Cloudflare Tunnel，主总结流式仅支持 DeepSeek，云端时间戳为估算；重启失去会话归属。Git 和媒体可分别配置代理 127.0.0.1:7890，诊断 --proxy 不改生产环境。

> **写给下一个接手的 AI 助手**：在开始任何代码工作之前先读这个文件。
> 它记录了项目的完整背景、已做的决策、和当前的进展状态。
>
> **创建日期**：2026-07-14
> **上次更新**：2026-07-15

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
| `src/lib/douyin-processor.ts` | 抖音视频解析：Playwright 提取信息 + ffmpeg 下载音频 | ⭐⭐⭐ |
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
- [x] 抖音链接解析（Playwright 签名 + ffmpeg 下载）
- [x] 关键信息提取 + 翻译功能（合并进追问功能）
- [x] **里程碑：支持两大平台 + 追问功能**

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

> **上次更新**：2026-07-16
> **当前阶段**：Demo MVP 完成，比赛初赛提交准备中，域名迁移进行中

### 已完成
- [x] Next.js 项目骨架搭建
- [x] yt-dlp 集成：YouTube/抖音链接 → 音频下载
- [x] 抖音 Playwright 解析：绕过 X-Bogus 签名，ffmpeg 下载音频（替代 yt-dlp 403 问题）
- [x] Whisper ASR：faster-whisper 常驻服务器，beam_size=5，CUDA 加速
- [x] SenseVoice 云端转写：硅基流动 API 接入，双模降级
- [x] LLM 接入：DeepSeek API（默认），Claude 可选
- [x] 前端产品 UI：暗色主题 + 玻璃拟态 + 渐变光效
- [x] SSE 流式进度：动态 0-100% 进度条
- [x] 内存缓存：process-cache.ts，1小时过期，重复请求秒级返回
- [x] 多语言支持：DeepSeek prompt 修复谐音错误
- [x] URL 自动提取：混合文本中提取链接
- [x] 追问功能：transcript-store.ts 存储原文供追问
- [x] 端到端测试验证通过（YouTube + 抖音）
- [x] 公网部署：Cloudflare Tunnel 内网穿透（本地生产模式 `npm run start`）
- [x] 一键启动脚本：`start.bat`（Next.js 生产模式 + Cloudflare Tunnel）
- [x] SSE 心跳机制：每 15 秒发送 heartbeat，防止 Cloudflare 隧道超时断开抖音长连接
- [x] Phase 2 规划：Vercel 部署、Bilibili 支持、会员系统（已写入 PRODUCT_PLAN.md）
- [x] 域名迁移：`amorsum.top` DNS 已从 DNSPod 迁移到 Cloudflare（进行中，待创建永久隧道）

### 部署方案
- **最终方案：** 本地运行（生产模式）+ Cloudflare Tunnel 内网穿透
- **失败方案：** Vercel（登录失败）、Netlify（免费额度耗尽 + yt-dlp bot 检测）
- **当前公网地址：** `https://webcams-skills-filme-nova.trycloudflare.com`（重启后变化）
- **注意事项：** 电脑需保持开机至 7/23 审核结束；Windows 电源设置关闭休眠/睡眠；重启后双击 `start.bat` 恢复
- **自有域名：** `amorsum.top` DNS 已迁移到 Cloudflare，待创建永久隧道绑定 `vidsnap.amorsum.top`

### 关键决策
- LLM 从纯 Claude 改为通用 LLM 层，支持 DeepSeek/Claude 切换
- Whisper 从 openai-whisper CLI 改为 faster-whisper 常驻服务器，消除冷启动
- 多语言策略：不做逐段音频检测（慢且不可靠），统一由 DeepSeek prompt 修复
- 双模转写：SenseVoice 云端优先（Vercel 部署），本地 Whisper 降级（demo）
- 功能简化：移除"提取关键信息"和"翻译"按钮，合并进追问功能
- 抖音下载：yt-dlp 对抖音 CDN 直链返回 403，改用 ffmpeg 直接下载（带 Referer 头）
- 前端按钮 bug：Next.js 开发模式阻止 Cloudflare 隧道跨域，改为生产模式解决
- SSE 防超时：Cloudflare 隧道 100 秒超时，抖音处理 70-130 秒易断开，加 15 秒心跳保活
- DNS 迁移：域名 amorsum.top 从 DNSPod 迁移到 Cloudflare，为永久隧道做准备

### 下一步
- 完成 Cloudflare 永久隧道配置，绑定 `vidsnap.amorsum.top`
- 提交比赛初赛材料（截图、Session ID、论坛帖子）
- 保持电脑运行至 7/23 审核结束
- 后续可考虑：Vercel 正式部署、Bilibili 支持、会员系统

---

## 11. 变更记录

| 日期 | 变更内容 |
|------|---------|
| 2026-07-14 | 创建文档，完成项目规划 |
| 2026-07-14 | Week 1-2 核心代码开发：transcriber.ts、ai-engine.ts、prompts.ts、API route 改造、前端 UI 6 组件、page.tsx 产品首页、layout.tsx 更新、constants.ts、.env.example。构建验证通过。 |
| 2026-07-14 | Demo MVP 完成：LLM 层改造（Claude → DeepSeek 通用层）、Whisper Python 脚本化、端到端测试验证通过。添加 vidSnap-context-updater skill。 |
| 2026-07-15 | 重大更新：SenseVoice 云端 API 接入（src/lib/sensevoice.ts）实现双模转写；Whisper 改为 faster-whisper 常驻服务器（beam_size=5）；多语言策略从逐段检测改为 DeepSeek prompt 修复；新增 SSE 流式进度、process-cache 缓存、transcript-store 追问支持、URL 自动提取；简化 UI 移除鸡肋功能；全面更新 CONTEXT.md 反映当前状态。 |
| 2026-07-15 | 部署折腾：Vercel 登录失败 → Netlify 部署（yt-dlp bot 检测 + 免费额度耗尽）→ 最终采用本地生产模式 + Cloudflare Tunnel 内网穿透。抖音下载改用 ffmpeg 直连（替代 yt-dlp 403）。修复前端按钮禁用 bug（Next.js dev mode 跨域阻止）。新增 start.bat 一键启动脚本、douyin-processor.ts、douyin_playwright.py。准备初赛提交材料。 |
| 2026-07-16 | 稳定性修复：SSE 心跳机制（每 15 秒 heartbeat）防止 Cloudflare 隧道 100 秒超时断开抖音长连接。Phase 2 规划写入 PRODUCT_PLAN.md（Vercel 部署、Bilibili、会员系统）。域名 amorsum.top DNS 从 DNSPod 迁移到 Cloudflare，准备永久隧道绑定。电源设置指导（关闭休眠/睡眠）。 |
