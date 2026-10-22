# 运行环境与本机验收

`npm run check:runtime` 用于部署前排查当前 Node/Python、媒体工具、vendor ASR 依赖及缓存。它不重启已有服务、不启动隧道、不修改登录态或 `.env.local`，也不把“依赖已安装”当作完整视频链路可用。

## 使用方式

```powershell
# 默认只读检查：不联网、不读取 cookies 内容、不加载模型。
npm run check:runtime

# 使用 Next 同一套 .env* 加载规则，输出可解析 JSON（--silent 去掉 npm banner）。
npm run --silent check:runtime -- --json

# 显式检查受控 YouTube / 抖音连接，使用当前 MEDIA_UPSTREAM_PROXY 配置。
npm run check:runtime -- --network

# 本次检查覆盖代理；不写回 .env.local、注册表或全局 Git 配置。
npm run check:runtime -- --network --proxy http://127.0.0.1:7890

# 额外启用真实本地 Whisper 冒烟：仅使用完整的 tiny 缓存，禁止联网下载模型。
npm run check:runtime -- --network --proxy http://127.0.0.1:7890 --whisper-smoke
```

`--proxy` 仅设置检查进程的 `MEDIA_UPSTREAM_PROXY`；不会使应用的生产配置自动生效。部署仍需按 [媒体网络说明](MEDIA_NETWORK.md) 配置上游代理，不能依赖 Windows 系统代理或 Git 的临时 `-c http.proxy`。

检查器用已随 Next 16.2.10 安装的 `@next/env` 加载配置，现已显式列为相同版本的直接依赖，不升级现有依赖。报告只包含配置存在与否、工具/模块版本、缓存模型名称和受限状态，不输出密钥、代理凭据、Cookie、完整私有路径或字幕内容。

## 检查层次

| 项目 | 能证明什么 | 不能证明什么 |
| --- | --- | --- |
| 工具版本 | 当前 PATH 中的 yt-dlp、FFmpeg、FFprobe 能执行 | 平台解析或真实媒体下载成功 |
| Python 模块 | 当前 Python 能导入 ctranslate2、faster_whisper、Playwright；报告 vendor/普通安装来源 | GPU 推理、浏览器安装或云端服务可用 |
| 模型缓存 | 常见 Systran 模型快照含 model.bin/config.json/tokenizer.json | 缓存可加载、模型质量或性能 |
| 项目 cookies.txt | 文件存在 | 文件可用、未过期或已登录；检查器不读 Cookie 或浏览器数据库 |
| 代理 | 默认只校验配置；--network 时检查端口可连接 | 平台目标一定可用 |
| 平台请求 | 显式 --network 经现有域名/DNS/固定 IP 边界请求固定公开页面并收到状态 | 视频解析、下载、短链全部兼容，或整条分析成功 |
| Whisper 冒烟 | Windows 本地语音合成夹具经真实缓存 tiny、常驻握手、请求 ID 与本地推理返回非空片段 | 自然语音/多语言准确率、默认 medium 性能或 GPU 路径已单独确认 |

默认不连接代理端口或平台；网络和推理均需显式参数。`--whisper-smoke` 的 Windows 语音合成只写本次 WAV，不播放声音或使用麦克风；缺少 tiny 缓存时明确失败，不下载模型；其他系统显式 skip。常驻失败不会用脚本成功替代这项验收。模型进程与临时 WAV 在收尾时清理。

所有报告都保留 `full_pipeline_verified: false`。`pass` 表示该项检查通过，`warn` 表示能力/配置需核对，`fail` 表示该项未通过，`skip` 表示未执行；有 fail 时退出码为 1，其他情况为 0。warn/skip 不能作为部署就绪证明。

## 字体与离线构建

`src/app/fonts/` 固定已有部署使用的 Geist / Geist Mono 字节及 OFL 许可；保持全部 11 个子集、Unicode 范围、字重与回退度量。布局改为导入本地字体 CSS，不再由 `next/font/google` 在构建时请求 Google Fonts。来源与完整性清单见 [字体资产说明](../src/app/fonts/README.md)。

构建仍应在隔离副本执行以免影响现有 `.next`。现在可以在没有 Google 字体网络/代理、没有 `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` 的情况下验证真实字体生产构建。静态检查之外，还应在浏览器确认子集解码、无外部字体请求和桌面/移动端交互。

本轮结果见 [2026-10-22 环境验收报告](test-reports/TEST-20261022-M0-RUNTIME.md)。这批不调用付费模型，不代替真实视频、云端 API、长音频或完整部署出站策略验收；M0 尚未整体验收完成，下一步补媒体解析/下载小样本，再进入 M1 性能基线。
