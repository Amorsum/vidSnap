# 流水线计时与真实文字路由验收

## 计时契约

`POST /api/process` 的既有 SSE 类型和结果字段保持兼容，`result.data.metrics` 新增 `timings`。失败 `error` 事件也附加 `metrics.totalMs` / `metrics.timings`，页面可以继续只读原有 message。

每次请求使用独立 `PipelineTimer` 和单调时钟，计时从进入流水线开始，到发布结果前结束，不含接口鉴权/JSON 读取、HTTP 传输、浏览器渲染和 finally 中的媒体清理。所有数值单位为毫秒，四舍五入到整数；0 不表示真实零延迟。

| 字段 | 含义 |
| --- | --- |
| stages.metadata | 平台元信息解析和 ID 校验 |
| stages.cache_lookup / cache_restore | 本次会话缓存查找 / 证据与结果恢复 |
| stages.inflight_wait | 等待本会话同规范链接的既有执行；只计当前连接的等待，不复制生成耗时 |
| stages.workspace / download | 独立产物目录准备 / 平台处理器下载（可含字幕解析请求） |
| stages.transcript | 字幕文件解析，或云端/本地转写及降级等待；不是 Whisper 队列的独立统计 |
| stages.vision | 启用的视觉阶段整体耗时，含低清下载、抽帧和模型；共享预算与降级状态见 [视觉预算](VISION_BUDGET.md)，未拆分内部子阶段 |
| stages.summary | Prompt 组装、模型流读取、JSON 解析；对应旧 summarizeMs，不包含 embedding |
| stages.embedding / persist | 字幕和画面向量生成 / 证据、内容期限和结果缓存写入 |
| firstTokenMs | 本次流水线开始至首个非空模型片段，片段可能只是 JSON，不能称为首个可读摘要 |
| summaryReadyMs | 本次流水线开始至总结流结束并解析成功，尚可能等待向量生成 |
| resultReadyMs | 本次流水线开始至正式 result 就绪，不代表浏览器已经收到 |

每个已执行阶段含 `ms` 与 `outcome`，后者为 completed、degraded 或 failed。视觉/向量失败降级不能记成成功；未执行阶段省略，未发生的时间点为 null。同阶段重复测量累计实际执行耗时，例如解析前后的两次缓存查找不把中间平台等待算入 cache_lookup。缓存命中仅记录本次查找/恢复，不复制原生成请求的耗时，不把未调用模型记为实测 0 毫秒推理。阶段之和会受取整与未归入阶段的开销影响，不要求等于 totalMs。

新增 `[process-timing]` 结构化日志只包含分析 ID、平台、缓存/共享状态、结果状态和计时，不包含字幕、问答、签名 URL、凭据或上游错误正文；这不代表既有全部日志已经完成脱敏改造。

## 缓存行为

规范 YouTube / 抖音视频 URL 可直接提取 ID，路由在访问平台前检查本会话、同平台、已完成且内容仍有效的分析和结果缓存。命中时使用缓存视频元信息及完整证据，保留帧过期处理，不延长 1 小时内容期限和 2 小时帧期限。另一个会话、过期记录或失效缓存仍走真实解析/生成；访问码、限流、来源校验先于读取缓存。

首次查询未命中后，平台解析完成再复查一次，保留等待期间其他请求已经完成时的复用机会。后续第三批增加 [同会话在途合并](INFLIGHT_PROCESSING.md)：同规范链接在访问平台前取得执行权，等待者只复用完成结果。没有 ID 的抖音短链接仍先解析再查缓存，不同短码尚未合并。配置/Prompt 版本缓存键、元信息分层缓存、后台索引和持久任务仍未实现；平台可见性发生变化时，已授权的缓存内容在既有 TTL 内仍可复用，不主动再次向平台校验。

## 真实验收命令

**此命令会调用实际 DeepSeek 总结、追问及可用的 embedding 服务，可能产生费用。** 它固定使用 19 秒公开 YouTube 样本，不替换媒体下载器或上游模型；一次流程只生成一次总结与一次追问，第二次处理应命中缓存。

```powershell
# 在仓库根目录执行。workspace 必须是本仓库 tmp 内已有的独立副本。
npm run --silent check:pipeline -- --workspace .\tmp\m0-session-validation --proxy http://127.0.0.1:7890 --json

# 只验证真实字幕和额外音频路径，不调用模型，也不要求模型 API Key。
npm run --silent check:pipeline -- --workspace .\tmp\m0-session-validation --proxy http://127.0.0.1:7890 --media-only --json
```

副本需要当前 `scripts/`（含 media_network.py、vendor 运行依赖等）及本机媒体工具；进程内模式直接导入当前仓库生产路由，不使用副本 .next，也不监听端口。实际构建仍需按隔离副本流程单独验证。生产模块导入前，把本次进程的 TEMP/TMP/TMPDIR 设为副本内新建的专属目录，防止媒体到期扫描影响既有服务。

检查器读取根目录 .env 配置，在内存中传递访问码，固定关闭视觉。必须存在项目 cookies.txt，复制时使用独占创建，副本已有同名文件则停止；下载器只能写该副本，收尾删除本次 Cookie 副本和专属临时目录。缺少项目 Cookie 时停止，避免读取 Firefox 数据库。所有原始生产日志在该检查进程内抑制，最终只输出已知状态、计时和工具名称。

验收顺序为访问码验证/签发会话 → 真实处理 SSE → 真实追问 → 同会话缓存复用 → DELETE → 删除后追问返回 404。中途失败仍尝试删除本次 analysisId，关闭本次 Whisper 客户端并清理资源。`text_api_pipeline_verified=true` 只代表这条文字路由链路通过；`full_pipeline_verified` 始终为 false，不包含浏览器、HTTP 服务、视觉、无字幕 ASR 或抖音。

另外保留 `check:pipeline:http -- --base-url http://127.0.0.1:3419` 供显式隔离 HTTP 服务验收，只接受专用环回端口，拒绝 3000/3001，并在写入前检查专用 live 标记和无上游替身标记。测试预加载入口在 `tests/fixtures/live-acceptance.mjs`。本轮启动该服务被执行工具策略拒绝，仅返回 blocked by policy，HTTP 实服和浏览器未重新验收；实际通过的是上述不监听端口的生产路由调用，不能混淆两种结果。

实际分阶段记录和限制见 [本轮报告](test-reports/TEST-20261022-M1-BASELINE.md)。单样本结果不足以计算总体 p50/p95，也不能外推长视频、日韩质量或月度可用性。

后续用户已同意暂缓 HTTP/浏览器验证、先继续后端开发，发布前补齐；不默认反复发起此前被拒绝的启动。`--media-only` 的范围、清理和结果见 [字幕/音频下载说明](YOUTUBE_DOWNLOADS.md)，它不能代替本节默认的文字模型链路检查。
