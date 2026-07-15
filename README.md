# VidSnap — AI 视频理解助手

> **一句话**：丢给它一个 YouTube/抖音链接，它替你看完，然后你可以问任何问题。

## 产品定位

不是泛化的"多模态知识助手"，而是专注解决一个高频刚需——**"视频太长/太水，我只想知道讲了什么"**。

## MVP 核心功能

| 功能 | 输入 | 输出 |
|------|------|------|
| 视频总结 | 抖音/YouTube 链接 | 结构化摘要 + 分段要点 + 总时长 |
| 追问对话 | 基于视频内容提问 | AI 回答，结合原文上下文中 |
| 跨语言翻译 | 外语视频链接 | 中文总结 |

## 技术栈

- **前端**: Next.js 16 + React 19 + Tailwind CSS v4
- **视频处理**: yt-dlp（下载）+ FFmpeg（音频预处理）
- **ASR 转写**: 硅基流动 SenseVoice API（云端）/ faster-whisper（本地降级）
- **AI 引擎**: DeepSeek API（默认）/ Claude API（可选切换）
- **部署**: 支持 Vercel（云端 SenseVoice）/ 本地运行（Whisper GPU）

## 当前状态

**Demo MVP 已完成**，核心链路跑通：视频链接 → 音频下载 → 智能转写 → AI 总结 → 追问对话。

## 快速开始

```bash
# 安装依赖
npm install

# 配置环境变量（复制 .env.example 为 .env.local 并填入 Key）
# DEEPSEEK_API_KEY=sk-xxx    # 必填
# SENSEVOICE_API_KEY=sk-xxx  # 可选，云端转写

# 本地启动
npm run dev
```

## 目录结构

```
├── README.md                    # 项目简介
├── PRODUCT_PLAN.md              # 完整产品方案
├── docs/
│   └── CONTEXT.md               # AI 助手项目上下文
├── src/
│   ├── app/
│   │   ├── page.tsx             # 产品首页
│   │   ├── layout.tsx           # 根布局
│   │   └── api/process/         # 视频处理 API
│   ├── components/              # UI 组件
│   └── lib/                     # 核心逻辑
│       ├── llm.ts               # LLM 服务层（DeepSeek/Claude）
│       ├── sensevoice.ts        # SenseVoice 云端 API
│       ├── transcriber.ts       # Whisper 本地转写
│       ├── video-processor.ts   # yt-dlp 视频处理
│       ├── prompts.ts           # Prompt 模板
│       ├── process-cache.ts     # 结果缓存
│       ├── transcript-store.ts  # 原文存储（追问）
│       └── url-utils.ts         # URL 解析
└── scripts/
    ├── whisper_server.py        # Whisper 常驻服务器
    └── whisper_asr.py           # Whisper 降级脚本
```